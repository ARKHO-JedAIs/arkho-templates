import { Stack } from 'aws-cdk-lib';
import { Construct } from 'constructs';
import { AccountRecovery, FeaturePlan, Mfa, OAuthScope, UserPoolEmail } from 'aws-cdk-lib/aws-cognito';
import { IFunction } from 'aws-cdk-lib/aws-lambda';
import { CognitoConstruct } from '../../construct/cognito-construct';
import { capitalizeFirstLetter } from '../shared/util/capitalize';
import { CognitoConfig, ParamsConfig } from '../shared/util/env-config';

export interface CognitoFactoryProps {
  params: ParamsConfig;
  cognito: CognitoConfig;
  lambdaTriggers?: {
    preSignUp?: IFunction;
    postConfirmation?: IFunction;
  };
}

/**
 * Centralized factory for the arkho-cli authentication resources.
 *
 * Creates a Cognito User Pool with the native provider and, when configured,
 * federates to Microsoft Entra ID via OIDC.
 */
export class CognitoFactory extends Construct {
  public readonly cognitoConstruct: CognitoConstruct;

  constructor(scope: Construct, id: string, props: CognitoFactoryProps) {
    super(scope, id);

    const { params, cognito, lambdaTriggers } = props;
    const { envName, projectName } = params;
    const { emailMfa } = cognito;
    const appName = capitalizeFirstLetter(projectName);

    this.cognitoConstruct = new CognitoConstruct(this, 'UserAuth', {
      params,
      userPoolConfig: {
        userPoolName: `${projectName}-${envName}-user-pool`,
        selfSignUpEnabled: true,
        signInAliases: {
          email: true,
          username: false,
          phone: false,
        },
        autoVerify: {
          email: true,
        },
        passwordPolicy: {
          minLength: 8,
          requireUppercase: true,
          requireLowercase: true,
          requireDigits: true,
          requireSymbols: false,
        },
        // Cognito rejects email MFA while email is also the recovery channel.
        accountRecovery: emailMfa.enabled ? AccountRecovery.NONE : AccountRecovery.EMAIL_ONLY,
        ...(emailMfa.enabled && {
          featurePlan: FeaturePlan.ESSENTIALS,
          mfa: Mfa.REQUIRED,
          mfaSecondFactor: { sms: false, otp: false, email: true },
          email: UserPoolEmail.withSES({
            fromEmail: emailMfa.fromEmail,
            sesRegion: Stack.of(this).region,
            sesVerifiedDomain: emailMfa.fromEmail.split('@')[1],
          }),
          emailMfaMessage: {
            subject: `Código de verificación - ${appName}`,
            message: `Tu código de verificación de ${appName} es {####}. Vence en 10 minutos. Si no intentaste iniciar sesión, ignora este mensaje.`,
          },
        }),
      },
      userPoolClientConfig: {
        userPoolClientName: `${projectName}-${envName}-cli-client`,
        generateSecret: false,
        authFlows: {
          userPassword: true,
          userSrp: true,
          custom: false,
          adminUserPassword: false,
        },
        tokenValidity: {
          accessToken: 1,
          idToken: 1,
          refreshToken: 30,
        },
        // Also bounds how long the emailed code stays valid.
        ...(emailMfa.enabled && { authSessionValidityMinutes: 10 }),
        resourceServer: {
          identifier: `${projectName}-${envName}-api`,
          name: `${projectName} ${envName} API`,
          scopes: [
            { scopeName: 'read', scopeDescription: 'Read access to API resources' },
            { scopeName: 'write', scopeDescription: 'Write access to API resources' },
          ],
        },
        oAuth: {
          flows: {
            authorizationCodeGrant: true,
            implicitCodeGrant: false,
          },
          scopes: [OAuthScope.EMAIL, OAuthScope.OPENID, OAuthScope.PROFILE],
          callbackUrls: envName === 'prod'
            ? ['https://example.com/callback']
            : ['http://localhost:8976/callback', 'http://localhost:3000/callback'],
          logoutUrls: envName === 'prod'
            ? ['https://example.com/logout']
            : ['http://localhost:8976/logout', 'http://localhost:3000/logout'],
        },
      },
      entraId: cognito.entraId,
      domainPrefix: cognito.domainPrefix,
      ...(lambdaTriggers && {
        lambdaTriggers: {
          ...(lambdaTriggers.preSignUp && { preSignUp: lambdaTriggers.preSignUp }),
          ...(lambdaTriggers.postConfirmation && { postConfirmation: lambdaTriggers.postConfirmation }),
        },
      }),
      createOutputs: true,
      tags: {
        Service: 'Authentication',
        Component: 'UserAuth',
      },
    });
  }

  public get userPoolId(): string {
    return this.cognitoConstruct.userPoolId;
  }

  public get userPoolClientId(): string {
    return this.cognitoConstruct.userPoolClientId;
  }

  public get userPoolArn(): string {
    return this.cognitoConstruct.userPoolArn;
  }
}
