import { Construct } from 'constructs';
import * as agentcore from 'aws-cdk-lib/aws-bedrockagentcore';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as kms from 'aws-cdk-lib/aws-kms';
import { CfnResource, Duration, RemovalPolicy, Tags } from 'aws-cdk-lib';
import { ParamsConfig } from '../stack/shared/util/env-config';
import { AGENTCORE_NAME_PATTERN } from './agentcore-runtime-construct';

/**
 * Interface for AgentCore Memory configuration
 *
 * Without strategies the memory only keeps short-term events (the
 * conversation); extraction strategies turn those events into long-term
 * records (facts, preferences, summaries).
 */
export interface AgentCoreMemoryConfig {
  /** Letters, digits and underscores only, starting with a letter, up to 48 characters. */
  memoryName: string;
  description?: string;
  /** How long short-term events are kept: 7 to 365 days (service default 90). */
  expirationDuration?: Duration;
  memoryStrategies?: agentcore.IMemoryStrategy[];
  kmsKey?: kms.IKey;
}

/**
 * Interface for AgentCore Memory construct properties
 */
export interface AgentCoreMemoryConstructProps {
  params: ParamsConfig;
  memoryConfig: AgentCoreMemoryConfig;
  additionalTags?: { [key: string]: string };
}

/**
 * Level 2 AgentCore Memory Construct for the memory an agent keeps its
 * conversation events in and, through extraction strategies, the long-term
 * records derived from them
 *
 * Retained in prod: the memory holds customer conversations.
 *
 * @example
 * ```typescript
 * const memory = new AgentCoreMemoryConstruct(this, 'AgentMemory', {
 *   params,
 *   memoryConfig: {
 *     memoryName: agentCoreName(projectName, envName, 'memory'),
 *     expirationDuration: Duration.days(30),
 *     memoryStrategies: [agentcore.MemoryStrategy.usingBuiltInSummarization()],
 *   },
 * });
 * memory.grantAgentUse(agentRole);
 * ```
 */
export class AgentCoreMemoryConstruct extends Construct {
  public readonly memory: agentcore.Memory;
  public readonly memoryArn: string;
  public readonly memoryId: string;

  constructor(scope: Construct, id: string, props: AgentCoreMemoryConstructProps) {
    super(scope, id);

    const { params, memoryConfig, additionalTags = {} } = props;

    this.validateMemoryConfig(memoryConfig);

    this.memory = new agentcore.Memory(this, 'Memory', {
      memoryName: memoryConfig.memoryName,
      description: memoryConfig.description,
      expirationDuration: memoryConfig.expirationDuration,
      memoryStrategies: memoryConfig.memoryStrategies,
      kmsKey: memoryConfig.kmsKey,
    });

    // The Memory L2 names its CfnMemory child 'Memory' instead of 'Resource',
    // which leaves node.defaultChild unset and makes applyRemovalPolicy on the
    // L2 fail, so the policy goes on the L1 child directly.
    const cfnMemory = this.memory.node.children.find(CfnResource.isCfnResource);
    if (!cfnMemory) {
      throw new Error(`AgentCore memory '${memoryConfig.memoryName}': no CloudFormation resource to apply a removal policy to`);
    }
    cfnMemory.applyRemovalPolicy(params.isProd ? RemovalPolicy.RETAIN : RemovalPolicy.DESTROY);

    this.memoryArn = this.memory.memoryArn;
    this.memoryId = this.memory.memoryId;

    Object.entries(additionalTags).forEach(([key, value]) => Tags.of(this).add(key, value));
  }

  /**
   * What an agent session manager needs: write events, read them back,
   * retrieve the long-term records and delete its own short-term events.
   * Deleting long-term records and managing the memory are not included.
   */
  public grantAgentUse(identity: iam.IGrantable): void {
    this.memory.grantWrite(identity);
    this.memory.grantRead(identity);
    // The Strands AgentCore session manager replaces an event (redaction) by
    // creating a new one and deleting the old: without DeleteEvent that fails
    // with AccessDenied (seen in production on another ARKHO project).
    this.memory.grantDeleteShortTermMemory(identity);
  }

  private validateMemoryConfig(memoryConfig: AgentCoreMemoryConfig): void {
    const { memoryName, memoryStrategies, expirationDuration } = memoryConfig;
    if (!AGENTCORE_NAME_PATTERN.test(memoryName)) {
      throw new Error(`AgentCore memory '${memoryName}': use letters, digits and underscores, starting with a letter, up to 48 characters`);
    }
    if (expirationDuration && (expirationDuration.toDays() < 7 || expirationDuration.toDays() > 365)) {
      throw new Error(`AgentCore memory '${memoryName}': expirationDuration must be 7 to 365 days`);
    }
    // The service rejects the whole memory when two strategy names collide.
    const names = (memoryStrategies ?? []).map((strategy) => strategy.strategyName);
    const duplicated = names.filter((name, index) => names.indexOf(name) !== index);
    if (duplicated.length > 0) {
      throw new Error(`AgentCore memory '${memoryName}': duplicated strategy names ${[...new Set(duplicated)].join(', ')}`);
    }
  }
}
