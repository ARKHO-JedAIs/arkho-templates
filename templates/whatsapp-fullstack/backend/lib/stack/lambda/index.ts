import { Construct } from 'constructs';
import { Duration, RemovalPolicy, Stack } from 'aws-cdk-lib';
import { Code, LayerVersion } from 'aws-cdk-lib/aws-lambda';
import { RetentionDays } from 'aws-cdk-lib/aws-logs';
import { LambdaConstruct } from '../../construct/lambda-construct';
import { ParamsConfig } from '../shared/util/env-config';
import { PYTHON_RUNTIME } from '../shared/util/runtime';
import { LayerFactory } from '../layer';

export interface LambdaFactoryProps {
  params: ParamsConfig;
  layerFactory: LayerFactory;
}

/**
 * Centralized factory for the core Lambda functions under src/lambda/core: the
 * API authorizer and the 404 fallback. The feature modules (WhatsApp, Users)
 * own their functions.
 */
export class LambdaFactory extends Construct {
  public readonly notFoundLambda: LambdaConstruct;
  public readonly authorizerLambda: LambdaConstruct;

  constructor(scope: Construct, id: string, props: LambdaFactoryProps) {
    super(scope, id);

    const { params, layerFactory } = props;
    const { envName, projectName } = params;
    const logRemovalPolicy = params.isProd ? RemovalPolicy.RETAIN : RemovalPolicy.DESTROY;
    const commonLayer = layerFactory.pythonCommonLayer.layer;
    const logging = { logRetention: RetentionDays.ONE_MONTH, removalPolicy: logRemovalPolicy };

    this.notFoundLambda = new LambdaConstruct(this, 'NotFoundLambda', {
      functionName: `${projectName}-${envName}-not-found`,
      description: 'Returns a standardized 404 Not Found response',
      code: Code.fromAsset('src/lambda/core/not-found'),
      handler: 'index.handler',
      runtime: PYTHON_RUNTIME,
      layers: [commonLayer],
      logging,
    });

    // PyJWT and cryptography are provided by public Klayers layers, resolved in
    // the deployment region (Klayers uses account 770693421928 in every region).
    // The p312 suffix must track PYTHON_RUNTIME: a layer built for another minor
    // version fails at import time.
    //
    // Layer version numbers are pinned, and they are region-local: Klayers
    // publishes per region, so the same number can resolve to a different
    // package version or not exist at all. PyJWT:4 is 2.13.0 everywhere.
    // cryptography:25 is the newest number present in every Klayers region
    // (49.0.0 in most, 50.0.0 in ap-south-1, ap-southeast-2 and eu-north-1,
    // which are one release ahead in numbering); cryptography:26 is 50.0.0 but
    // does not exist in those three. Klayers does not publish to ap-northeast-3
    // at all. Re-check a pin before deploying to a new region:
    //   aws lambda get-layer-version-by-arn --region <region> \
    //     --arn arn:aws:lambda:<region>:770693421928:layer:Klayers-p312-cryptography:25
    const region = Stack.of(this).region;
    const pyJwtLayer = LayerVersion.fromLayerVersionArn(this, 'PyJWTLayer', `arn:aws:lambda:${region}:770693421928:layer:Klayers-p312-PyJWT:4`);
    const cryptographyLayer = LayerVersion.fromLayerVersionArn(this, 'CryptographyLayer', `arn:aws:lambda:${region}:770693421928:layer:Klayers-p312-cryptography:25`);
    this.authorizerLambda = new LambdaConstruct(this, 'AuthorizerLambda', {
      functionName: `${projectName}-${envName}-authorizer`,
      description: 'API Gateway Lambda authorizer that validates Cognito JWTs',
      code: Code.fromAsset('src/lambda/core/authorizer'),
      handler: 'index.lambda_handler',
      runtime: PYTHON_RUNTIME,
      layers: [pyJwtLayer, cryptographyLayer],
      timeout: Duration.seconds(10),
      memorySize: 256,
      environment: {
        USER_POOL_ID: 'UNDEFINED_BY_DEFAULT',
        APP_CLIENT_ID: 'UNDEFINED_BY_DEFAULT',
      },
      logging,
    });
  }
}
