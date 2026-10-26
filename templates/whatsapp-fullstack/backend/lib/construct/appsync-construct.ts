import { CfnOutput, Tags } from 'aws-cdk-lib';
import * as appsync from 'aws-cdk-lib/aws-appsync';
import * as iam from 'aws-cdk-lib/aws-iam';
import { RetentionDays } from 'aws-cdk-lib/aws-logs';
import { Construct } from 'constructs';
import { ParamsConfig } from '../stack/shared/util/env-config';

/**
 * Logging configuration of the GraphQL API
 */
export interface AppSyncLoggingConfig {
  fieldLogLevel?: appsync.FieldLogLevel;
  excludeVerboseContent?: boolean;
  retention?: RetentionDays;
}

/**
 * Configuration properties for the AppSync construct
 */
export interface AppSyncConstructProps {
  /**
   * Project configuration parameters
   */
  params: ParamsConfig;

  /**
   * Physical name of the GraphQL API
   */
  apiName: string;

  /**
   * Path to the schema file the API is defined by
   */
  schemaPath: string;

  /**
   * Authorization mode applied to every field without an explicit directive
   */
  defaultAuthorization: appsync.AuthorizationMode;

  /**
   * Extra authorization modes the schema directives can select
   */
  additionalAuthorizationModes?: appsync.AuthorizationMode[];

  /**
   * X-Ray tracing (default: enabled in prod only)
   */
  xrayEnabled?: boolean;

  /**
   * Introspection of the schema (default: AppSync default, enabled)
   */
  introspectionConfig?: appsync.IntrospectionConfig;

  /**
   * CloudWatch logging configuration
   */
  logging?: AppSyncLoggingConfig;

  /**
   * Additional tags to apply to resources
   */
  additionalTags?: { [key: string]: string };
}

/**
 * Generic L2 construct for AppSync GraphQL APIs
 *
 * Creates a GraphQL API from a schema file with logging and tracing defaults,
 * and exposes the data source and grant helpers a factory wires its resolvers
 * and publishers with.
 *
 * @example
 * ```typescript
 * const appSync = new AppSyncConstruct(this, 'EventsApi', {
 *   params,
 *   apiName: `${projectName}-${envName}-events-api`,
 *   schemaPath: 'src/graphql/schema.graphql',
 *   defaultAuthorization: {
 *     authorizationType: appsync.AuthorizationType.USER_POOL,
 *     userPoolConfig: { userPool },
 *   },
 *   additionalAuthorizationModes: [{ authorizationType: appsync.AuthorizationType.IAM }],
 * });
 *
 * const dataSource = appSync.addNoneDataSource('Events');
 * dataSource.createResolver('PublishEvent', {
 *   typeName: 'Mutation',
 *   fieldName: 'publishEvent',
 *   requestMappingTemplate: appsync.MappingTemplate.fromString(request),
 *   responseMappingTemplate: appsync.MappingTemplate.fromString(response),
 * });
 * appSync.grantMutation(publisherFunction, 'publishEvent');
 * ```
 */
export class AppSyncConstruct extends Construct {
  /**
   * The GraphQL API created by this construct
   */
  public readonly api: appsync.GraphqlApi;

  constructor(scope: Construct, id: string, props: AppSyncConstructProps) {
    super(scope, id);

    const {
      params,
      apiName,
      schemaPath,
      defaultAuthorization,
      additionalAuthorizationModes,
      xrayEnabled,
      introspectionConfig,
      logging = {},
      additionalTags = {},
    } = props;

    this.validateProps(apiName, schemaPath);

    this.api = new appsync.GraphqlApi(this, 'GraphqlApi', {
      name: apiName,
      definition: appsync.Definition.fromFile(schemaPath),
      authorizationConfig: {
        defaultAuthorization,
        additionalAuthorizationModes,
      },
      xrayEnabled: xrayEnabled ?? params.isProd,
      introspectionConfig,
      logConfig: {
        fieldLogLevel: logging.fieldLogLevel ?? appsync.FieldLogLevel.ERROR,
        // Verbose content is the request and response of every resolver, which
        // carries the published payload; it stays out of CloudWatch by default.
        excludeVerboseContent: logging.excludeVerboseContent ?? true,
        retention: logging.retention ?? RetentionDays.ONE_MONTH,
      },
    });

    new CfnOutput(this, 'GraphqlUrl', {
      value: this.api.graphqlUrl,
      description: `GraphQL endpoint of ${apiName}`,
    });

    new CfnOutput(this, 'GraphqlApiId', {
      value: this.api.apiId,
      description: `GraphQL API id of ${apiName}`,
    });

    this.applyTags(additionalTags);
  }

  /**
   * Adds a data source with no backend, used by local resolvers that only
   * forward their arguments to the subscribers of a mutation
   */
  public addNoneDataSource(
    id: string,
    options?: appsync.DataSourceOptions
  ): appsync.NoneDataSource {
    return this.api.addNoneDataSource(id, options);
  }

  /**
   * Grants a principal permission to call the given mutation fields
   */
  public grantMutation(grantee: iam.IGrantable, ...fields: string[]): iam.Grant {
    return this.api.grantMutation(grantee, ...fields);
  }

  /**
   * Grants a principal permission to call the given query fields
   */
  public grantQuery(grantee: iam.IGrantable, ...fields: string[]): iam.Grant {
    return this.api.grantQuery(grantee, ...fields);
  }

  /**
   * Gets the GraphQL endpoint of the API
   */
  public get graphqlUrl(): string {
    return this.api.graphqlUrl;
  }

  /**
   * Gets the id of the API
   */
  public get apiId(): string {
    return this.api.apiId;
  }

  /**
   * Gets the ARN of the API
   */
  public get apiArn(): string {
    return this.api.arn;
  }

  /**
   * Validates the configuration before the API is created
   */
  private validateProps(apiName: string, schemaPath: string): void {
    if (apiName.trim().length === 0) {
      throw new Error('AppSyncConstruct: apiName is required');
    }

    if (schemaPath.trim().length === 0) {
      throw new Error(`AppSync API '${apiName}': schemaPath is required`);
    }
  }

  /**
   * Applies tags to the API and related resources
   */
  private applyTags(tags: { [key: string]: string }): void {
    Object.entries(tags).forEach(([key, value]) => {
      Tags.of(this).add(key, value);
    });
  }
}
