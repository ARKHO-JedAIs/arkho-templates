import { Construct } from 'constructs';
import { Duration, RemovalPolicy, Stack } from 'aws-cdk-lib';
import { Code, LayerVersion } from 'aws-cdk-lib/aws-lambda';
import { RetentionDays } from 'aws-cdk-lib/aws-logs';
import { LambdaConstruct } from '../../construct/lambda-construct';
import { ParamsConfig } from '../shared/util/env-config';
import { PYTHON_RUNTIME } from '../shared/util/runtime';
import { LayerFactory } from '../layer';
import { S3Factory } from '../s3';

const PRESIGNED_URL_EXPIRY_SECONDS = 3600;

export interface LambdaFactoryProps {
  params: ParamsConfig;
  layerFactory: LayerFactory;
  s3Factory: S3Factory;
}

/**
 * Centralized factory for the Lambda functions whose source lives under
 * src/lambda. One function per source folder; the Python ones share the
 * python-common layer.
 */
export class LambdaFactory extends Construct {
  public readonly helloWorldLambda: LambdaConstruct;
  public readonly preSignupLambda: LambdaConstruct;
  public readonly postConfirmationSignupLambda: LambdaConstruct;
  public readonly notFoundLambda: LambdaConstruct;
  public readonly presignedUrlTemplateLambda: LambdaConstruct;
  public readonly authorizerLambda: LambdaConstruct;

  constructor(scope: Construct, id: string, props: LambdaFactoryProps) {
    super(scope, id);

    const { params, layerFactory, s3Factory } = props;
    const templateBucket = s3Factory.templateBucket;
    const { envName, projectName } = params;
    const logRemovalPolicy = params.isProd ? RemovalPolicy.RETAIN : RemovalPolicy.DESTROY;
    const commonLayer = layerFactory.pythonCommonLayer.layer;
    const logging = { logRetention: RetentionDays.ONE_MONTH, removalPolicy: logRemovalPolicy };

    // Reference example behind the public `GET /hello-world` route wired in
    // ApiFactory. It depends on no other resource, so the API answers right
    // after the first deploy. Remove it once the API serves real routes.
    this.helloWorldLambda = new LambdaConstruct(this, 'HelloWorldLambda', {
      functionName: `${projectName}-${envName}-hello-world`,
      description: 'Example endpoint returning a static Hello, world! payload',
      code: Code.fromAsset('src/lambda/core/hello-world'),
      handler: 'index.handler',
      runtime: PYTHON_RUNTIME,
      layers: [commonLayer],
      logging,
    });

    this.preSignupLambda = new LambdaConstruct(this, 'PreSignupLambda', {
      functionName: `${projectName}-${envName}-pre-signup`,
      description: 'Cognito pre-signup validation trigger',
      code: Code.fromAsset('src/lambda/user/pre-signup'),
      handler: 'index.handler',
      runtime: PYTHON_RUNTIME,
      layers: [commonLayer],
      logging,
    });

    this.postConfirmationSignupLambda = new LambdaConstruct(this, 'PostConfirmationSignupLambda', {
      functionName: `${projectName}-${envName}-post-confirmation-signup`,
      description: 'Cognito post-confirmation trigger',
      code: Code.fromAsset('src/lambda/user/post-confirmation-signup'),
      handler: 'index.handler',
      runtime: PYTHON_RUNTIME,
      layers: [commonLayer],
      logging,
    });

    this.notFoundLambda = new LambdaConstruct(this, 'NotFoundLambda', {
      functionName: `${projectName}-${envName}-not-found`,
      description: 'Returns a standardized 404 Not Found response',
      code: Code.fromAsset('src/lambda/core/not-found'),
      handler: 'index.handler',
      runtime: PYTHON_RUNTIME,
      layers: [commonLayer],
      logging,
    });

    this.presignedUrlTemplateLambda = new LambdaConstruct(this, 'PresignedUrlTemplateLambda', {
      functionName: `${projectName}-${envName}-presigned-url-template`,
      description: 'Generates a presigned PUT URL for uploads to the templates bucket',
      code: Code.fromAsset('src/lambda/core/presigned-url-template'),
      handler: 'index.handler',
      runtime: PYTHON_RUNTIME,
      layers: [commonLayer],
      environment: {
        TEMPLATES_BUCKET_NAME: templateBucket.bucketName,
        PRESIGNED_URL_EXPIRY_SECONDS: String(PRESIGNED_URL_EXPIRY_SECONDS),
      },
      logging,
    });

    // Grant read/write over the whole bucket so the function can operate on any
    // key if needed, not just the templates/ prefix.
    templateBucket.grantReadWrite(this.presignedUrlTemplateLambda.function);

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
