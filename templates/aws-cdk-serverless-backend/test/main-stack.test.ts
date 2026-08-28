import { Match } from 'aws-cdk-lib/assertions';
import { getTemplate, TEST_PARAMS } from './helpers/setup';

// Resource names follow the ${projectName}-${envName}-<name> convention, so
// derive the prefix from the test params instead of hardcoding it.
const PREFIX = `${TEST_PARAMS.projectName}-${TEST_PARAMS.envName}`;

describe('MainStack', () => {
  it('provisions the usage-stats DynamoDB table', () => {
    const template = getTemplate();
    template.resourceCountIs('AWS::DynamoDB::Table', 1);
    template.hasResourceProperties('AWS::DynamoDB::Table', {
      TableName: `${PREFIX}-usage-stats`,
      BillingMode: 'PAY_PER_REQUEST',
      KeySchema: [
        { AttributeName: 'PK', KeyType: 'HASH' },
        { AttributeName: 'SK', KeyType: 'RANGE' },
      ],
    });
  });

  it('provisions the templates S3 bucket', () => {
    const template = getTemplate();
    template.resourceCountIs('AWS::S3::Bucket', 1);
    template.hasResourceProperties('AWS::S3::Bucket', {
      BucketName: `${PREFIX}-templates`,
    });
  });

  it('provisions a Cognito User Pool and Client', () => {
    const template = getTemplate();
    template.resourceCountIs('AWS::Cognito::UserPool', 1);
    template.resourceCountIs('AWS::Cognito::UserPoolClient', 1);
  });

  it('does not federate to Entra ID when disabled', () => {
    const template = getTemplate();
    template.resourceCountIs('AWS::Cognito::UserPoolIdentityProvider', 0);
  });

  it('builds the python-common layer', () => {
    const template = getTemplate();
    template.resourceCountIs('AWS::Lambda::LayerVersion', 1);
  });

  it('provisions the Lambda functions backed by src/lambda', () => {
    const template = getTemplate();
    // Count only our explicitly named functions; CDK-managed helpers (e.g. the
    // S3 auto-delete-objects custom resource) have no FunctionName.
    const named = template.findResources('AWS::Lambda::Function', {
      Properties: { FunctionName: Match.anyValue() },
    });
    expect(Object.keys(named)).toHaveLength(6);
    for (const name of [
      `${PREFIX}-hello-world`,
      `${PREFIX}-pre-signup`,
      `${PREFIX}-post-confirmation-signup`,
      `${PREFIX}-not-found`,
      `${PREFIX}-presigned-url-template`,
      `${PREFIX}-authorizer`,
    ]) {
      template.hasResourceProperties('AWS::Lambda::Function', { FunctionName: name });
    }
  });

  it('exposes a REST API deployed to the environment stage', () => {
    const template = getTemplate();
    template.hasResourceProperties('AWS::ApiGateway::RestApi', {
      Name: `${PREFIX}-api`,
    });
    template.hasResourceProperties('AWS::ApiGateway::Stage', {
      StageName: TEST_PARAMS.envName,
    });
  });

  it('serves GET /hello-world without authorization', () => {
    const template = getTemplate();
    const [helloWorldResourceId] = Object.keys(
      template.findResources('AWS::ApiGateway::Resource', {
        Properties: { PathPart: 'hello-world' },
      })
    );
    expect(helloWorldResourceId).toBeDefined();

    template.hasResourceProperties('AWS::ApiGateway::Method', {
      HttpMethod: 'GET',
      ResourceId: { Ref: helloWorldResourceId },
      AuthorizationType: 'NONE',
      Integration: Match.objectLike({ Type: 'AWS_PROXY' }),
    });
  });

  it('lets API Gateway invoke the hello-world Lambda', () => {
    getTemplate().hasResourceProperties('AWS::Lambda::Permission', {
      Action: 'lambda:InvokeFunction',
      Principal: 'apigateway.amazonaws.com',
      FunctionName: {
        'Fn::GetAtt': [Match.stringLikeRegexp('HelloWorldLambda'), 'Arn'],
      },
    });
  });

  it('guards GET /presigned-url with the Lambda authorizer', () => {
    const template = getTemplate();
    template.hasResourceProperties('AWS::ApiGateway::Authorizer', {
      Name: `${PREFIX}-lambda-authorizer`,
      Type: 'TOKEN',
      IdentitySource: 'method.request.header.Authorization',
    });

    const [presignedUrlResourceId] = Object.keys(
      template.findResources('AWS::ApiGateway::Resource', {
        Properties: { PathPart: 'presigned-url' },
      })
    );
    expect(presignedUrlResourceId).toBeDefined();

    template.hasResourceProperties('AWS::ApiGateway::Method', {
      HttpMethod: 'GET',
      ResourceId: { Ref: presignedUrlResourceId },
      AuthorizationType: 'CUSTOM',
      AuthorizerId: Match.anyValue(),
    });
  });

  it('falls back to the not-found Lambda on unmatched routes', () => {
    const template = getTemplate();
    const [proxyResourceId] = Object.keys(
      template.findResources('AWS::ApiGateway::Resource', {
        Properties: { PathPart: '{proxy+}' },
      })
    );
    expect(proxyResourceId).toBeDefined();

    template.hasResourceProperties('AWS::ApiGateway::Method', {
      HttpMethod: 'ANY',
      ResourceId: { Ref: proxyResourceId },
      AuthorizationType: 'NONE',
    });
  });

  it('leaves every CORS preflight method unauthenticated', () => {
    const preflight = Object.values(
      getTemplate().findResources('AWS::ApiGateway::Method', {
        Properties: { HttpMethod: 'OPTIONS' },
      })
    );
    expect(preflight.length).toBeGreaterThan(0);
    for (const method of preflight) {
      expect(method.Properties?.AuthorizationType).toBe('NONE');
      expect(method.Properties?.AuthorizerId).toBeUndefined();
    }
  });

  it('wires pre-signup and post-confirmation as Cognito triggers', () => {
    const template = getTemplate();
    template.hasResourceProperties('AWS::Cognito::UserPool', Match.objectLike({
      LambdaConfig: Match.objectLike({
        PreSignUp: Match.anyValue(),
        PostConfirmation: Match.anyValue(),
      }),
    }));
  });
});
