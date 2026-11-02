import { Construct } from 'constructs';
import * as agentcore from 'aws-cdk-lib/aws-bedrockagentcore';
import * as ecr from 'aws-cdk-lib/aws-ecr';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as logs from 'aws-cdk-lib/aws-logs';
import { Annotations, CfnResource, Tags } from 'aws-cdk-lib';
import { ParamsConfig } from '../stack/shared/util/env-config';

/**
 * Interface for AgentCore Runtime configuration
 *
 * The container image comes either from an ECR repository (ecrRepository plus
 * imageTag, which also wires the pull permissions) or from a fully built
 * artifact (artifact).
 */
export interface AgentCoreRuntimeConfig {
  /** Letters, digits and underscores only, starting with a letter, up to 48 characters. */
  runtimeName: string;
  ecrRepository?: ecr.IRepository;
  imageTag?: string;
  artifact?: agentcore.AgentRuntimeArtifact;
  description?: string;
  executionRole?: iam.IRole;
  networkConfiguration?: agentcore.RuntimeNetworkConfiguration;
  protocolConfiguration?: agentcore.ProtocolType;
  authorizerConfiguration?: agentcore.RuntimeAuthorizerConfiguration;
  environmentVariables?: { [key: string]: string };
  lifecycleConfiguration?: agentcore.LifecycleConfiguration;
  /** X-Ray traces of every invocation (default: on in prod only). */
  tracingEnabled?: boolean;
}

/**
 * Interface for AgentCore Runtime construct properties
 */
export interface AgentCoreRuntimeConstructProps {
  params: ParamsConfig;
  runtimeConfig: AgentCoreRuntimeConfig;
  additionalTags?: { [key: string]: string };
}

/** The name pattern AgentCore enforces on runtimes and memories. */
export const AGENTCORE_NAME_PATTERN = /^[a-zA-Z][a-zA-Z0-9_]{0,47}$/;
const AGENTCORE_NAME_MAX_LENGTH = 48;

/**
 * `${projectName}_${envName}_${suffix}` as AgentCore accepts it: hyphens become
 * underscores and, when the result is longer than 48 characters, the project
 * part is shortened so the environment and the suffix stay readable.
 */
export function agentCoreName(projectName: string, envName: string, suffix: string): string {
  const clean = (value: string) => value.replace(/[^a-zA-Z0-9_]/g, '_');
  const tail = `_${clean(envName)}_${clean(suffix)}`;
  const head = clean(projectName).slice(0, Math.max(1, AGENTCORE_NAME_MAX_LENGTH - tail.length));
  const name = `${head}${tail}`;
  if (!AGENTCORE_NAME_PATTERN.test(name)) {
    throw new Error(`AgentCore name '${name}' is invalid: letters, digits and underscores, starting with a letter, up to 48 characters`);
  }
  return name;
}

/**
 * Level 2 AgentCore Runtime Construct for running a containerized agent on
 * Amazon Bedrock AgentCore Runtime
 *
 * Public network, HTTP protocol and IAM (SigV4) inbound authorization by
 * default: callers are granted InvokeAgentRuntime instead of holding a token.
 *
 * @example
 * ```typescript
 * const image = new DockerImageAsset(this, 'AgentImage', { directory: 'src/agent', platform: Platform.LINUX_ARM64 });
 * const runtime = new AgentCoreRuntimeConstruct(this, 'AgentRuntime', {
 *   params,
 *   runtimeConfig: {
 *     runtimeName: agentCoreName(projectName, envName, 'agent'),
 *     ecrRepository: image.repository,
 *     imageTag: image.imageTag,
 *     environmentVariables: { MODEL_ID: 'us.anthropic.claude-sonnet-4-6' },
 *   },
 * });
 * runtime.grantInvokeRuntime(callerFunction);
 * ```
 */
export class AgentCoreRuntimeConstruct extends Construct {
  public readonly runtime: agentcore.Runtime;
  public readonly agentRuntimeArn: string;
  public readonly agentRuntimeId: string;
  public readonly agentRuntimeName: string;
  /** The execution role the agent runs with. */
  public readonly role: iam.IRole;
  /** Created by the service on the first invocation, not by CloudFormation. */
  public readonly applicationLogGroup: logs.ILogGroup;

  constructor(scope: Construct, id: string, props: AgentCoreRuntimeConstructProps) {
    super(scope, id);

    const { params, runtimeConfig, additionalTags = {} } = props;

    this.validateRuntimeConfig(runtimeConfig);

    // AgentCore Runtime only runs linux/arm64 images; the platform is fixed by
    // whatever builds the image, not by this configuration.
    const agentRuntimeArtifact =
      runtimeConfig.artifact ??
      agentcore.AgentRuntimeArtifact.fromEcrRepository(runtimeConfig.ecrRepository!, runtimeConfig.imageTag);

    this.runtime = new agentcore.Runtime(this, 'Runtime', {
      runtimeName: runtimeConfig.runtimeName,
      agentRuntimeArtifact,
      description: runtimeConfig.description,
      executionRole: runtimeConfig.executionRole,
      networkConfiguration:
        runtimeConfig.networkConfiguration ?? agentcore.RuntimeNetworkConfiguration.usingPublicNetwork(),
      protocolConfiguration: runtimeConfig.protocolConfiguration ?? agentcore.ProtocolType.HTTP,
      authorizerConfiguration:
        runtimeConfig.authorizerConfiguration ?? agentcore.RuntimeAuthorizerConfiguration.usingIAM(),
      environmentVariables: runtimeConfig.environmentVariables,
      lifecycleConfiguration: runtimeConfig.lifecycleConfiguration,
      tracingEnabled: runtimeConfig.tracingEnabled ?? params.isProd,
    });

    // An ECR repository URI carries the account as a token until deploy, so the
    // construct cannot validate it at synth and says so on every synth.
    if (runtimeConfig.ecrRepository) {
      Annotations.of(this.runtime).acknowledgeInfo(
        'aws-cdk-lib.aws-bedrockagentcore:containerUriValidationSkipped',
        'ECR image URI, validated by the service at deploy time'
      );
    }

    this.agentRuntimeArn = this.runtime.agentRuntimeArn;
    this.agentRuntimeId = this.runtime.agentRuntimeId;
    this.agentRuntimeName = this.runtime.agentRuntimeName;
    this.role = this.runtime.role;
    this.applicationLogGroup = this.runtime.applicationLogGroup;

    Object.entries(additionalTags).forEach(([key, value]) => Tags.of(this).add(key, value));
  }

  /** InvokeAgentRuntime on the runtime and its endpoints (DEFAULT included). */
  public grantInvokeRuntime(identity: iam.IGrantable): iam.Grant {
    return this.runtime.grantInvokeRuntime(identity);
  }

  /**
   * Adds an environment variable once the runtime exists, for a value whose
   * resource is created after it
   */
  public addEnvironment(key: string, value: string): void {
    // agentcore.Runtime takes its environment only as a construct prop, so a
    // late value goes on its CfnRuntime child, merged over the props ones.
    const cfnRuntime = this.runtime.node.defaultChild;
    if (!CfnResource.isCfnResource(cfnRuntime)) {
      throw new Error(`AgentCore runtime '${this.agentRuntimeName}': no CloudFormation resource to add '${key}' to`);
    }
    cfnRuntime.addPropertyOverride(`EnvironmentVariables.${key}`, value);
  }

  private validateRuntimeConfig(runtimeConfig: AgentCoreRuntimeConfig): void {
    const { runtimeName, ecrRepository, artifact, imageTag } = runtimeConfig;
    if (!AGENTCORE_NAME_PATTERN.test(runtimeName)) {
      throw new Error(`AgentCore runtime '${runtimeName}': use letters, digits and underscores, starting with a letter, up to 48 characters`);
    }
    if (!ecrRepository === !artifact) {
      throw new Error(`AgentCore runtime '${runtimeName}': set exactly one of 'ecrRepository' or 'artifact'`);
    }
    if (imageTag && !ecrRepository) {
      throw new Error(`AgentCore runtime '${runtimeName}': 'imageTag' only applies to 'ecrRepository'`);
    }
  }
}
