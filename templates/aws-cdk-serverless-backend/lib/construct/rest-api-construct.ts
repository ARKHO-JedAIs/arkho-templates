import { RemovalPolicy, CfnOutput, Duration, Tags } from 'aws-cdk-lib';
import {
  RestApi,
  Resource,
  Method,
  LambdaIntegration,
  CognitoUserPoolsAuthorizer,
  TokenAuthorizer,
  IAuthorizer,
  AuthorizationType,
  RequestValidator,
  Model,
  CorsOptions,
  MethodOptions,
  Stage,
  AccessLogFormat,
  LogGroupLogDestination,
  EndpointType,
  SecurityPolicy,
  DomainName,
  BasePathMapping,
  MethodLoggingLevel
} from 'aws-cdk-lib/aws-apigateway';
import { ICertificate } from 'aws-cdk-lib/aws-certificatemanager';
import { IFunction } from 'aws-cdk-lib/aws-lambda';
import { LogGroup, RetentionDays } from 'aws-cdk-lib/aws-logs';
import { Construct } from 'constructs';
import { ParamsConfig } from '../stack/shared/util/env-config';
import { CognitoConstruct } from './cognito-construct';

/**
 * Configuration for CORS settings
 */
export interface RestApiCorsConfig {
  allowOrigins?: string[];
  allowMethods?: string[];
  allowHeaders?: string[];
  exposeHeaders?: string[];
  maxAge?: Duration;
  allowCredentials?: boolean;
}

/**
 * Configuration for throttling settings
 */
export interface RestApiThrottleConfig {
  burstLimit?: number;
  rateLimit?: number;
}

/**
 * Configuration for a REST API route
 */
export interface RestApiRouteConfig {
  path: string;
  method: string;
  lambda: IFunction;
  requireAuth?: boolean; // Default: true (protected by default)
  authorizationScopes?: string[];
  requestValidator?: 'body' | 'parameters' | 'body-and-parameters' | 'none';
  requestModels?: { [contentType: string]: Model };
  methodResponses?: Array<{
    statusCode: string;
    responseModels?: { [contentType: string]: Model };
    responseParameters?: { [param: string]: boolean };
  }>;
}

/**
 * Configuration for custom domain
 */
export interface RestApiDomainConfig {
  domainName: string;
  certificate: ICertificate;
  basePath?: string;
  endpointType?: EndpointType;
  securityPolicy?: SecurityPolicy;
}

/**
 * Properties for the API Gateway construct
 */
export interface RestApiConstructProps {
  /**
   * Project configuration parameters
   */
  params: ParamsConfig;

  /**
   * Cognito construct for authentication (optional if using Lambda authorizer)
   */
  cognitoConstruct?: CognitoConstruct;

  /**
   * Lambda function for authorizer (optional, alternative to Cognito)
   */
  authorizerFunction?: IFunction;

  /**
   * Authorizer type to use
   * @default 'cognito'
   */
  authorizerType?: 'cognito' | 'lambda';

  /**
   * Name of the API (optional, defaults to project-env-api)
   */
  apiName?: string;

  /**
   * Description of the API
   */
  description?: string;

  /**
   * CORS configuration
   */
  corsConfig?: RestApiCorsConfig;

  /**
   * Throttling configuration
   */
  throttleConfig?: RestApiThrottleConfig;

  /**
   * Routes configuration
   */
  routes?: RestApiRouteConfig[];

  /**
   * Custom domain configuration
   */
  domainConfig?: RestApiDomainConfig;

  /**
   * Whether to enable access logging
   */
  enableAccessLogs?: boolean;

  /**
   * Log retention for access logs
   */
  logRetention?: RetentionDays;

  /**
   * Whether to create CloudFormation outputs
   */
  createOutputs?: boolean;

  /**
   * Additional tags
   */
  tags?: { [key: string]: string };
}

/**
 * Generic L2 construct for Amazon API Gateway REST API
 * 
 * This construct provides a simplified interface for creating REST APIs
 * with common configurations and best practices included.
 * 
 */
export class RestApiConstruct extends Construct {
  /**
   * The REST API created by this construct
   */
  public readonly restApi: RestApi;

  /**
   * The deployment stage
   */
  public readonly stage: Stage;

  /**
   * The Cognito authorizer (if configured)
   */
  public readonly cognitoAuthorizer?: CognitoUserPoolsAuthorizer;

  /**
   * The Lambda authorizer (if configured)
   */
  public readonly lambdaAuthorizerRef?: TokenAuthorizer;

  /**
   * The active authorizer being used
   */
  public readonly authorizer?: IAuthorizer;

  /**
   * Access log group (if enabled)
   */
  public readonly accessLogGroup?: LogGroup;

  /**
   * Custom domain (if configured)
   */
  public readonly domainName?: DomainName;

  /**
   * Created resources for reference
   */
  public readonly resources: Map<string, Resource> = new Map();

  /**
   * Created methods for reference
   */
  public readonly methods: Map<string, Method> = new Map();

  /**
   * Store params for use in outputs
   */
  private readonly params: ParamsConfig;

  constructor(scope: Construct, id: string, props: RestApiConstructProps) {
    super(scope, id);

    const {
      params,
      cognitoConstruct,
      authorizerFunction,
      authorizerType = 'cognito',
      apiName,
      description,
      corsConfig = {},
      throttleConfig = {},
      routes = [],
      domainConfig,
      enableAccessLogs = true,
      logRetention = RetentionDays.ONE_MONTH,
      createOutputs = true,
      tags = {}
    } = props;

    // Store params for later use
    this.params = params;

    const { envName, projectName, isProd } = params;

    // Create access log group if enabled
    if (enableAccessLogs) {
      this.accessLogGroup = new LogGroup(this, 'AccessLogGroup', {
        logGroupName: `/aws/apigateway/${projectName}-${envName}-access-logs`,
        retention: logRetention,
        removalPolicy: isProd ? RemovalPolicy.RETAIN : RemovalPolicy.DESTROY,
      });
    }

    // Create REST API
    this.restApi = new RestApi(this, 'RestApi', {
      restApiName: apiName || `${projectName}-${envName}-api`,
      description: description || `REST API for ${projectName} ${envName} environment`,

      // Default CORS configuration
      defaultCorsPreflightOptions: this.buildCorsOptions(corsConfig),

      // CloudWatch role for logging
      cloudWatchRole: true,

      // Deploy options
      deploy: true,
      deployOptions: {
        stageName: envName,
        throttlingBurstLimit: throttleConfig.burstLimit || 100,
        throttlingRateLimit: throttleConfig.rateLimit || 50,

        // Access logging
        ...(this.accessLogGroup && {
          accessLogDestination: new LogGroupLogDestination(this.accessLogGroup),
          accessLogFormat: AccessLogFormat.jsonWithStandardFields({
            caller: true,
            httpMethod: true,
            ip: true,
            protocol: true,
            requestTime: true,
            resourcePath: true,
            responseLength: true,
            status: true,
            user: true,
          }),
        }),

        // Metrics and tracing
        metricsEnabled: true,
        tracingEnabled: isProd ? false : true, // Enable tracing in non-prod for debugging
        dataTraceEnabled: !isProd, // Disable data tracing in prod for security
        loggingLevel: isProd ? MethodLoggingLevel.ERROR : MethodLoggingLevel.INFO,
      },

      // Policy and binary media types
      binaryMediaTypes: ['image/*', 'application/pdf'],

      // Endpoint configuration
      endpointConfiguration: {
        types: [EndpointType.REGIONAL]
      },

      // Default method options - all routes protected by default
      defaultMethodOptions: {
        authorizationType: authorizerType === 'lambda'
          ? AuthorizationType.CUSTOM
          : AuthorizationType.COGNITO,
        authorizer: this.authorizer,
      }
    });

    // Get the deployment stage
    this.stage = this.restApi.deploymentStage;

    // Setup authorizer based on type (after RestApi is created)
    if (authorizerType === 'lambda' && authorizerFunction) {
      // Create Lambda authorizer with the RestApi
      this.lambdaAuthorizerRef = new TokenAuthorizer(this, 'LambdaAuthorizer', {
        handler: authorizerFunction,
        authorizerName: `${projectName}-${envName}-lambda-authorizer`,
        identitySource: 'method.request.header.Authorization',
        resultsCacheTtl: Duration.minutes(5),
      });
      this.authorizer = this.lambdaAuthorizerRef;
    } else if (authorizerType === 'cognito' && cognitoConstruct) {
      // Create Cognito authorizer using the provided Cognito construct
      // Note: Cognito User Pool Authorizer validates BOTH Access Tokens and ID Tokens
      // It checks the token signature, expiration, and issuer automatically
      this.cognitoAuthorizer = new CognitoUserPoolsAuthorizer(this, 'CognitoAuthorizer', {
        cognitoUserPools: [cognitoConstruct.userPool],
        identitySource: 'method.request.header.Authorization',
        authorizerName: `${projectName}-${envName}-cognito-authorizer`,
        resultsCacheTtl: Duration.minutes(5),
      });
      this.authorizer = this.cognitoAuthorizer;
    } else {
      throw new Error('Either cognitoConstruct or authorizerFunction must be provided based on authorizerType');
    }

    // Create request validators
    const validators = this.createRequestValidators();

    // Create routes
    this.createRoutes(routes, validators);

    // Create custom domain if configured
    if (domainConfig) {
      this.createCustomDomain(domainConfig);
    }

    // Create CloudFormation outputs
    if (createOutputs) {
      this.createOutputs();
    }

    // Apply tags
    this.applyTags(tags);
  }

  /**
   * Builds CORS options from configuration
   */
  private buildCorsOptions(corsConfig: RestApiCorsConfig): CorsOptions {
    return {
      allowOrigins: corsConfig.allowOrigins || ['*'],
      allowMethods: corsConfig.allowMethods || ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
      allowHeaders: corsConfig.allowHeaders || [
        'Content-Type',
        'Authorization',
        'X-Requested-With',
        'Accept',
        'Origin',
        'X-Api-Key'
      ],
      exposeHeaders: corsConfig.exposeHeaders || [],
      maxAge: corsConfig.maxAge || Duration.hours(24),
      allowCredentials: corsConfig.allowCredentials || false,
    };
  }

  /**
   * Creates request validators
   */
  private createRequestValidators(): Record<string, RequestValidator> {
    return {
      'body': new RequestValidator(this, 'BodyValidator', {
        restApi: this.restApi,
        validateRequestBody: true,
        validateRequestParameters: false,
      }),
      'parameters': new RequestValidator(this, 'ParametersValidator', {
        restApi: this.restApi,
        validateRequestBody: false,
        validateRequestParameters: true,
      }),
      'body-and-parameters': new RequestValidator(this, 'BodyAndParametersValidator', {
        restApi: this.restApi,
        validateRequestBody: true,
        validateRequestParameters: true,
      }),
    };
  }

  /**
   * Creates API routes from configuration
   */
  private createRoutes(routes: RestApiRouteConfig[], validators: Record<string, RequestValidator>): void {
    routes.forEach((routeConfig, index) => {
      const { path, method, lambda, requireAuth = true, requestValidator, methodResponses } = routeConfig;

      // Get or create resource
      const resource = this.getOrCreateResource(path);

      // Create method options - protected by default
      const methodOptions: MethodOptions = {
        authorizationType: requireAuth
          ? (this.lambdaAuthorizerRef ? AuthorizationType.CUSTOM : AuthorizationType.COGNITO)
          : AuthorizationType.NONE,
        authorizer: requireAuth ? this.authorizer : undefined,
        authorizationScopes: requireAuth ? routeConfig.authorizationScopes : undefined,
        requestValidator: requestValidator && requestValidator !== 'none'
          ? validators[requestValidator]
          : undefined,
        requestModels: routeConfig.requestModels,
        methodResponses,
      };

      // Create Lambda integration
      const integration = new LambdaIntegration(lambda, {
        proxy: true,
        allowTestInvoke: true,
      });

      // Create method
      const apiMethod = resource.addMethod(method.toUpperCase(), integration, methodOptions);

      // Store method for reference
      this.methods.set(`${method.toUpperCase()}-${path}`, apiMethod);
    });
  }

  /**
   * Gets or creates a resource for the given path
   */
  private getOrCreateResource(path: string): Resource {
    // Remove leading slash if present
    const cleanPath = path.startsWith('/') ? path.substring(1) : path;

    if (!cleanPath) {
      return this.restApi.root as Resource;
    }

    // Check if resource already exists
    if (this.resources.has(cleanPath)) {
      return this.resources.get(cleanPath)!;
    }

    // Split path into segments
    const segments = cleanPath.split('/');
    let currentResource: Resource = this.restApi.root as Resource;
    let currentPath = '';

    // Create resources for each segment
    for (const segment of segments) {
      currentPath = currentPath ? `${currentPath}/${segment}` : segment;

      if (!this.resources.has(currentPath)) {
        currentResource = currentResource.addResource(segment) as Resource;
        this.resources.set(currentPath, currentResource);
      } else {
        currentResource = this.resources.get(currentPath)!;
      }
    }

    return currentResource;
  }

  /**
   * Creates custom domain configuration
   */
  private createCustomDomain(domainConfig: RestApiDomainConfig): void {
    const customDomain = new DomainName(this, 'CustomDomain', {
      domainName: domainConfig.domainName,
      certificate: domainConfig.certificate,
      endpointType: domainConfig.endpointType || EndpointType.REGIONAL,
      securityPolicy: domainConfig.securityPolicy || SecurityPolicy.TLS_1_2,
    });

    // Store reference to domain name (read-only property)
    Object.defineProperty(this, 'domainName', {
      value: customDomain,
      writable: false,
      enumerable: true,
      configurable: false
    });

    new BasePathMapping(this, 'BasePathMapping', {
      domainName: customDomain,
      restApi: this.restApi,
      basePath: domainConfig.basePath,
      stage: this.stage,
    });
  }

  /**
   * Creates CloudFormation outputs
   */
  private createOutputs(): void {
    const { envName, projectName } = this.params;

    new CfnOutput(this, 'RestApiId', {
      value: this.restApi.restApiId,
      description: 'REST API ID',
      exportName: `${projectName}-${envName}-RestApiId`,
    });

    new CfnOutput(this, 'RestApiUrl', {
      value: this.restApi.url,
      description: 'REST API URL',
      exportName: `${projectName}-${envName}-RestApiUrl`,
    });

    new CfnOutput(this, 'RestApiArn', {
      value: `arn:aws:apigateway:${this.restApi.env.region}::/restapis/${this.restApi.restApiId}`,
      description: 'REST API ARN',
      exportName: `${projectName}-${envName}-RestApiArn`,
    });

    if (this.domainName) {
      new CfnOutput(this, 'CustomDomainName', {
        value: this.domainName.domainName,
        description: 'Custom domain name',
        exportName: `${projectName}-${envName}-CustomDomain`,
      });
    }
  }

  /**
   * Applies tags to resources
   */
  private applyTags(tags: { [key: string]: string }): void {
    Object.entries(tags).forEach(([key, value]) => {
      Tags.of(this).add(key, value);
    });
  }

  /**
   * Adds a new route to the API
   */
  public addRoute(routeConfig: RestApiRouteConfig): Method {
    const validators = this.createRequestValidators();
    const { path, method, lambda, requireAuth = true, requestValidator, methodResponses } = routeConfig;

    const resource = this.getOrCreateResource(path);

    const methodOptions: MethodOptions = {
      authorizationType: requireAuth
        ? (this.lambdaAuthorizerRef ? AuthorizationType.CUSTOM : AuthorizationType.COGNITO)
        : AuthorizationType.NONE,
      authorizer: requireAuth ? this.authorizer : undefined,
      authorizationScopes: requireAuth ? routeConfig.authorizationScopes : undefined,
      requestValidator: requestValidator && requestValidator !== 'none'
        ? validators[requestValidator]
        : undefined,
      requestModels: routeConfig.requestModels,
      methodResponses,
    };

    const integration = new LambdaIntegration(lambda, {
      proxy: true,
      allowTestInvoke: true,
    });

    const apiMethod = resource.addMethod(method.toUpperCase(), integration, methodOptions);
    this.methods.set(`${method.toUpperCase()}-${path}`, apiMethod);

    return apiMethod;
  }

  /**
   * Gets the API URL
   */
  public get apiUrl(): string {
    return this.restApi.url;
  }

  /**
   * Gets the API ID
   */
  public get apiId(): string {
    return this.restApi.restApiId;
  }

  /**
   * Gets the API ARN
   */
  public get apiArn(): string {
    return `arn:aws:apigateway:${this.restApi.env.region}::/restapis/${this.restApi.restApiId}`;
  }

  /**
   * Adds a catch-all route for handling 404 errors
   */
  public addNotFoundHandler(lambda: IFunction): void {
    // Add catch-all route for ANY method on {proxy+}
    const proxyResource = this.restApi.root.addResource('{proxy+}');

    const integration = new LambdaIntegration(lambda, {
      proxy: true,
      allowTestInvoke: true,
    });

    // Add ANY method without authorization
    proxyResource.addMethod('ANY', integration, {
      authorizationType: AuthorizationType.NONE,
    });

    // Also handle root path
    this.restApi.root.addMethod('ANY', integration, {
      authorizationType: AuthorizationType.NONE,
    });
  }
}
