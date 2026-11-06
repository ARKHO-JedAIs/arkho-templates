import { Duration, RemovalPolicy, Stack } from 'aws-cdk-lib';
import * as iam from 'aws-cdk-lib/aws-iam';
import { Code } from 'aws-cdk-lib/aws-lambda';
import { RetentionDays } from 'aws-cdk-lib/aws-logs';
import { Construct } from 'constructs';
import { AccountRecovery, FeaturePlan, Mfa, OAuthScope, UserPoolEmail } from 'aws-cdk-lib/aws-cognito';
import { CognitoConstruct } from '../../construct/cognito-construct';
import { LambdaConstruct } from '../../construct/lambda-construct';
import { PYTHON_RUNTIME } from '../shared/util/runtime';
import { capitalizeFirstLetter } from '../shared/util/capitalize';
import {
  CognitoConfig,
  DEFAULT_AUTH_CALLBACK_URLS,
  DEFAULT_AUTH_LOGOUT_URLS,
  ParamsConfig,
} from '../shared/util/env-config';

export interface CognitoFactoryProps {
  params: ParamsConfig;
  cognito: CognitoConfig;
}

/**
 * Centralized factory for the authentication resources.
 *
 * Creates a Cognito User Pool with the native provider and, when configured,
 * federates to Microsoft Entra ID (OIDC) and Google. Self sign-up is off:
 * accounts are created by an administrator (Usuarios screen or the AWS CLI),
 * and a federated user gets an account on first sign-in. The pre-token
 * trigger (src/lambda/access/pre-token) puts a user with no role group in
 * `member`, already in that first token.
 */
export class CognitoFactory extends Construct {
  public readonly cognitoConstruct: CognitoConstruct;
  public readonly preTokenLambda: LambdaConstruct;

  constructor(scope: Construct, id: string, props: CognitoFactoryProps) {
    super(scope, id);

    const { params, cognito } = props;
    const { envName, projectName } = params;
    const { emailMfa } = cognito;
    const appName = capitalizeFirstLetter(projectName);
    const { account, region, partition } = Stack.of(this);

    this.preTokenLambda = new LambdaConstruct(this, 'PreTokenLambda', {
      functionName: `${projectName}-${envName}-pre-token`,
      description: 'Cognito pre-token trigger: a user with no role group gets member',
      code: Code.fromAsset('src/lambda/access/pre-token'),
      handler: 'index.handler',
      runtime: PYTHON_RUNTIME,
      timeout: Duration.seconds(5),
      environment: { DEFAULT_ROLE: 'member' },
      logging: {
        logRetention: RetentionDays.ONE_MONTH,
        removalPolicy: params.isProd ? RemovalPolicy.RETAIN : RemovalPolicy.DESTROY,
      },
    });
    // The pool's ARN would make the pool and its own trigger depend on each
    // other, so the grant names the pools of this account and region.
    this.preTokenLambda.function.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ['cognito-idp:AdminAddUserToGroup'],
        resources: [`arn:${partition}:cognito-idp:${region}:${account}:userpool/*`],
      })
    );

    this.cognitoConstruct = new CognitoConstruct(this, 'UserAuth', {
      params,
      userPoolConfig: {
        userPoolName: `${projectName}-${envName}-user-pool`,
        selfSignUpEnabled: false,
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
          // COGNITO_ADMIN lets a federated session read its own attributes
          // (email, name) from the frontend.
          scopes: [OAuthScope.EMAIL, OAuthScope.OPENID, OAuthScope.PROFILE, OAuthScope.COGNITO_ADMIN],
          callbackUrls: cognito.callbackUrls ?? DEFAULT_AUTH_CALLBACK_URLS,
          logoutUrls: cognito.logoutUrls ?? DEFAULT_AUTH_LOGOUT_URLS,
        },
      },
      lambdaTriggers: { preTokenGeneration: this.preTokenLambda.function },
      entraId: cognito.entraId,
      google: cognito.google,
      domainPrefix: cognito.domainPrefix,
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
