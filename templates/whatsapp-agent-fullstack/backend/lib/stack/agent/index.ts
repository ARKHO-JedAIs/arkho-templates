import { CfnOutput, Duration, RemovalPolicy, Stack } from 'aws-cdk-lib';
import * as agentcore from 'aws-cdk-lib/aws-bedrockagentcore';
import { DockerImageAsset, Platform } from 'aws-cdk-lib/aws-ecr-assets';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import { SqsEventSource } from 'aws-cdk-lib/aws-lambda-event-sources';
import { LogGroup, RetentionDays } from 'aws-cdk-lib/aws-logs';
import * as sqs from 'aws-cdk-lib/aws-sqs';
import * as ssm from 'aws-cdk-lib/aws-ssm';
import { Construct } from 'constructs';
import { AgentCoreMemoryConstruct } from '../../construct/agentcore-memory-construct';
import { agentCoreName, AgentCoreRuntimeConstruct } from '../../construct/agentcore-runtime-construct';
import { SsmParametersConstruct } from '../../construct/ssm-parameters-construct';
import { AgentConfig, AgentMemoryMode, ParamsConfig } from '../shared/util/env-config';
import { PUBLISH_EVENT_FIELD, WhatsAppFactory } from '../whatsapp';
import { AccessFactory } from '../access';
import { ApiFactory } from '../api';
import { LayerFactory } from '../layer';
import { AgentConfigApi } from './config-api';

export interface AgentFactoryProps {
  params: ParamsConfig;
  agent: AgentConfig;
  /** WHATSAPP_ADMIN_GROUP; empty when every signed-in user may use WhatsApp. */
  adminGroup: string;
  whatsappFactory: WhatsAppFactory;
  /** Set together, the prompt manager API (AgentConfigApi) is wired. */
  configApi?: { layerFactory: LayerFactory; apiFactory: ApiFactory; access: AccessFactory };
}

/** Build context of the agent image: backend/src/agent (Dockerfile, app and Lambda handler). */
export const AGENT_DIRECTORY = 'src/agent';
/** The Lambda variant runs the same image with this command (awslambdaric). */
export const AGENT_LAMBDA_CMD = ['lambda_handler.handler'];

const PROMPT_KEY = 'agentPrompt';
const DEFAULT_TIMEZONE = 'America/Santiago';
const MODEL_MAX_TOKENS = 1024;
const MODEL_TEMPERATURE = 0.3;
const MAX_TOOL_ITERATIONS = 5;
const MEMORY_EXPIRATION = Duration.days(30);

const AGENT_LAMBDA_MEMORY_MB = 2048;
const AGENT_LAMBDA_TIMEOUT = Duration.seconds(120);
/** Longer than the agent call (worker read timeout ~110 s / Lambda 120 s) plus the send. */
const WORKER_TIMEOUT_SECONDS = 150;
/** Concurrent agent turns at most: protects the Bedrock quotas of the account. */
export const WORKER_MAX_CONCURRENCY = 10;

/** Long-term memory namespaces; the agent retrieves from the same paths. */
export const MEMORY_NAMESPACES = {
  facts: '/facts/{actorId}',
  preferences: '/preferences/{actorId}',
  summaries: '/summaries/{actorId}/{sessionId}',
};

// Cross-region inference profile ids start with a geography; a bare id is a
// foundation model invoked in this region.
const INFERENCE_PROFILE_GEOGRAPHIES = ['us', 'us-gov', 'eu', 'apac', 'jp', 'au', 'ca', 'global'];

/** The extraction strategies of each memory mode; `off` creates no memory at all. */
function memoryStrategies(mode: AgentMemoryMode): agentcore.IMemoryStrategy[] {
  const facts = [
    agentcore.MemoryStrategy.usingSemantic({
      strategyName: 'customer_facts',
      description: 'Facts the customer shared, across conversations',
      namespaces: [MEMORY_NAMESPACES.facts],
    }),
    agentcore.MemoryStrategy.usingUserPreference({
      strategyName: 'customer_preferences',
      description: 'Preferences of the customer, across conversations',
      namespaces: [MEMORY_NAMESPACES.preferences],
    }),
  ];
  if (mode === 'facts') return facts;
  if (mode === 'facts_summaries') {
    return [
      ...facts,
      agentcore.MemoryStrategy.usingSummarization({
        strategyName: 'conversation_summaries',
        description: 'Summary of each conversation',
        namespaces: [MEMORY_NAMESPACES.summaries],
      }),
    ];
  }
  return [];
}

/**
 * The base prompt the agent starts from, in Spanish: the customers write in
 * Spanish and the admins edit it from Parameter Store.
 */
export function initialPrompt(businessName: string, businessDescription: string): Record<string, unknown> {
  const about = businessDescription.trim();
  const basePrompt = [
    `Eres el asistente virtual de ${businessName} en WhatsApp.`,
    ...(about ? [`Sobre el negocio: ${about}`] : []),
    'Responde siempre en español, con amabilidad y en mensajes breves: pocas líneas, sin tablas ni formato complejo.',
    `Responde solo sobre ${businessName} y sus productos o servicios. Si te preguntan otra cosa, indica con cortesía que solo puedes ayudar con eso.`,
    'No inventes precios, stock, plazos ni políticas: si no tienes el dato, dilo.',
    'Nunca pidas contraseñas ni datos de tarjetas.',
    'Si no puedes ayudar o el cliente pide hablar con una persona, ofrécele derivarlo a una persona del equipo.',
  ].join('\n');
  return {
    enabled: true,
    basePrompt,
    businessName,
    greeting: `¡Hola! Soy el asistente virtual de ${businessName}. ¿En qué te puedo ayudar?`,
    refusal: `Solo puedo ayudarte con consultas sobre ${businessName}. ¿Hay algo en lo que te pueda ayudar?`,
    handoffMessage: 'Te comunico con una persona del equipo. Te responderemos a la brevedad.',
    timezone: DEFAULT_TIMEZONE,
  };
}

/**
 * The AI agent that answers WhatsApp, wired only when AGENT_RUNTIME is
 * agentcore or lambda.
 *
 * ws-handler queues each customer message (FIFO, one group per phone so a
 * customer's turns run in order) on `agent-jobs`; `whatsapp-agent-worker`
 * takes one job at a time, at most WORKER_MAX_CONCURRENCY at once, invokes the
 * agent and sends its reply through WhatsApp. The agent itself is the image
 * built from backend/agent, run by AgentCore Runtime or by a container Lambda
 * (same image, other command). Its base prompt lives in the `agent-prompt`
 * parameter and, unless AGENT_MEMORY_MODE=off, it remembers through AgentCore
 * Memory.
 */
export class AgentFactory extends Construct {
  public readonly promptParameter: SsmParametersConstruct;
  public readonly memory?: AgentCoreMemoryConstruct;
  public readonly runtime?: AgentCoreRuntimeConstruct;
  public readonly agentFunction?: lambda.DockerImageFunction;
  public readonly image: DockerImageAsset;
  public readonly jobsQueue: sqs.Queue;
  public readonly jobsDeadLetterQueue: sqs.Queue;

  constructor(scope: Construct, id: string, props: AgentFactoryProps) {
    super(scope, id);

    const { params, agent, adminGroup, whatsappFactory, configApi } = props;
    const { envName, projectName, isProd } = params;
    const prefix = `${projectName}-${envName}`;
    const removalPolicy = isProd ? RemovalPolicy.RETAIN : RemovalPolicy.DESTROY;

    // CloudFormation only rewrites a parameter when its template value
    // changes, so the edits made in Parameter Store survive every deploy that
    // does not change the seed (.env AGENT_BUSINESS_DESCRIPTION).
    this.promptParameter = new SsmParametersConstruct(this, 'Parameters', {
      params,
      parameterConfigs: [
        {
          key: PROMPT_KEY,
          parameterName: `/${prefix}-agent-prompt`,
          simpleName: false,
          stringValue: JSON.stringify(initialPrompt(projectName, agent.businessDescription), null, 2),
          dataType: ssm.ParameterDataType.TEXT,
          // Standard pricing until an edited prompt outgrows 4 KB.
          tier: ssm.ParameterTier.INTELLIGENT_TIERING,
          description: 'AI agent: base prompt, greeting, refusal, handoff message, on/off',
        },
      ],
    });
    const promptParameterName = this.promptParameter.getParameterName(PROMPT_KEY);

    if (agent.memoryMode !== 'off') {
      this.memory = new AgentCoreMemoryConstruct(this, 'Memory', {
        params,
        memoryConfig: {
          memoryName: agentCoreName(projectName, envName, 'agent_memory'),
          description: `WhatsApp agent memory (${agent.memoryMode})`,
          expirationDuration: MEMORY_EXPIRATION,
          memoryStrategies: memoryStrategies(agent.memoryMode),
        },
      });
    }

    const environment: Record<string, string> = {
      MODEL_ID: agent.modelId,
      MODEL_MAX_TOKENS: String(MODEL_MAX_TOKENS),
      MODEL_TEMPERATURE: String(MODEL_TEMPERATURE),
      AGENT_MAX_TOOL_ITERATIONS: String(MAX_TOOL_ITERATIONS),
      AGENT_PROMPT_PARAMETER_NAME: promptParameterName,
      AGENT_MEMORY_MODE: agent.memoryMode,
      ...(this.memory
        ? {
            AGENT_MEMORY_ID: this.memory.memoryId,
            AGENT_MEMORY_FACTS_NAMESPACE: MEMORY_NAMESPACES.facts,
            AGENT_MEMORY_PREFERENCES_NAMESPACE: MEMORY_NAMESPACES.preferences,
            AGENT_MEMORY_SUMMARIES_NAMESPACE: MEMORY_NAMESPACES.summaries,
          }
        : {}),
      WHATSAPP_CONVERSATIONS_TABLE_NAME: whatsappFactory.conversationsTable.tableName,
      WHATSAPP_MESSAGES_TABLE_NAME: whatsappFactory.messagesTable.tableName,
      APPSYNC_GRAPHQL_URL: whatsappFactory.eventsApi.graphqlUrl,
      ...(adminGroup ? { WHATSAPP_ADMIN_GROUP: adminGroup } : {}),
      ...(agent.businessApiUrl ? { AGENT_BUSINESS_API_URL: agent.businessApiUrl } : {}),
    };

    // One asset for both variants: `cdk deploy` builds and pushes it (Docker
    // required); synth only stages the folder.
    this.image = new DockerImageAsset(this, 'AgentImage', {
      directory: AGENT_DIRECTORY,
      platform: Platform.LINUX_ARM64,
      exclude: ['**/__pycache__', '**/*.pyc', '.venv', '.pytest_cache', '.env'],
    });

    let agentRole: iam.IRole;
    let invokeTarget: Record<string, string>;
    if (agent.runtime === 'agentcore') {
      this.runtime = new AgentCoreRuntimeConstruct(this, 'Runtime', {
        params,
        runtimeConfig: {
          runtimeName: agentCoreName(projectName, envName, 'agent'),
          description: 'WhatsApp AI agent (backend/agent)',
          ecrRepository: this.image.repository,
          imageTag: this.image.imageTag,
          environmentVariables: environment,
          tracingEnabled: true,
        },
      });
      agentRole = this.runtime.role;
      invokeTarget = { AGENT_RUNTIME_ARN: this.runtime.agentRuntimeArn };
    } else {
      const functionName = `${prefix}-agent`;
      this.agentFunction = new lambda.DockerImageFunction(this, 'AgentFunction', {
        functionName,
        description: 'WhatsApp AI agent (backend/agent, Lambda variant)',
        code: lambda.DockerImageCode.fromEcr(this.image.repository, {
          tagOrDigest: this.image.imageTag,
          cmd: AGENT_LAMBDA_CMD,
        }),
        architecture: lambda.Architecture.ARM_64,
        memorySize: AGENT_LAMBDA_MEMORY_MB,
        timeout: AGENT_LAMBDA_TIMEOUT,
        environment,
        logGroup: new LogGroup(this, 'AgentFunctionLogGroup', {
          logGroupName: `/aws/lambda/${functionName}`,
          retention: RetentionDays.ONE_MONTH,
          removalPolicy,
        }),
      });
      agentRole = this.agentFunction.role!;
      invokeTarget = { AGENT_FUNCTION_NAME: this.agentFunction.functionName };
    }

    this.grantAgent(agentRole, agent.modelId, whatsappFactory);
    this.promptParameter.grantRead(agentRole, PROMPT_KEY);
    this.memory?.grantAgentUse(agentRole);

    this.jobsDeadLetterQueue = new sqs.Queue(this, 'JobsDeadLetterQueue', {
      queueName: `${prefix}-agent-jobs-dlq.fifo`,
      fifo: true,
      retentionPeriod: Duration.days(14),
      enforceSSL: true,
    });
    // FIFO: one message group per phone keeps a customer's turns in order and
    // one at a time, and the WhatsApp message id deduplicates a redelivery.
    // AWS recommends a visibility timeout of six times the function timeout.
    this.jobsQueue = new sqs.Queue(this, 'JobsQueue', {
      queueName: `${prefix}-agent-jobs.fifo`,
      fifo: true,
      visibilityTimeout: Duration.seconds(WORKER_TIMEOUT_SECONDS * 6),
      retentionPeriod: Duration.hours(24),
      enforceSSL: true,
      deadLetterQueue: { queue: this.jobsDeadLetterQueue, maxReceiveCount: 2 },
    });

    const worker = whatsappFactory.addFunction(
      {
        name: 'agent-worker',
        description: 'Answers queued WhatsApp messages with the AI agent',
        tables: 'write',
        sends: true,
        timeoutSeconds: WORKER_TIMEOUT_SECONDS,
      },
      invokeTarget
    );
    // Maximum concurrency on the event source instead of reserved concurrency:
    // it caps the agent turns without throttling the poller or reserving
    // account capacity.
    worker.function.addEventSource(
      new SqsEventSource(this.jobsQueue, { batchSize: 1, maxConcurrency: WORKER_MAX_CONCURRENCY })
    );
    if (this.runtime) {
      this.runtime.grantInvokeRuntime(worker.function);
    } else {
      this.agentFunction!.grantInvoke(worker.function);
    }

    const wsHandler = whatsappFactory.functions['ws-handler'].function;
    wsHandler.addEnvironment('AGENT_JOBS_QUEUE_URL', this.jobsQueue.queueUrl);
    wsHandler.addEnvironment('AGENT_PROMPT_PARAMETER_NAME', promptParameterName);
    wsHandler.addEnvironment('AGENT_RATE_LIMIT_PER_HOUR', String(agent.rateLimitPerHour));
    this.jobsQueue.grantSendMessages(wsHandler);
    this.promptParameter.grantRead(wsHandler, PROMPT_KEY);

    if (configApi) {
      new AgentConfigApi(this, 'ConfigApi', {
        params,
        ...configApi,
        promptParameter: this.promptParameter,
        promptKey: PROMPT_KEY,
        defaultModel: { id: agent.modelId, temperature: MODEL_TEMPERATURE, maxTokens: MODEL_MAX_TOKENS },
      });
    }

    new CfnOutput(this, 'AgentPromptParameterName', {
      value: promptParameterName,
      description: 'Parameter Store JSON with the AI agent base prompt and on/off switch',
      exportName: `${prefix}-AgentPromptParameterName`,
    });
    if (this.runtime) {
      new CfnOutput(this, 'AgentRuntimeArn', {
        value: this.runtime.agentRuntimeArn,
        description: 'Bedrock AgentCore runtime of the WhatsApp AI agent',
        exportName: `${prefix}-AgentRuntimeArn`,
      });
    } else {
      new CfnOutput(this, 'AgentFunctionName', {
        value: this.agentFunction!.functionName,
        description: 'Lambda function of the WhatsApp AI agent',
        exportName: `${prefix}-AgentFunctionName`,
      });
    }
    if (this.memory) {
      new CfnOutput(this, 'AgentMemoryId', {
        value: this.memory.memoryId,
        description: 'AgentCore Memory of the WhatsApp AI agent',
        exportName: `${prefix}-AgentMemoryId`,
      });
    }
    new CfnOutput(this, 'AgentJobsDeadLetterQueueUrl', {
      value: this.jobsDeadLetterQueue.queueUrl,
      description: 'Agent jobs that failed twice (the worker could not even start them)',
      exportName: `${prefix}-AgentJobsDeadLetterQueueUrl`,
    });
  }

  /**
   * What the agent's own code needs: the model, and the inbox tables and
   * events its handoff tool writes (mode, internal notice, realtime).
   */
  private grantAgent(role: iam.IRole, modelId: string, whatsappFactory: WhatsAppFactory): void {
    for (const statement of [...bedrockInvokeStatements(Stack.of(this), modelId), ...claudeFamilyStatements(Stack.of(this))]) {
      role.addToPrincipalPolicy(statement);
    }
    role.addToPrincipalPolicy(
      new iam.PolicyStatement({
        sid: 'HandoffConversation',
        actions: ['dynamodb:GetItem', 'dynamodb:UpdateItem'],
        resources: [whatsappFactory.conversationsTable.table.tableArn],
      })
    );
    role.addToPrincipalPolicy(
      new iam.PolicyStatement({
        sid: 'HandoffNotice',
        actions: ['dynamodb:PutItem', 'dynamodb:GetItem', 'dynamodb:Query'],
        resources: [whatsappFactory.messagesTable.table.tableArn],
      })
    );
    whatsappFactory.eventsApi.grantMutation(role, PUBLISH_EVENT_FIELD);
  }
}

/**
 * Bedrock InvokeModel scoped to the configured model. Bedrock has no grant
 * API; an inference profile needs both the profile in this account and the
 * foundation model it routes to in every region of the profile (a global
 * profile's model ARN has no region), and the condition keeps that second leg
 * usable only through this profile.
 */
/**
 * The prompt manager lets a developer pick any Claude model (an inference
 * profile of the account) and stores the instructions in Bedrock Prompt
 * Management: invoke on the Claude family through its profiles, and read the
 * prompts of this account.
 */
export function claudeFamilyStatements(stack: Stack): iam.PolicyStatement[] {
  const { account, partition, region } = stack;
  const actions = ['bedrock:InvokeModel', 'bedrock:InvokeModelWithResponseStream'];
  const profiles = `arn:${partition}:bedrock:${region}:${account}:inference-profile/*anthropic.claude-*`;
  return [
    new iam.PolicyStatement({ sid: 'InvokeClaudeInferenceProfiles', actions, resources: [profiles] }),
    new iam.PolicyStatement({
      sid: 'InvokeClaudeModelsThroughProfiles',
      actions,
      resources: [`arn:${partition}:bedrock:*::foundation-model/anthropic.claude-*`],
      conditions: { StringLike: { 'bedrock:InferenceProfileArn': profiles } },
    }),
    new iam.PolicyStatement({
      sid: 'ReadPromptManagement',
      actions: ['bedrock:GetPrompt'],
      resources: [`arn:${partition}:bedrock:${region}:${account}:prompt/*`],
    }),
  ];
}

export function bedrockInvokeStatements(stack: Stack, modelId: string): iam.PolicyStatement[] {
  const { account, partition, region } = stack;
  const actions = ['bedrock:InvokeModel', 'bedrock:InvokeModelWithResponseStream'];
  const [geography, ...rest] = modelId.split('.');
  if (!INFERENCE_PROFILE_GEOGRAPHIES.includes(geography) || rest.length < 2) {
    return [
      new iam.PolicyStatement({
        sid: 'InvokeAgentModel',
        actions,
        resources: [`arn:${partition}:bedrock:${region}::foundation-model/${modelId}`],
      }),
    ];
  }
  const profileArn = `arn:${partition}:bedrock:${region}:${account}:inference-profile/${modelId}`;
  return [
    new iam.PolicyStatement({ sid: 'InvokeAgentInferenceProfile', actions, resources: [profileArn] }),
    new iam.PolicyStatement({
      sid: 'InvokeAgentModelThroughProfile',
      actions,
      resources: [`arn:${partition}:bedrock:*::foundation-model/${rest.join('.')}`],
      conditions: { StringLike: { 'bedrock:InferenceProfileArn': profileArn } },
    }),
  ];
}
