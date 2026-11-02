import { describe, it, expect } from 'vitest';
import { Match } from 'aws-cdk-lib/assertions';
import { getTemplate, TEST_PARAMS } from './helpers/setup';

// Resource names follow the ${projectName}-${envName}-<name> convention, so
// derive the prefix from the test params instead of hardcoding it.
const PREFIX = `${TEST_PARAMS.projectName}-${TEST_PARAMS.envName}`;

describe('MainStack', () => {
  it('provisions no usage-stats table and no templates bucket', () => {
    const template = getTemplate();
    template.resourcePropertiesCountIs('AWS::DynamoDB::Table', { TableName: `${PREFIX}-usage-stats` }, 0);
    template.resourcePropertiesCountIs('AWS::S3::Bucket', { BucketName: `${PREFIX}-templates` }, 0);
  });

  it('provisions a Cognito User Pool and Client', () => {
    const template = getTemplate();
    template.resourceCountIs('AWS::Cognito::UserPool', 1);
    template.resourceCountIs('AWS::Cognito::UserPoolClient', 1);
  });

  it('builds the python-common layer', () => {
    const template = getTemplate();
    template.resourceCountIs('AWS::Lambda::LayerVersion', 1);
  });

  it('provisions the core Lambda functions and none of the removed ones', () => {
    const template = getTemplate();
    for (const name of [`${PREFIX}-not-found`, `${PREFIX}-authorizer`]) {
      template.hasResourceProperties('AWS::Lambda::Function', { FunctionName: name });
    }
    for (const name of ['hello-world', 'pre-signup', 'post-confirmation-signup', 'presigned-url-template']) {
      template.resourcePropertiesCountIs('AWS::Lambda::Function', { FunctionName: `${PREFIX}-${name}` }, 0);
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

  it('guards the API with the Lambda authorizer and has no example routes', () => {
    const template = getTemplate();
    template.hasResourceProperties('AWS::ApiGateway::Authorizer', {
      Name: `${PREFIX}-lambda-authorizer`,
      Type: 'TOKEN',
      IdentitySource: 'method.request.header.Authorization',
    });
    template.hasResourceProperties('AWS::ApiGateway::Method', {
      AuthorizationType: 'CUSTOM',
      AuthorizerId: Match.anyValue(),
    });
    for (const pathPart of ['hello-world', 'presigned-url']) {
      template.resourcePropertiesCountIs('AWS::ApiGateway::Resource', { PathPart: pathPart }, 0);
    }
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

  it('wires no Cognito triggers', () => {
    const pools = Object.values(getTemplate().findResources('AWS::Cognito::UserPool'));
    expect(pools[0]?.Properties?.LambdaConfig).toBeUndefined();
  });
});
