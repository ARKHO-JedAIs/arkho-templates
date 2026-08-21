import { RemovalPolicy, CfnOutput, Duration, Tags } from 'aws-cdk-lib';
import {
  UserPool,
  UserPoolClient,
  UserPoolResourceServer,
  ResourceServerScope,
  AccountRecovery,
  SignInAliases,
  AutoVerifiedAttrs,
  PasswordPolicy,
  UserPoolTriggers,
  OAuthScope,
  OAuthFlows,
  StringAttribute,
  NumberAttribute,
  BooleanAttribute,
  DateTimeAttribute,
  UserPoolIdentityProviderOidc,
  OidcAttributeRequestMethod,
  ProviderAttribute,
  UserPoolClientIdentityProvider,
  UserPoolDomain
} from 'aws-cdk-lib/aws-cognito';
import { IFunction } from 'aws-cdk-lib/aws-lambda';
import { Construct } from 'constructs';
import { ParamsConfig } from '../stack/shared/util/env-config';

/**
 * Configuration for Cognito User Pool
 */
export interface CognitoUserPoolConfig {
  /**
   * Name of the user pool
   */
  userPoolName?: string;

  /**
   * Whether self sign-up is enabled
   */
  selfSignUpEnabled?: boolean;

  /**
   * Sign-in aliases configuration
   */
  signInAliases?: SignInAliases;

  /**
   * Auto-verification configuration
   */
  autoVerify?: AutoVerifiedAttrs;

  /**
   * Password policy configuration
   */
  passwordPolicy?: PasswordPolicy;

  /**
   * Account recovery method
   */
  accountRecovery?: AccountRecovery;

  /**
   * Lambda triggers for Cognito events
   */
  lambdaTriggers?: UserPoolTriggers;

  /**
   * Removal policy for the user pool
   */
  removalPolicy?: RemovalPolicy;

  /**
   * Custom attributes configuration
   */
  customAttributes?: {
    /**
     * String custom attributes
     */
    stringAttributes?: {
      [key: string]: {
        mutable?: boolean;
        minLen?: number;
        maxLen?: number;
      };
    };

    /**
     * Number custom attributes
     */
    numberAttributes?: {
      [key: string]: {
        mutable?: boolean;
        min?: number;
        max?: number;
      };
    };

    /**
     * Boolean custom attributes
     */
    booleanAttributes?: {
      [key: string]: {
        mutable?: boolean;
      };
    };

    /**
     * DateTime custom attributes
     */
    dateTimeAttributes?: {
      [key: string]: {
        mutable?: boolean;
      };
    };
  };

  /**
   * Standard attributes to enable
   */
  standardAttributes?: {
    email?: { required?: boolean; mutable?: boolean };
    phoneNumber?: { required?: boolean; mutable?: boolean };
    givenName?: { required?: boolean; mutable?: boolean };
    familyName?: { required?: boolean; mutable?: boolean };
    address?: { required?: boolean; mutable?: boolean };
    birthdate?: { required?: boolean; mutable?: boolean };
    gender?: { required?: boolean; mutable?: boolean };
    locale?: { required?: boolean; mutable?: boolean };
    middleName?: { required?: boolean; mutable?: boolean };
    name?: { required?: boolean; mutable?: boolean };
    nickname?: { required?: boolean; mutable?: boolean };
    picture?: { required?: boolean; mutable?: boolean };
    preferredUsername?: { required?: boolean; mutable?: boolean };
    profile?: { required?: boolean; mutable?: boolean };
    timezone?: { required?: boolean; mutable?: boolean };
    updatedAt?: { required?: boolean; mutable?: boolean };
    website?: { required?: boolean; mutable?: boolean };
  };
}

/**
 * Configuration for Cognito User Pool Client
 */
export interface CognitoUserPoolClientConfig {
  /**
   * Name of the user pool client
   */
  userPoolClientName?: string;

  /**
   * Whether to generate a client secret
   */
  generateSecret?: boolean;

  /**
   * Authentication flows configuration
   */
  authFlows?: {
    userPassword?: boolean;
    userSrp?: boolean;
    custom?: boolean;
    adminUserPassword?: boolean;
  };

  /**
   * Token validity periods (in days)
   */
  tokenValidity?: {
    accessToken?: number;
    idToken?: number;
    refreshToken?: number;
  };

  /**
   * OAuth configuration
   */
  oAuth?: {
    flows?: OAuthFlows;
    scopes?: OAuthScope[];
    callbackUrls?: string[];
    logoutUrls?: string[];
  };

  /**
   * Resource server configuration for custom scopes
   */
  resourceServer?: {
    identifier: string;
    name: string;
    scopes: Array<{
      scopeName: string;
      scopeDescription: string;
    }>;
  };
}

/**
 * Optional Microsoft Entra ID (OIDC) federation for the User Pool.
 *
 * When enabled, an OIDC identity provider is created and added to the User
 * Pool Client alongside the native Cognito provider. A Hosted UI domain is
 * required for federation, so `domainPrefix` must be supplied (here or via
 * CognitoConstructProps.domainPrefix).
 */
export interface CognitoEntraIdConfig {
  enabled: boolean;
  clientId?: string;
  clientSecret?: string;
  /**
   * Entra ID OIDC issuer, e.g. https://login.microsoftonline.com/<tenantId>/v2.0
   */
  issuerUrl?: string;
  scopes?: string[];
}

/**
 * Properties for the Cognito construct
 */
export interface CognitoConstructProps {
  /**
   * Project configuration parameters
   */
  params: ParamsConfig;

  /**
   * User pool configuration
   */
  userPoolConfig?: CognitoUserPoolConfig;

  /**
   * User pool client configuration
   */
  userPoolClientConfig?: CognitoUserPoolClientConfig;

  /**
   * Optional Microsoft Entra ID (OIDC) federation. Disabled by default.
   */
  entraId?: CognitoEntraIdConfig;

  /**
   * Hosted UI domain prefix. Required when Entra ID federation is enabled.
   */
  domainPrefix?: string;

  /**
   * Lambda functions for Cognito triggers
   */
  lambdaTriggers?: {
    preSignUp?: IFunction;
    postConfirmation?: IFunction;
    preAuthentication?: IFunction;
    postAuthentication?: IFunction;
    preTokenGeneration?: IFunction;
    customMessage?: IFunction;
    defineAuthChallenge?: IFunction;
    createAuthChallenge?: IFunction;
    verifyAuthChallengeResponse?: IFunction;
  };

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
 * Generic L2 construct for Amazon Cognito User Pool and Client
 * 
 * This construct provides a simplified interface for creating Cognito User Pools
 * with common configurations and best practices included.
 * 
 * @example
 * ```typescript
 * const cognitoAuth = new CognitoConstruct(this, 'CognitoAuth', {
 *   params,
 *   userPoolConfig: {
 *     selfSignUpEnabled: true,
 *     signInAliases: { email: true },
 *     passwordPolicy: {
 *       minLength: 8,
 *       requireUppercase: true,
 *       requireLowercase: true,
 *       requireDigits: true,
 *     },
 *     // Custom attributes configuration
 *     customAttributes: {
 *       stringAttributes: {
 *         'userType': { mutable: true, minLen: 1, maxLen: 50 },
 *         'department': { mutable: true, minLen: 1, maxLen: 100 },
 *       },
 *       numberAttributes: {
 *         'employeeId': { mutable: false, min: 1, max: 999999 },
 *       },
 *       booleanAttributes: {
 *         'isActive': { mutable: true },
 *       },
 *       dateTimeAttributes: {
 *         'lastLogin': { mutable: true },
 *       },
 *     },
 *     // Standard attributes configuration
 *     standardAttributes: {
 *       email: { required: true, mutable: true },
 *       phoneNumber: { required: false, mutable: true },
 *       givenName: { required: false, mutable: true },
 *       familyName: { required: false, mutable: true },
 *     }
 *   },
 *   lambdaTriggers: {
 *     preSignUp: lambdaFunctions.preSignupLambda.function,
 *     postConfirmation: lambdaFunctions.postConfirmationSignupLambda.function
 *   }
 * });
 * ```
 */
export class CognitoConstruct extends Construct {
  /**
   * The Cognito User Pool created by this construct
   */
  public readonly userPool: UserPool;

  /**
   * The Cognito User Pool Client created by this construct
   */
  public readonly userPoolClient: UserPoolClient;

  /**
   * The Cognito Resource Server (if configured)
   */
  public readonly resourceServer?: UserPoolResourceServer;

  /**
   * The Entra ID OIDC identity provider (if enabled)
   */
  public readonly entraIdProvider?: UserPoolIdentityProviderOidc;

  /**
   * The Hosted UI domain (if a domain prefix was provided)
   */
  public readonly domain?: UserPoolDomain;

  /**
   * The Resource Server Scopes (if configured)
   */
  private readonly resourceServerScopes?: ResourceServerScope[];

  constructor(scope: Construct, id: string, props: CognitoConstructProps) {
    super(scope, id);

    const {
      params,
      userPoolConfig = {},
      userPoolClientConfig = {},
      lambdaTriggers = {},
      entraId,
      domainPrefix,
      createOutputs = true,
      tags = {}
    } = props;

    const { envName, projectName, isProd } = params;

    // Build lambda triggers configuration
    const cognitoLambdaTriggers: UserPoolTriggers = {
      ...(lambdaTriggers.preSignUp && { preSignUp: lambdaTriggers.preSignUp }),
      ...(lambdaTriggers.postConfirmation && { postConfirmation: lambdaTriggers.postConfirmation }),
      ...(lambdaTriggers.preAuthentication && { preAuthentication: lambdaTriggers.preAuthentication }),
      ...(lambdaTriggers.postAuthentication && { postAuthentication: lambdaTriggers.postAuthentication }),
      ...(lambdaTriggers.preTokenGeneration && { preTokenGeneration: lambdaTriggers.preTokenGeneration }),
      ...(lambdaTriggers.customMessage && { customMessage: lambdaTriggers.customMessage }),
      ...(lambdaTriggers.defineAuthChallenge && { defineAuthChallenge: lambdaTriggers.defineAuthChallenge }),
      ...(lambdaTriggers.createAuthChallenge && { createAuthChallenge: lambdaTriggers.createAuthChallenge }),
      ...(lambdaTriggers.verifyAuthChallengeResponse && { verifyAuthChallengeResponse: lambdaTriggers.verifyAuthChallengeResponse }),
    };

    // Create User Pool with configuration
    this.userPool = new UserPool(this, 'UserPool', {
      userPoolName: userPoolConfig.userPoolName || `${projectName}-${envName}-user-pool`,
      selfSignUpEnabled: userPoolConfig.selfSignUpEnabled ?? true,
      signInAliases: userPoolConfig.signInAliases || { email: true },
      autoVerify: userPoolConfig.autoVerify || { email: false },
      passwordPolicy: userPoolConfig.passwordPolicy || {
        minLength: 8,
        requireUppercase: true,
        requireLowercase: true,
        requireDigits: true,
        requireSymbols: false,
      },
      accountRecovery: userPoolConfig.accountRecovery || AccountRecovery.EMAIL_AND_PHONE_WITHOUT_MFA,
      lambdaTriggers: Object.keys(cognitoLambdaTriggers).length > 0 ? cognitoLambdaTriggers : undefined,
      removalPolicy: userPoolConfig.removalPolicy || (isProd ? RemovalPolicy.RETAIN : RemovalPolicy.DESTROY),
      // Custom attributes configuration
      customAttributes: this.buildCustomAttributes(userPoolConfig.customAttributes),
      // Standard attributes configuration
      standardAttributes: this.buildStandardAttributes(userPoolConfig.standardAttributes),
    });

    // Create Resource Server if configured
    if (userPoolClientConfig.resourceServer) {
      const { identifier, name, scopes } = userPoolClientConfig.resourceServer;

      // Create resource server scopes
      this.resourceServerScopes = scopes.map(scope =>
        new ResourceServerScope({
          scopeName: scope.scopeName,
          scopeDescription: scope.scopeDescription,
        })
      );

      this.resourceServer = new UserPoolResourceServer(this, 'ResourceServer', {
        userPool: this.userPool,
        identifier,
        userPoolResourceServerName: name,
        scopes: this.resourceServerScopes,
      });
    }

    // Optional Microsoft Entra ID (OIDC) federation
    const supportedIdentityProviders = [UserPoolClientIdentityProvider.COGNITO];
    if (entraId?.enabled) {
      if (!entraId.clientId || !entraId.clientSecret || !entraId.issuerUrl) {
        throw new Error('Entra ID federation enabled but clientId, clientSecret or issuerUrl is missing');
      }
      if (!domainPrefix) {
        throw new Error('Entra ID federation enabled but no domainPrefix was provided (Hosted UI domain is required for federation)');
      }

      this.entraIdProvider = new UserPoolIdentityProviderOidc(this, 'EntraIdProvider', {
        userPool: this.userPool,
        name: 'EntraID',
        clientId: entraId.clientId,
        clientSecret: entraId.clientSecret,
        issuerUrl: entraId.issuerUrl,
        scopes: entraId.scopes ?? ['openid', 'email', 'profile'],
        attributeRequestMethod: OidcAttributeRequestMethod.GET,
        attributeMapping: {
          email: ProviderAttribute.other('email'),
          givenName: ProviderAttribute.other('given_name'),
          familyName: ProviderAttribute.other('family_name'),
        },
      });

      supportedIdentityProviders.push(UserPoolClientIdentityProvider.custom('EntraID'));
    }

    // Hosted UI domain (required for federation, optional otherwise)
    if (domainPrefix) {
      this.domain = this.userPool.addDomain('HostedUiDomain', {
        cognitoDomain: { domainPrefix },
      });
    }

    // Build auth flows configuration
    const authFlows: any = {};
    if (userPoolClientConfig.authFlows?.userPassword !== false) {
      authFlows.userPassword = userPoolClientConfig.authFlows?.userPassword ?? true;
    }
    if (userPoolClientConfig.authFlows?.userSrp !== false) {
      authFlows.userSrp = userPoolClientConfig.authFlows?.userSrp ?? true;
    }
    if (userPoolClientConfig.authFlows?.custom) {
      authFlows.custom = true;
    }
    if (userPoolClientConfig.authFlows?.adminUserPassword) {
      authFlows.adminUserPassword = true;
    }

    // Create User Pool Client with configuration
    this.userPoolClient = new UserPoolClient(this, 'UserPoolClient', {
      userPool: this.userPool,
      userPoolClientName: userPoolClientConfig.userPoolClientName || `${projectName}-${envName}-client`,
      generateSecret: userPoolClientConfig.generateSecret ?? false,
      authFlows,
      supportedIdentityProviders,
      // Token validity configuration
      ...(userPoolClientConfig.tokenValidity && {
        accessTokenValidity: userPoolClientConfig.tokenValidity.accessToken
          ? Duration.days(userPoolClientConfig.tokenValidity.accessToken)
          : undefined,
        idTokenValidity: userPoolClientConfig.tokenValidity.idToken
          ? Duration.days(userPoolClientConfig.tokenValidity.idToken)
          : undefined,
        refreshTokenValidity: userPoolClientConfig.tokenValidity.refreshToken
          ? Duration.days(userPoolClientConfig.tokenValidity.refreshToken)
          : undefined,
      }),
      // OAuth configuration
      ...(userPoolClientConfig.oAuth && {
        oAuth: {
          flows: userPoolClientConfig.oAuth.flows,
          scopes: [
            ...(userPoolClientConfig.oAuth.scopes || []),
            // Add resource server scopes if resource server exists
            ...this.getResourceServerOAuthScopes(userPoolClientConfig.resourceServer)
          ],
          callbackUrls: userPoolClientConfig.oAuth.callbackUrls,
          logoutUrls: userPoolClientConfig.oAuth.logoutUrls,
        }
      })
    });

    // Add explicit dependency if resource server exists
    if (this.resourceServer) {
      this.userPoolClient.node.addDependency(this.resourceServer);
    }

    // The client must be created after the Entra ID provider so that
    // supportedIdentityProviders can reference it
    if (this.entraIdProvider) {
      this.userPoolClient.node.addDependency(this.entraIdProvider);
    }

    // Create CloudFormation outputs if requested
    if (createOutputs) {
      new CfnOutput(this, 'UserPoolId', {
        value: this.userPool.userPoolId,
        description: 'Cognito User Pool ID',
        exportName: `${projectName}-${envName}-UserPoolId`
      });

      new CfnOutput(this, 'UserPoolClientId', {
        value: this.userPoolClient.userPoolClientId,
        description: 'Cognito User Pool Client ID',
        exportName: `${projectName}-${envName}-UserPoolClientId`
      });

      new CfnOutput(this, 'UserPoolArn', {
        value: this.userPool.userPoolArn,
        description: 'Cognito User Pool ARN',
        exportName: `${projectName}-${envName}-UserPoolArn`
      });
    }

    // Apply tags
    this.applyTags(tags);
  }

  /**
   * Applies tags to the Cognito resources
   */
  private applyTags(tags: { [key: string]: string }): void {
    Object.entries(tags).forEach(([key, value]) => {
      Tags.of(this).add(key, value);
    });
  }

  /**
   * Gets the User Pool ID
   */
  public get userPoolId(): string {
    return this.userPool.userPoolId;
  }

  /**
   * Gets the User Pool Client ID
   */
  public get userPoolClientId(): string {
    return this.userPoolClient.userPoolClientId;
  }

  /**
   * Gets the User Pool ARN
   */
  public get userPoolArn(): string {
    return this.userPool.userPoolArn;
  }

  /**
   * Builds custom attributes for the User Pool
   */
  private buildCustomAttributes(customAttributes?: CognitoUserPoolConfig['customAttributes']): { [key: string]: StringAttribute | NumberAttribute | BooleanAttribute | DateTimeAttribute } | undefined {
    if (!customAttributes) {
      return undefined;
    }

    const attributes: { [key: string]: StringAttribute | NumberAttribute | BooleanAttribute | DateTimeAttribute } = {};

    // Build string attributes
    if (customAttributes.stringAttributes) {
      for (const [key, config] of Object.entries(customAttributes.stringAttributes)) {
        attributes[key] = new StringAttribute({
          mutable: config.mutable ?? true,
          minLen: config.minLen,
          maxLen: config.maxLen,
        });
      }
    }

    // Build number attributes
    if (customAttributes.numberAttributes) {
      for (const [key, config] of Object.entries(customAttributes.numberAttributes)) {
        attributes[key] = new NumberAttribute({
          mutable: config.mutable ?? true,
          min: config.min,
          max: config.max,
        });
      }
    }

    // Build boolean attributes
    if (customAttributes.booleanAttributes) {
      for (const [key, config] of Object.entries(customAttributes.booleanAttributes)) {
        attributes[key] = new BooleanAttribute({
          mutable: config.mutable ?? true,
        });
      }
    }

    // Build datetime attributes
    if (customAttributes.dateTimeAttributes) {
      for (const [key, config] of Object.entries(customAttributes.dateTimeAttributes)) {
        attributes[key] = new DateTimeAttribute({
          mutable: config.mutable ?? true,
        });
      }
    }

    return Object.keys(attributes).length > 0 ? attributes : undefined;
  }

  /**
   * Builds standard attributes for the User Pool
   */
  private buildStandardAttributes(standardAttributes?: CognitoUserPoolConfig['standardAttributes']): { [key: string]: { required?: boolean; mutable?: boolean } } | undefined {
    if (!standardAttributes) {
      return undefined;
    }

    const standard: { [key: string]: { required?: boolean; mutable?: boolean } } = {};

    // Map each standard attribute if it's defined
    if (standardAttributes.email) {
      standard.email = {
        required: standardAttributes.email.required ?? false,
        mutable: standardAttributes.email.mutable ?? true,
      };
    }
    if (standardAttributes.phoneNumber) {
      standard.phone_number = {
        required: standardAttributes.phoneNumber.required ?? false,
        mutable: standardAttributes.phoneNumber.mutable ?? true,
      };
    }
    if (standardAttributes.givenName) {
      standard.given_name = {
        required: standardAttributes.givenName.required ?? false,
        mutable: standardAttributes.givenName.mutable ?? true,
      };
    }
    if (standardAttributes.familyName) {
      standard.family_name = {
        required: standardAttributes.familyName.required ?? false,
        mutable: standardAttributes.familyName.mutable ?? true,
      };
    }
    if (standardAttributes.address) {
      standard.address = {
        required: standardAttributes.address.required ?? false,
        mutable: standardAttributes.address.mutable ?? true,
      };
    }
    if (standardAttributes.birthdate) {
      standard.birthdate = {
        required: standardAttributes.birthdate.required ?? false,
        mutable: standardAttributes.birthdate.mutable ?? true,
      };
    }
    if (standardAttributes.gender) {
      standard.gender = {
        required: standardAttributes.gender.required ?? false,
        mutable: standardAttributes.gender.mutable ?? true,
      };
    }
    if (standardAttributes.locale) {
      standard.locale = {
        required: standardAttributes.locale.required ?? false,
        mutable: standardAttributes.locale.mutable ?? true,
      };
    }
    if (standardAttributes.middleName) {
      standard.middle_name = {
        required: standardAttributes.middleName.required ?? false,
        mutable: standardAttributes.middleName.mutable ?? true,
      };
    }
    if (standardAttributes.name) {
      standard.name = {
        required: standardAttributes.name.required ?? false,
        mutable: standardAttributes.name.mutable ?? true,
      };
    }
    if (standardAttributes.nickname) {
      standard.nickname = {
        required: standardAttributes.nickname.required ?? false,
        mutable: standardAttributes.nickname.mutable ?? true,
      };
    }
    if (standardAttributes.picture) {
      standard.picture = {
        required: standardAttributes.picture.required ?? false,
        mutable: standardAttributes.picture.mutable ?? true,
      };
    }
    if (standardAttributes.preferredUsername) {
      standard.preferred_username = {
        required: standardAttributes.preferredUsername.required ?? false,
        mutable: standardAttributes.preferredUsername.mutable ?? true,
      };
    }
    if (standardAttributes.profile) {
      standard.profile = {
        required: standardAttributes.profile.required ?? false,
        mutable: standardAttributes.profile.mutable ?? true,
      };
    }
    if (standardAttributes.timezone) {
      standard.zoneinfo = {
        required: standardAttributes.timezone.required ?? false,
        mutable: standardAttributes.timezone.mutable ?? true,
      };
    }
    if (standardAttributes.updatedAt) {
      standard.updated_at = {
        required: standardAttributes.updatedAt.required ?? false,
        mutable: standardAttributes.updatedAt.mutable ?? true,
      };
    }
    if (standardAttributes.website) {
      standard.website = {
        required: standardAttributes.website.required ?? false,
        mutable: standardAttributes.website.mutable ?? true,
      };
    }

    return Object.keys(standard).length > 0 ? standard : undefined;
  }

  /**
   * Converts resource server scopes to OAuth scope strings
   */
  private getResourceServerOAuthScopes(resourceServerConfig?: CognitoUserPoolClientConfig['resourceServer']): OAuthScope[] {
    if (!resourceServerConfig) {
      return [];
    }

    // Convert resource server scopes to OAuth scope strings
    // Format: "resourceServerIdentifier/scopeName"
    return resourceServerConfig.scopes.map(scope =>
      OAuthScope.custom(`${resourceServerConfig.identifier}/${scope.scopeName}`)
    );
  }

}
