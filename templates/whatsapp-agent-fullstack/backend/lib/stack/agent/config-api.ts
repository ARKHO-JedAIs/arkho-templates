import { Duration, RemovalPolicy, Stack } from 'aws-cdk-lib';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as iam from 'aws-cdk-lib/aws-iam';
import { Code } from 'aws-cdk-lib/aws-lambda';
import { RetentionDays } from 'aws-cdk-lib/aws-logs';
import { Construct } from 'constructs';
import { DynamoConstruct } from '../../construct/dynamo-construct';
import { LambdaConstruct } from '../../construct/lambda-construct';
import { SsmParametersConstruct } from '../../construct/ssm-parameters-construct';
import { AccessFactory } from '../access';
import { ApiFactory } from '../api';
import { LayerFactory } from '../layer';
import { ParamsConfig } from '../shared/util/env-config';
import { PYTHON_RUNTIME } from '../shared/util/runtime';

export interface AgentConfigApiProps {
  params: ParamsConfig;
  layerFactory: LayerFactory;
  apiFactory: ApiFactory;
  access: AccessFactory;
  /** The agent-prompt parameter: publishing writes the version there. */
  promptParameter: SsmParametersConstruct;
  promptKey: string;
  /** The same construct's agent-settings parameter (memory window and answer limit). */
  settingsKey: string;
  /** What AgentCore Memory keeps beyond a conversation, shown next to the memory setting. */
  longTermMemoryMode: string;
  /** Seeds the settings the function reads before the parameter exists. */
  /** null = no limit. */
  rateLimitPerHour: number | null;
  /** What the agent uses until a model is chosen from the web. */
  defaultModel: { id: string; temperature: number; maxTokens: number };
}

const ROUTES = [
  { path: '/admin/agent/config', method: 'GET' },
  { path: '/admin/agent/config/draft', method: 'PUT' },
  { path: '/admin/agent/config/draft', method: 'DELETE' },
  { path: '/admin/agent/config/publish', method: 'POST' },
  { path: '/admin/agent/config/versions', method: 'GET' },
  { path: '/admin/agent/config/versions/{version}', method: 'GET' },
  { path: '/admin/agent/config/rollback', method: 'POST' },
  { path: '/admin/agent/config/adopt', method: 'POST' },
  { path: '/admin/agent/models', method: 'GET' },
];

const SETTINGS_ROUTES = [
  { path: '/admin/agent/settings', method: 'GET' },
  { path: '/admin/agent/settings', method: 'PUT' },
];

/**
 * The prompt manager (the web's "Agente IA" screen). The instructions, model
 * and inference parameters live in an Amazon Bedrock Prompt Management prompt
 * (`<prefix>-agent`, created on first use and editable in the AWS console);
 * the agent-config table keeps the author, comment and history of every
 * version and which one is in use; publishing writes the agent-prompt
 * parameter the agent reads. src/lambda/agent/config-admin has the details.
 */
export class AgentConfigApi extends Construct {
  public readonly table: DynamoConstruct;
  public readonly function: LambdaConstruct;
  public readonly settingsFunction: LambdaConstruct;

  constructor(scope: Construct, id: string, props: AgentConfigApiProps) {
    super(scope, id);

    const {
      params,
      layerFactory,
      apiFactory,
      access,
      promptParameter,
      promptKey,
      settingsKey,
      longTermMemoryMode,
      rateLimitPerHour,
      defaultModel,
    } = props;
    const { envName, projectName, isProd } = params;
    const prefix = `${projectName}-${envName}`;
    const { account, partition, region } = Stack.of(this);

    this.table = new DynamoConstruct(this, 'AgentConfigTable', {
      params,
      tableConfig: {
        tableName: `${prefix}-agent-config`,
        partitionKey: { name: 'config_id', type: dynamodb.AttributeType.STRING },
        sortKey: { name: 'version', type: dynamodb.AttributeType.STRING },
        billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      },
    });

    this.function = new LambdaConstruct(this, 'ConfigAdminLambda', {
      functionName: `${prefix}-agent-config-admin`,
      description: 'Prompt manager API: draft, publish, history and rollback of the agent configuration',
      code: Code.fromAsset('src/lambda/agent/config-admin'),
      handler: 'index.handler',
      runtime: PYTHON_RUNTIME,
      layers: [layerFactory.pythonCommonLayer.layer],
      environment: {
        AGENT_CONFIG_TABLE: this.table.tableName,
        AGENT_PROMPT_PARAMETER_NAME: promptParameter.getParameterName(promptKey),
        AGENT_BEDROCK_PROMPT_NAME: `${prefix}-agent`,
        DEFAULT_MODEL_ID: defaultModel.id,
        DEFAULT_MODEL_TEMPERATURE: String(defaultModel.temperature),
        DEFAULT_MODEL_MAX_TOKENS: String(defaultModel.maxTokens),
      },
      timeout: Duration.seconds(30),
      logging: {
        logRetention: RetentionDays.ONE_MONTH,
        removalPolicy: isProd ? RemovalPolicy.RETAIN : RemovalPolicy.DESTROY,
      },
    });
    this.table.table.grantReadWriteData(this.function.function);
    promptParameter.grantRead(this.function.function, promptKey);
    promptParameter.grantWrite(this.function.function, promptKey);
    access.grantRead(this.function.function);

    const fn = this.function.function;
    const prompts = `arn:${partition}:bedrock:${region}:${account}:prompt/*`;
    fn.addToRolePolicy(
      new iam.PolicyStatement({
        sid: 'ManagePrompts',
        actions: ['bedrock:CreatePrompt', 'bedrock:UpdatePrompt', 'bedrock:GetPrompt', 'bedrock:CreatePromptVersion', 'bedrock:ListPrompts'],
        resources: [prompts],
      })
    );
    // ListPrompts without a prompt id (finding ours by name) and the model list have no resource.
    fn.addToRolePolicy(
      new iam.PolicyStatement({
        sid: 'ListPromptsAndModels',
        actions: ['bedrock:ListPrompts', 'bedrock:ListInferenceProfiles'],
        resources: ['*'],
      })
    );
    // The one-token check that a newly chosen model is enabled in the account.
    const profiles = `arn:${partition}:bedrock:${region}:${account}:inference-profile/*anthropic.claude-*`;
    fn.addToRolePolicy(new iam.PolicyStatement({ sid: 'CheckClaudeProfiles', actions: ['bedrock:InvokeModel'], resources: [profiles] }));
    fn.addToRolePolicy(
      new iam.PolicyStatement({
        sid: 'CheckClaudeModels',
        actions: ['bedrock:InvokeModel'],
        resources: [`arn:${partition}:bedrock:*::foundation-model/anthropic.claude-*`],
        conditions: { StringLike: { 'bedrock:InferenceProfileArn': profiles } },
      })
    );

    for (const route of ROUTES) {
      apiFactory.restApi.addRoute({ ...route, lambda: this.function.function });
    }

    this.settingsFunction = new LambdaConstruct(this, 'SettingsAdminLambda', {
      functionName: `${prefix}-agent-settings-admin`,
      description: 'Agent settings API: memory window and answer limit',
      code: Code.fromAsset('src/lambda/agent/settings-admin'),
      handler: 'index.handler',
      runtime: PYTHON_RUNTIME,
      layers: [layerFactory.pythonCommonLayer.layer],
      environment: {
        AGENT_SETTINGS_PARAMETER_NAME: promptParameter.getParameterName(settingsKey),
        AGENT_MEMORY_MODE: longTermMemoryMode,
        AGENT_RATE_LIMIT_PER_HOUR: String(rateLimitPerHour ?? 0),
      },
      logging: {
        logRetention: RetentionDays.ONE_MONTH,
        removalPolicy: isProd ? RemovalPolicy.RETAIN : RemovalPolicy.DESTROY,
      },
    });
    promptParameter.grantRead(this.settingsFunction.function, settingsKey);
    promptParameter.grantWrite(this.settingsFunction.function, settingsKey);
    access.grantRead(this.settingsFunction.function);
    for (const route of SETTINGS_ROUTES) {
      apiFactory.restApi.addRoute({ ...route, lambda: this.settingsFunction.function });
    }
  }
}
