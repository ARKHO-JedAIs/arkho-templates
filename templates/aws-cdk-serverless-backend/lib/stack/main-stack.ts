import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import { CognitoConfig, EnvironmentConfig, ParamsConfig } from './shared/util/env-config';
import { DynamoFactory } from './dynamo';
import { S3Factory } from './s3';
import { LayerFactory } from './layer';
import { LambdaFactory } from './lambda';
import { CognitoFactory } from './cognito';
import { SetupFactory } from './setup';

interface MainStackProps extends cdk.StackProps {
  env: EnvironmentConfig;
  params: ParamsConfig;
  cognito: CognitoConfig;
}

/**
 * Root stack for arkho-cli-cdk.
 *
 * Active resources: a DynamoDB usage-stats table, the templates S3 bucket, the
 * python-common layer, the Lambda functions whose source lives under
 * src/lambda, and Cognito
 * (with optional Entra ID SSO). The pre-signup and post-confirmation functions
 * are wired as Cognito triggers; the authorizer receives the Cognito ids after
 * the user pool is created.
 *
 * The remaining service constructs under lib/construct stay as generic,
 * reusable building blocks and are wired in as the backend grows.
 */
export class MainStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: MainStackProps) {
    super(scope, id, props);

    const { params, cognito } = props;
    const { envName, projectName } = params;

    new DynamoFactory(this, 'DynamoFactory', { params });

    const s3Factory = new S3Factory(this, 'S3Factory', { params });

    const layerFactory = new LayerFactory(this, 'LayerFactory', { params });

    const lambdaFactory = new LambdaFactory(this, 'LambdaFactory', {
      params,
      layerFactory,
      s3Factory,
    });

    const cognitoFactory = new CognitoFactory(this, 'CognitoFactory', {
      params,
      cognito,
      lambdaTriggers: {
        preSignUp: lambdaFactory.preSignupLambda.function,
        postConfirmation: lambdaFactory.postConfirmationSignupLambda.function,
      },
    });

    // Post-creation wiring: the authorizer needs the Cognito ids, which only
    // exist after the user pool is created.
    new SetupFactory(this, 'SetupFactory', { lambdaFactory, cognitoFactory });

    cdk.Tags.of(this).add('Project', projectName);
    cdk.Tags.of(this).add('Environment', envName);
  }
}
