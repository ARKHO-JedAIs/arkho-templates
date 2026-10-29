import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import { CognitoConfig, EnvironmentConfig, ParamsConfig, WhatsAppConfig } from './shared/util/env-config';
import { LayerFactory } from './layer';
import { LambdaFactory } from './lambda';
import { CognitoFactory } from './cognito';
import { ApiFactory } from './api';
import { SetupFactory } from './setup';
import { UsersFactory } from './users';
import { WhatsAppFactory } from './whatsapp';

interface MainStackProps extends cdk.StackProps {
  env: EnvironmentConfig;
  params: ParamsConfig;
  cognito: CognitoConfig;
  whatsapp: WhatsAppConfig;
  /** Wire the /admin/users API of the frontend's Usuarios screen. */
  usersApiEnabled?: boolean;
}

/**
 * Root stack for arkho-cli-cdk.
 *
 * Active resources: the python-common layer, the core Lambda functions
 * (authorizer, not-found), Cognito (with optional Microsoft Entra ID and Google
 * sign-in), the REST API, and the WhatsApp and Users modules that register
 * their own routes on it. The authorizer receives the Cognito ids after the
 * user pool is created.
 *
 * The remaining service constructs under lib/construct stay as generic,
 * reusable building blocks and are wired in as the backend grows.
 */
export class MainStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: MainStackProps) {
    super(scope, id, props);

    const { params, cognito, whatsapp, usersApiEnabled } = props;
    const { envName, projectName } = params;

    const layerFactory = new LayerFactory(this, 'LayerFactory', { params });

    const lambdaFactory = new LambdaFactory(this, 'LambdaFactory', { params, layerFactory });

    const cognitoFactory = new CognitoFactory(this, 'CognitoFactory', { params, cognito });

    const apiFactory = new ApiFactory(this, 'ApiFactory', { params, lambdaFactory });

    // Post-creation wiring: the authorizer needs the Cognito ids, which only
    // exist after the user pool is created.
    new SetupFactory(this, 'SetupFactory', { lambdaFactory, cognitoFactory });

    new WhatsAppFactory(this, 'WhatsAppFactory', {
      params,
      whatsapp,
      layerFactory,
      cognitoFactory,
      apiFactory,
    });

    if (usersApiEnabled) {
      new UsersFactory(this, 'UsersFactory', {
        params,
        adminGroup: whatsapp.adminGroup,
        layerFactory,
        cognitoFactory,
        apiFactory,
      });
    }

    cdk.Tags.of(this).add('Project', projectName);
    cdk.Tags.of(this).add('Environment', envName);
  }
}
