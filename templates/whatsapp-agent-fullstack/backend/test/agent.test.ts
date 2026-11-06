import { describe, it, expect } from 'vitest';
import { Match, Template } from 'aws-cdk-lib/assertions';
import { agentCoreName } from '../lib/construct/agentcore-runtime-construct';
import { AGENT_LAMBDA_CMD, initialPrompt, WORKER_MAX_CONCURRENCY } from '../lib/stack/agent';
import type { AgentConfig } from '../lib/stack/shared/util/env-config';
import { getTemplate, getTemplateWithAgent, TEST_PARAMS } from './helpers/setup';

const PREFIX = `${TEST_PARAMS.projectName}-${TEST_PARAMS.envName}`;
const PROFILE = 'us.anthropic.claude-sonnet-4-6';

// Each synth stages the agent image folder, so the variants are built once.
const cache = new Map<string, Template>();
function variant(name: string, agent: Partial<AgentConfig> = {}, isProd = false): Template {
  if (!cache.has(name)) {
    cache.set(name, getTemplateWithAgent(agent, isProd ? { envName: 'prod', isProd: true } : {}));
  }
  return cache.get(name)!;
}
const agentcore = () => variant('agentcore');
const lambdaVariant = () => variant('lambda', { runtime: 'lambda', memoryMode: 'facts' });

/** Every statement of every IAM policy whose logical id starts with `prefix`. */
function statementsOf(template: Template, prefix: string): Record<string, any>[] {
  return Object.entries(template.findResources('AWS::IAM::Policy'))
    .filter(([id]) => id.startsWith(prefix))
    .flatMap(([, policy]) => (policy as any).Properties.PolicyDocument.Statement);
}

const actionsOf = (statements: Record<string, any>[]): string[] =>
  statements.flatMap((s) => (Array.isArray(s.Action) ? s.Action : [s.Action]));

describe('AgentFactory', () => {
  describe('AGENT_RUNTIME=none', () => {
    it('creates no agent resource and leaves ws-handler on the fixed auto-reply', () => {
      for (const template of [getTemplate(), getTemplateWithAgent({ runtime: 'none' })]) {
        template.resourceCountIs('AWS::BedrockAgentCore::Runtime', 0);
        template.resourceCountIs('AWS::BedrockAgentCore::Memory', 0);
        template.resourcePropertiesCountIs('AWS::SQS::Queue', { QueueName: Match.stringLikeRegexp('agent-jobs') }, 0);
        template.resourcePropertiesCountIs('AWS::SSM::Parameter', { Name: `/${PREFIX}-agent-prompt` }, 0);
        template.resourcePropertiesCountIs('AWS::Lambda::Function', { FunctionName: Match.stringLikeRegexp('agent') }, 0);
        const wsHandler = Object.values(
          template.findResources('AWS::Lambda::Function', { Properties: { FunctionName: `${PREFIX}-whatsapp-ws-handler` } })
        )[0] as any;
        expect(Object.keys(wsHandler.Properties.Environment.Variables)).not.toContain('AGENT_JOBS_QUEUE_URL');
        expect(actionsOf(statementsOf(template, '')).filter((action) => action.startsWith('bedrock'))).toEqual([]);
      }
    });
  });

  describe('AGENT_RUNTIME=agentcore', () => {
    it('runs the agent image on AgentCore Runtime with the contract environment and traces', () => {
      const template = agentcore();
      template.hasResourceProperties('AWS::BedrockAgentCore::Runtime', {
        AgentRuntimeName: agentCoreName(TEST_PARAMS.projectName, TEST_PARAMS.envName, 'agent'),
        ProtocolConfiguration: 'HTTP',
        NetworkConfiguration: { NetworkMode: 'PUBLIC' },
        EnvironmentVariables: Match.objectLike({
          MODEL_ID: PROFILE,
          MODEL_MAX_TOKENS: Match.anyValue(),
          MODEL_TEMPERATURE: Match.anyValue(),
          AGENT_MAX_TOOL_ITERATIONS: Match.anyValue(),
          AGENT_PROMPT_PARAMETER_NAME: Match.anyValue(),
          AGENT_MEMORY_ID: Match.anyValue(),
          AGENT_MEMORY_MODE: 'conversation',
          AGENT_MEMORY_FACTS_NAMESPACE: '/facts/{actorId}',
          AGENT_MEMORY_SUMMARIES_NAMESPACE: '/summaries/{actorId}/{sessionId}',
          WHATSAPP_CONVERSATIONS_TABLE_NAME: Match.anyValue(),
          WHATSAPP_MESSAGES_TABLE_NAME: Match.anyValue(),
          APPSYNC_GRAPHQL_URL: Match.anyValue(),
          WHATSAPP_ADMIN_GROUP: 'admin',
        }),
      });
      template.hasResourceProperties('AWS::Logs::DeliveryDestination', { DeliveryDestinationType: 'XRAY' });
      template.hasOutput('*', { Export: { Name: `${PREFIX}-AgentRuntimeArn` } });
      template.hasOutput('*', { Export: { Name: `${PREFIX}-AgentPromptParameterName` } });
    });

    it('wires the prompt manager: agent-config table, admin API and a write grant on the prompt', () => {
      const template = agentcore();
      template.hasResourceProperties('AWS::DynamoDB::Table', {
        TableName: `${PREFIX}-agent-config`,
        KeySchema: [
          { AttributeName: 'config_id', KeyType: 'HASH' },
          { AttributeName: 'version', KeyType: 'RANGE' },
        ],
      });
      for (const part of ['agent', 'config', 'draft', 'publish', 'versions', '{version}', 'rollback', 'adopt', 'models']) {
        template.hasResourceProperties('AWS::ApiGateway::Resource', { PathPart: part });
      }
      const actions = statementsOf(template, 'AgentFactoryConfigApi').flatMap((s) => [].concat(s.Action));
      expect(actions).toContain('ssm:PutParameter');
      expect(actions).toEqual(expect.arrayContaining(['bedrock:CreatePrompt', 'bedrock:UpdatePrompt', 'bedrock:CreatePromptVersion', 'bedrock:ListInferenceProfiles']));
    });

    it('seeds the prompt parameter once, as the JSON the agent reads', () => {
      const parameter = Object.values(
        agentcore().findResources('AWS::SSM::Parameter', { Properties: { Name: `/${PREFIX}-agent-prompt` } })
      )[0] as any;
      const prompt = JSON.parse(parameter.Properties.Value);
      expect(Object.keys(prompt).sort()).toEqual(
        ['basePrompt', 'businessName', 'enabled', 'greeting', 'handoffMessage', 'refusal', 'timezone'].sort()
      );
      expect(prompt.enabled).toBe(true);
      expect(prompt.businessName).toBe(TEST_PARAMS.projectName);
      expect(prompt.timezone).toBe('America/Santiago');
      expect(prompt.basePrompt).toContain('Tienda de muebles en Santiago.');
      expect(parameter.Properties.Tier).toBe('Intelligent-Tiering');
    });

    it('omits the business line from the base prompt when there is no description', () => {
      expect(initialPrompt('acme', '').basePrompt).not.toContain('Sobre el negocio');
    });

    it('may invoke the configured model and the Claude family through inference profiles, and read prompts', () => {
      const statements = statementsOf(agentcore(), 'AgentFactoryRuntime');
      const bySid = (sid: string) => statements.find((s) => s.Sid === sid)!;
      expect(JSON.stringify(bySid('InvokeAgentInferenceProfile').Resource)).toContain(`:inference-profile/${PROFILE}`);
      expect(JSON.stringify(bySid('InvokeAgentModelThroughProfile').Resource)).toContain(':bedrock:*::foundation-model/anthropic.claude-sonnet-4-6"');
      expect(JSON.stringify(bySid('InvokeAgentModelThroughProfile').Condition)).toContain(`inference-profile/${PROFILE}`);
      // The prompt manager may pick another Claude model: only Claude, only through this account's profiles.
      expect(JSON.stringify(bySid('InvokeClaudeInferenceProfiles').Resource)).toContain(':inference-profile/*anthropic.claude-*');
      expect(JSON.stringify(bySid('InvokeClaudeModelsThroughProfiles').Resource)).toContain('foundation-model/anthropic.claude-*');
      expect(JSON.stringify(bySid('InvokeClaudeModelsThroughProfiles').Condition)).toContain('inference-profile/*anthropic.claude-*');
      expect(actionsOf([bySid('ReadPromptManagement')])).toEqual(['bedrock:GetPrompt']);
      expect(actionsOf(statements)).not.toContain('bedrock:*');
      expect(actionsOf(statements)).not.toContain('dynamodb:DeleteItem');
      expect(actionsOf(statements)).not.toContain('dynamodb:Scan');
      expect(actionsOf(statements)).not.toContain('bedrock-agentcore:DeleteMemory');
    });

    it('scopes a bare foundation model id to that model in this region', () => {
      const statements = statementsOf(
        variant('foundation', { modelId: 'anthropic.claude-3-5-haiku-20241022-v1:0', memoryMode: 'off' }),
        'AgentFactoryRuntime'
      );
      const bedrock = statements.filter((s) => s.Sid === 'InvokeAgentModel');
      expect(bedrock).toHaveLength(1);
      expect(JSON.stringify(bedrock[0].Resource)).toContain(
        ':bedrock:us-east-1::foundation-model/anthropic.claude-3-5-haiku-20241022-v1:0"'
      );
    });

    it('queues the jobs on a FIFO queue with a dead-letter queue', () => {
      const template = agentcore();
      template.hasResourceProperties('AWS::SQS::Queue', {
        QueueName: `${PREFIX}-agent-jobs.fifo`,
        FifoQueue: true,
        RedrivePolicy: { maxReceiveCount: 2, deadLetterTargetArn: Match.anyValue() },
      });
      template.hasResourceProperties('AWS::SQS::Queue', { QueueName: `${PREFIX}-agent-jobs-dlq.fifo`, FifoQueue: true });
    });

    it('answers with one worker job at a time, capped in concurrency', () => {
      const template = agentcore();
      template.hasResourceProperties('AWS::Lambda::Function', {
        FunctionName: `${PREFIX}-whatsapp-agent-worker`,
        Timeout: 150,
        Environment: { Variables: Match.objectLike({ AGENT_RUNTIME_ARN: Match.anyValue() }) },
      });
      template.hasResourceProperties('AWS::Lambda::EventSourceMapping', {
        BatchSize: 1,
        ScalingConfig: { MaximumConcurrency: WORKER_MAX_CONCURRENCY },
      });
      const worker = actionsOf(statementsOf(template, 'WhatsAppFactoryagentworker'));
      expect(worker).toContain('bedrock-agentcore:InvokeAgentRuntime');
      expect(worker).toContain('social-messaging:SendWhatsAppMessage');
      expect(worker.filter((action) => action.startsWith('bedrock:'))).toEqual([]);
    });

    it('lets ws-handler queue jobs and read the on/off switch', () => {
      const template = agentcore();
      template.hasResourceProperties('AWS::Lambda::Function', {
        FunctionName: `${PREFIX}-whatsapp-ws-handler`,
        Environment: {
          Variables: Match.objectLike({
            AGENT_JOBS_QUEUE_URL: Match.anyValue(),
            AGENT_PROMPT_PARAMETER_NAME: Match.anyValue(),
            AGENT_RATE_LIMIT_PER_HOUR: '30',
          }),
        },
      });
      const wsHandler = actionsOf(statementsOf(template, 'WhatsAppFactorywshandler'));
      expect(wsHandler).toContain('sqs:SendMessage');
      expect(wsHandler).not.toContain('bedrock-agentcore:InvokeAgentRuntime');
    });
  });

  describe('memory', () => {
    it('conversation keeps only the short-term events, 30 days, deleted outside prod', () => {
      const template = agentcore();
      template.hasResource('AWS::BedrockAgentCore::Memory', {
        Properties: Match.objectLike({ EventExpiryDuration: 30, Name: agentCoreName(TEST_PARAMS.projectName, 'dev', 'agent_memory') }),
        DeletionPolicy: 'Delete',
      });
      const memory = Object.values(template.findResources('AWS::BedrockAgentCore::Memory'))[0] as any;
      expect(memory.Properties.MemoryStrategies ?? []).toEqual([]);
    });

    it('facts and facts_summaries add the long-term strategies', () => {
      const strategies = (template: Template) =>
        ((Object.values(template.findResources('AWS::BedrockAgentCore::Memory'))[0] as any).Properties.MemoryStrategies ?? []).map(
          (strategy: Record<string, unknown>) => Object.keys(strategy)[0]
        );
      expect(strategies(lambdaVariant())).toEqual(['SemanticMemoryStrategy', 'UserPreferenceMemoryStrategy']);
      expect(strategies(variant('summaries', { memoryMode: 'facts_summaries' }))).toEqual([
        'SemanticMemoryStrategy',
        'UserPreferenceMemoryStrategy',
        'SummaryMemoryStrategy',
      ]);
    });

    it('off creates no memory and no memory permission', () => {
      const template = variant('foundation', { modelId: 'anthropic.claude-3-5-haiku-20241022-v1:0', memoryMode: 'off' });
      template.resourceCountIs('AWS::BedrockAgentCore::Memory', 0);
      const runtime = Object.values(template.findResources('AWS::BedrockAgentCore::Runtime'))[0] as any;
      expect(Object.keys(runtime.Properties.EnvironmentVariables)).not.toContain('AGENT_MEMORY_ID');
      expect(actionsOf(statementsOf(template, 'AgentFactoryRuntime'))).not.toContain('bedrock-agentcore:CreateEvent');
    });

    it('is retained in prod', () => {
      variant('prod', {}, true).hasResource('AWS::BedrockAgentCore::Memory', {
        DeletionPolicy: 'Retain',
        UpdateReplacePolicy: 'Retain',
      });
    });
  });

  describe('AGENT_RUNTIME=lambda', () => {
    it('runs the same image as an ARM64 container Lambda with the handler command', () => {
      const template = lambdaVariant();
      template.resourceCountIs('AWS::BedrockAgentCore::Runtime', 0);
      template.hasResourceProperties('AWS::Lambda::Function', {
        FunctionName: `${PREFIX}-agent`,
        PackageType: 'Image',
        Architectures: ['arm64'],
        MemorySize: 2048,
        Timeout: 120,
        ImageConfig: { Command: AGENT_LAMBDA_CMD },
        Environment: { Variables: Match.objectLike({ MODEL_ID: PROFILE, AGENT_MEMORY_MODE: 'facts' }) },
      });
      template.hasResourceProperties('AWS::Lambda::Function', {
        FunctionName: `${PREFIX}-whatsapp-agent-worker`,
        Environment: { Variables: Match.objectLike({ AGENT_FUNCTION_NAME: Match.anyValue() }) },
      });
      expect(actionsOf(statementsOf(template, 'WhatsAppFactoryagentworker'))).toContain('lambda:InvokeFunction');
      template.hasOutput('*', { Export: { Name: `${PREFIX}-AgentFunctionName` } });
    });

    it('grants the agent function the model, its memory and the prompt', () => {
      const actions = actionsOf(statementsOf(lambdaVariant(), 'AgentFactoryAgentFunction'));
      expect(actions).toContain('bedrock:InvokeModel');
      expect(actions).toContain('bedrock-agentcore:RetrieveMemoryRecords');
      expect(actions).toContain('ssm:GetParameter');
      expect(actions).toContain('appsync:GraphQL');
    });
  });

  it('keeps AgentCore names valid for long project names', () => {
    const name = agentCoreName('a-very-long-project-name-for-tests', 'staging', 'agent_memory');
    expect(name.length).toBeLessThanOrEqual(48);
    expect(name).toMatch(/^[a-zA-Z][a-zA-Z0-9_]*_staging_agent_memory$/);
  });
});
