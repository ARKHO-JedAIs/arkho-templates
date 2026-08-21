import { Construct } from 'constructs';
import { LayerVersion, Runtime, Code, Architecture } from 'aws-cdk-lib/aws-lambda';
import { RemovalPolicy, CfnOutput, Tags } from 'aws-cdk-lib';
import { ParamsConfig } from '../stack/shared/util/env-config';

/**
 * Configuration for Lambda Layer
 */
export interface LayerConfig {
  /**
   * Name of the layer
   */
  layerName: string;

  /**
   * Description of the layer
   */
  description?: string;

  /**
   * Source code of the layer
   */
  code: Code;

  /**
   * Compatible runtimes for the layer
   */
  compatibleRuntimes: Runtime[];

  /**
   * Compatible architectures for the layer
   */
  compatibleArchitectures?: Architecture[];

  /**
   * License information
   */
  license?: string;

  /**
   * Removal policy for the layer
   */
  removalPolicy?: RemovalPolicy;
}

/**
 * Properties for the Layer construct
 */
export interface LayerConstructProps {
  /**
   * Project configuration parameters
   */
  params: ParamsConfig;

  /**
   * Layer configuration
   */
  layerConfig: LayerConfig;

  /**
   * Whether to create CloudFormation outputs
   */
  createOutputs?: boolean;

  /**
   * Additional tags to apply
   */
  tags?: { [key: string]: string };
}

/**
 * Generic L2 construct for Lambda Layers
 * 
 * This construct provides a simplified interface for creating Lambda Layers
 * with common configurations and best practices included.
 * 
 * @example
 * ```typescript
 * const pythonLayer = new LayerConstruct(this, 'PythonCommonLayer', {
 *   params,
 *   layerConfig: {
 *     layerName: 'python-common-layer',
 *     description: 'Common utilities for Python Lambda functions',
 *     code: Code.fromAsset('src/layers/python-common'),
 *     compatibleRuntimes: [Runtime.PYTHON_3_12],
 *     compatibleArchitectures: [Architecture.X86_64, Architecture.ARM_64],
 *     license: 'MIT'
 *   }
 * });
 * 
 * // Grant usage to specific account
 * pythonLayer.grantUsageToAccount('123456789012');
 * 
 * // Or make it public (use with caution)
 * pythonLayer.grantPublicUsage();
 * ```
 */
export class LayerConstruct extends Construct {
  /**
   * The Lambda Layer created by this construct
   */
  public readonly layer: LayerVersion;

  /**
   * The ARN of the layer
   */
  public readonly layerArn: string;

  /**
   * The version ARN of the layer
   */
  public readonly layerVersionArn: string;

  constructor(scope: Construct, id: string, props: LayerConstructProps) {
    super(scope, id);

    const {
      params,
      layerConfig,
      createOutputs = true,
      tags = {}
    } = props;

    const isProd = params.isProd;

    // Create Lambda Layer
    this.layer = new LayerVersion(this, 'Layer', {
      layerVersionName: layerConfig.layerName,
      description: layerConfig.description || `Lambda layer for ${layerConfig.layerName}`,
      code: layerConfig.code,
      compatibleRuntimes: layerConfig.compatibleRuntimes,
      compatibleArchitectures: layerConfig.compatibleArchitectures || [Architecture.X86_64],
      license: layerConfig.license,
      removalPolicy: layerConfig.removalPolicy || (isProd ? RemovalPolicy.RETAIN : RemovalPolicy.DESTROY),
    });

    // Store references
    this.layerArn = this.layer.layerVersionArn;
    this.layerVersionArn = this.layer.layerVersionArn;

    // Create CloudFormation outputs if requested
    if (createOutputs) {
      new CfnOutput(this, 'LayerArn', {
        value: this.layerArn,
        description: `Lambda Layer ARN for ${layerConfig.layerName}`,
        exportName: `${params.projectName}-${params.envName}-${layerConfig.layerName}-LayerArn`
      });

      new CfnOutput(this, 'LayerVersionArn', {
        value: this.layerVersionArn,
        description: `Lambda Layer Version ARN for ${layerConfig.layerName}`,
        exportName: `${params.projectName}-${params.envName}-${layerConfig.layerName}-LayerVersionArn`
      });
    }

    // Apply tags
    this.applyTags(tags);
  }

  /**
   * Applies tags to the layer
   */
  private applyTags(tags: { [key: string]: string }): void {
    Object.entries(tags).forEach(([key, value]) => {
      Tags.of(this).add(key, value);
    });
  }

  /**
   * Gets the layer ARN
   */
  public get arn(): string {
    return this.layerArn;
  }

  /**
   * Gets the layer version ARN
   */
  public get versionArn(): string {
    return this.layerVersionArn;
  }

  /**
   * Grants permission for a specific AWS account to use this layer
   */
  public grantUsageToAccount(accountId: string): void {
    this.layer.addPermission('LayerUsagePermissionAccount', {
      accountId,
    });
  }

  /**
   * Grants permission for all AWS accounts to use this layer (public layer)
   */
  public grantPublicUsage(): void {
    this.layer.addPermission('LayerUsagePermissionPublic', {
      accountId: '*',
    });
  }

  /**
   * Grants permission for the current AWS account to use this layer
   */
  public grantUsageToCurrentAccount(): void {
    this.layer.addPermission('LayerUsagePermissionCurrent', {
      accountId: this.layer.stack.account,
    });
  }

  /**
   * Creates a layer for Python common utilities
   */
  public static createPythonCommonLayer(
    scope: Construct,
    id: string,
    params: ParamsConfig,
    options?: {
      description?: string;
      compatibleRuntimes?: Runtime[];
      tags?: { [key: string]: string };
    }
  ): LayerConstruct {
    return new LayerConstruct(scope, id, {
      params,
      layerConfig: {
        layerName: 'python-common',
        description: options?.description || 'Common Python utilities and dependencies',
        code: Code.fromAsset('src/layer/python-common'),
        compatibleRuntimes: options?.compatibleRuntimes || [Runtime.PYTHON_3_12],
        compatibleArchitectures: [Architecture.X86_64, Architecture.ARM_64],
        license: 'MIT'
      },
      tags: {
        Type: 'PythonLayer',
        Purpose: 'CommonUtilities',
        ...options?.tags
      }
    });
  }

  /**
   * Creates a layer for Node.js common utilities
   */
  public static createNodeCommonLayer(
    scope: Construct,
    id: string,
    params: ParamsConfig,
    options?: {
      description?: string;
      compatibleRuntimes?: Runtime[];
      tags?: { [key: string]: string };
    }
  ): LayerConstruct {
    return new LayerConstruct(scope, id, {
      params,
      layerConfig: {
        layerName: 'node-common',
        description: options?.description || 'Common utilities for Node.js Lambda functions',
        code: Code.fromAsset('src/layer/node-common'),
        compatibleRuntimes: options?.compatibleRuntimes || [Runtime.NODEJS_20_X],
        compatibleArchitectures: [Architecture.X86_64, Architecture.ARM_64],
        license: 'MIT'
      },
      tags: {
        Type: 'NodeLayer',
        Purpose: 'CommonUtilities',
        ...options?.tags
      }
    });
  }

  /**
   * Creates a layer for shared dependencies
   */
  public static createDependenciesLayer(
    scope: Construct,
    id: string,
    params: ParamsConfig,
    config: {
      layerName: string;
      assetPath: string;
      runtime: Runtime;
      description?: string;
      tags?: { [key: string]: string };
    }
  ): LayerConstruct {
    return new LayerConstruct(scope, id, {
      params,
      layerConfig: {
        layerName: config.layerName,
        description: config.description || `Dependencies layer for ${config.runtime.name}`,
        code: Code.fromAsset(config.assetPath),
        compatibleRuntimes: [config.runtime],
        compatibleArchitectures: [Architecture.X86_64, Architecture.ARM_64],
        license: 'MIT'
      },
      tags: {
        Type: 'DependenciesLayer',
        Runtime: config.runtime.name,
        ...config.tags
      }
    });
  }
}
