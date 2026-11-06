import { Construct } from 'constructs';
import * as ssm from 'aws-cdk-lib/aws-ssm';
import * as iam from 'aws-cdk-lib/aws-iam';
import { Tags } from 'aws-cdk-lib';
import { ParamsConfig } from '../stack/shared/util/env-config';

/**
 * Interface for a Parameter Store parameter configuration
 *
 * A parameter holds either a string value or a string list value. SecureString
 * parameters are not created here: CloudFormation cannot create them, and
 * secrets belong in Secrets Manager.
 */
export interface SsmParameterConfig {
  key: string;
  parameterName: string;
  stringValue?: string;
  stringListValue?: string[];
  description?: string;
  tier?: ssm.ParameterTier;
  dataType?: ssm.ParameterDataType;
  allowedPattern?: string;
  simpleName?: boolean;
}

/**
 * Interface for SSM parameters construct properties
 */
export interface SsmParametersConstructProps {
  params: ParamsConfig;
  parameterConfigs: SsmParameterConfig[];
  additionalTags?: { [key: string]: string };
}

/**
 * Level 2 SSM Construct for creating and configuring Parameter Store
 * parameters
 *
 * This construct creates a group of parameters and indexes them by their
 * configuration key, so callers reference a parameter by key instead of
 * rebuilding its path.
 *
 * @example
 * ```typescript
 * const ssmParameters = new SsmParametersConstruct(this, 'MySsmParameters', {
 *   params: config.params,
 *   parameterConfigs: [
 *     {
 *       key: 'modelsConfig',
 *       parameterName: '/my-app/dev/models-config',
 *       stringValue: JSON.stringify({ retry: {} }),
 *       description: 'Model fallback chain'
 *     },
 *     {
 *       key: 'allowedOrigins',
 *       parameterName: '/my-app/dev/allowed-origins',
 *       stringListValue: ['https://myapp.com']
 *     }
 *   ]
 * });
 *
 * ssmParameters.grantRead(myLambda, 'modelsConfig');
 * ```
 */
export class SsmParametersConstruct extends Construct {
  /**
   * The parameters created by this construct, indexed by configuration key
   */
  public readonly parameters: { [key: string]: ssm.IParameter };

  constructor(scope: Construct, id: string, props: SsmParametersConstructProps) {
    super(scope, id);

    const { parameterConfigs, additionalTags = {} } = props;

    this.validateParameterConfigs(parameterConfigs);

    // Create the parameters
    this.parameters = {};

    parameterConfigs.forEach((parameterConfig) => {
      const commonOptions: ssm.ParameterOptions = {
        parameterName: parameterConfig.parameterName,
        description: parameterConfig.description,
        tier: parameterConfig.tier,
        allowedPattern: parameterConfig.allowedPattern,
        simpleName: parameterConfig.simpleName,
      };

      this.parameters[parameterConfig.key] =
        parameterConfig.stringListValue !== undefined
          ? new ssm.StringListParameter(this, parameterConfig.key, {
              ...commonOptions,
              stringListValue: parameterConfig.stringListValue,
            })
          : new ssm.StringParameter(this, parameterConfig.key, {
              ...commonOptions,
              stringValue: parameterConfig.stringValue!,
              dataType: parameterConfig.dataType,
            });
    });

    // Apply tags
    this.applyTags(additionalTags);
  }

  /**
   * Returns the parameter registered under a configuration key
   */
  public getParameter(key: string): ssm.IParameter {
    const parameter = this.parameters[key];

    if (!parameter) {
      throw new Error(`SSM parameter '${key}' is not defined in this construct`);
    }

    return parameter;
  }

  /**
   * Returns the name of the parameter registered under a configuration key
   */
  public getParameterName(key: string): string {
    return this.getParameter(key).parameterName;
  }

  /**
   * Grants read permissions on the given parameters, or on every parameter of
   * this construct when no key is given
   */
  public grantRead(identity: iam.IGrantable, ...keys: string[]): iam.Grant[] {
    return this.resolveKeys(keys).map((key) => this.getParameter(key).grantRead(identity));
  }

  /**
   * Grants write permissions on the given parameters, or on every parameter of
   * this construct when no key is given
   */
  public grantWrite(identity: iam.IGrantable, ...keys: string[]): iam.Grant[] {
    return this.resolveKeys(keys).map((key) => this.getParameter(key).grantWrite(identity));
  }

  /**
   * Returns the given keys, defaulting to every key of this construct
   */
  private resolveKeys(keys: string[]): string[] {
    return keys.length > 0 ? keys : Object.keys(this.parameters);
  }

  /**
   * Validates the parameter configurations before the parameters are created
   */
  private validateParameterConfigs(parameterConfigs: SsmParameterConfig[]): void {
    if (parameterConfigs.length === 0) {
      throw new Error('SSM parameters: at least one parameter configuration is required');
    }

    const duplicatedKeys = parameterConfigs
      .map((parameterConfig) => parameterConfig.key)
      .filter((key, index, keys) => keys.indexOf(key) !== index);

    if (duplicatedKeys.length > 0) {
      throw new Error(
        `SSM parameters: duplicated configuration keys ${[...new Set(duplicatedKeys)].join(', ')}`
      );
    }

    const duplicatedNames = parameterConfigs
      .map((parameterConfig) => parameterConfig.parameterName)
      .filter((parameterName, index, names) => names.indexOf(parameterName) !== index);

    if (duplicatedNames.length > 0) {
      throw new Error(
        `SSM parameters: duplicated parameter names ${[...new Set(duplicatedNames)].join(', ')}`
      );
    }

    parameterConfigs.forEach(({ key, stringValue, stringListValue, dataType }) => {
      if ((stringValue !== undefined) === (stringListValue !== undefined)) {
        throw new Error(
          `SSM parameter '${key}': set exactly one of 'stringValue' or 'stringListValue'`
        );
      }

      if (dataType && stringListValue) {
        throw new Error(`SSM parameter '${key}': 'dataType' only applies to 'stringValue'`);
      }
    });
  }

  /**
   * Applies tags to the parameters and related resources
   */
  private applyTags(tags: { [key: string]: string }): void {
    Object.entries(tags).forEach(([key, value]) => {
      Tags.of(this).add(key, value);
    });
  }
}
