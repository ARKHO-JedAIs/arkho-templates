import { describe, it, expect } from 'vitest';
import { Match } from 'aws-cdk-lib/assertions';
import { getTemplate, getTemplateWith, TEST_PARAMS } from './helpers/setup';

const PREFIX = `${TEST_PARAMS.projectName}-${TEST_PARAMS.envName}`;

const FUNCTIONS = [
  'ws-handler',
  'get-conversations',
  'get-messages',
  'send-message',
  'get-templates',
  'send-template',
  'put-control',
  'media-upload-url',
];

/** The IAM policies with a statement matching `statement`, by logical id. */
function policiesWith(template: ReturnType<typeof getTemplate>, statement: Record<string, unknown>) {
  return template.findResources('AWS::IAM::Policy', {
    Properties: {
      PolicyDocument: { Statement: Match.arrayWith([Match.objectLike(statement)]) },
    },
  });
}

/** The logical id prefix CDK gives the policy of one WhatsApp function. */
const policyOf = (name: string) => `WhatsAppFactory${name.replace(/-/g, '')}lambda`;

describe('WhatsAppFactory', () => {
  it('provisions the conversations and messages tables', () => {
    const template = getTemplate();
    template.hasResourceProperties('AWS::DynamoDB::Table', {
      TableName: `${PREFIX}-whatsapp-conversations`,
      KeySchema: [{ AttributeName: 'phone', KeyType: 'HASH' }],
    });
    template.hasResourceProperties('AWS::DynamoDB::Table', {
      TableName: `${PREFIX}-whatsapp-messages`,
      KeySchema: [
        { AttributeName: 'phone', KeyType: 'HASH' },
        { AttributeName: 'date', KeyType: 'RANGE' },
      ],
    });
  });

  it('provisions one function per src/lambda/whatsapp folder', () => {
    const template = getTemplate();
    for (const name of FUNCTIONS) {
      template.hasResourceProperties('AWS::Lambda::Function', {
        FunctionName: `${PREFIX}-whatsapp-${name}`,
        Environment: {
          Variables: Match.objectLike({
            WHATSAPP_CONVERSATIONS_TABLE_NAME: Match.anyValue(),
            WHATSAPP_MESSAGES_TABLE_NAME: Match.anyValue(),
            WHATSAPP_CONFIGURATION_PARAMETER_NAME: Match.anyValue(),
            APPSYNC_GRAPHQL_URL: Match.anyValue(),
          }),
        },
      });
    }
  });

  it('subscribes ws-handler to a standard SNS topic End User Messaging Social can publish to', () => {
    const template = getTemplate();
    template.hasResourceProperties('AWS::SNS::Topic', {
      TopicName: `${PREFIX}-whatsapp-ws-handler`,
    });
    template.resourceCountIs('AWS::SNS::Subscription', 1);
    template.hasResourceProperties('AWS::SNS::TopicPolicy', {
      PolicyDocument: {
        Statement: Match.arrayWith([
          Match.objectLike({
            Sid: 'AllowEndUserMessagingSocialPublish',
            Principal: { Service: 'social-messaging.amazonaws.com' },
            Action: 'sns:Publish',
          }),
        ]),
      },
    });
  });

  it('lets only the sending functions call SendWhatsAppMessage', () => {
    const template = getTemplate();
    const policies = template.findResources('AWS::IAM::Policy', {
      Properties: {
        PolicyDocument: {
          Statement: Match.arrayWith([
            Match.objectLike({ Action: 'social-messaging:SendWhatsAppMessage' }),
          ]),
        },
      },
    });
    // ws-handler, send-message and send-template.
    expect(Object.keys(policies)).toHaveLength(3);
  });

  it('lets only the template functions list and read templates', () => {
    const template = getTemplate();
    const policies = template.findResources('AWS::IAM::Policy', {
      Properties: {
        PolicyDocument: {
          Statement: Match.arrayWith([
            Match.objectLike({
              Action: ['social-messaging:ListWhatsAppMessageTemplates', 'social-messaging:GetWhatsAppMessageTemplate'],
            }),
          ]),
        },
      },
    });
    // get-templates, and send-template, which checks the status before sending.
    expect(Object.keys(policies)).toHaveLength(2);
  });

  it('stores the WhatsApp configuration in Parameter Store', () => {
    const template = getTemplate();
    template.hasResourceProperties('AWS::SSM::Parameter', {
      Name: `/${PREFIX}-whatsapp-configuration`,
      Type: 'String',
    });
  });

  it('creates the AppSync events API with Cognito and IAM authorization', () => {
    const template = getTemplate();
    template.hasResourceProperties('AWS::AppSync::GraphQLApi', {
      Name: `${PREFIX}-whatsapp-events`,
      AuthenticationType: 'AMAZON_COGNITO_USER_POOLS',
      AdditionalAuthenticationProviders: [{ AuthenticationType: 'AWS_IAM' }],
    });
  });

  it('indexes conversations by recency and messages by WhatsApp id', () => {
    const template = getTemplate();
    template.hasResourceProperties('AWS::DynamoDB::Table', {
      TableName: `${PREFIX}-whatsapp-conversations`,
      GlobalSecondaryIndexes: Match.arrayWith([
        Match.objectLike({
          IndexName: 'by-recent',
          KeySchema: [
            { AttributeName: 'inbox', KeyType: 'HASH' },
            { AttributeName: 'last_message_at', KeyType: 'RANGE' },
          ],
        }),
      ]),
    });
    template.hasResourceProperties('AWS::DynamoDB::Table', {
      TableName: `${PREFIX}-whatsapp-messages`,
      GlobalSecondaryIndexes: Match.arrayWith([
        Match.objectLike({
          IndexName: 'by-message-id',
          KeySchema: [{ AttributeName: 'message_id', KeyType: 'HASH' }],
        }),
      ]),
    });
  });

  it('retries a failed ws-handler invocation and keeps what still fails in a DLQ', () => {
    const template = getTemplate();
    template.hasResourceProperties('AWS::SQS::Queue', {
      QueueName: `${PREFIX}-whatsapp-ws-handler-dlq`,
      MessageRetentionPeriod: 14 * 24 * 60 * 60,
    });
    template.hasResourceProperties('AWS::Lambda::EventInvokeConfig', {
      MaximumRetryAttempts: 2,
      DestinationConfig: { OnFailure: { Destination: Match.anyValue() } },
    });
  });

  it('passes the admin group to the functions and the realtime subscription', () => {
    const template = getTemplate();
    template.hasResourceProperties('AWS::Lambda::Function', {
      FunctionName: `${PREFIX}-whatsapp-send-message`,
      Environment: { Variables: Match.objectLike({ WHATSAPP_ADMIN_GROUP: 'admin' }) },
    });
    template.hasResourceProperties('AWS::AppSync::GraphQLSchema', {
      Definition: Match.stringLikeRegexp('@aws_cognito_user_pools\\(cognito_groups: \\["admin"\\]\\)'),
    });
  });

  it('writes the WhatsApp settings from .env into the configuration parameter', () => {
    const template = getTemplate();
    template.hasResourceProperties('AWS::SSM::Parameter', {
      Name: `/${PREFIX}-whatsapp-configuration`,
      Value: Match.stringLikeRegexp('"whatsapp_business_account_id":"waba-abc123"'),
    });
  });

  it('exposes the WhatsApp routes behind the authorizer', () => {
    const template = getTemplate();
    for (const pathPart of ['conversations', 'messages', 'templates', 'send', 'control']) {
      template.hasResourceProperties('AWS::ApiGateway::Resource', { PathPart: pathPart });
    }
    const methods = template.findResources('AWS::ApiGateway::Method', {
      Properties: { AuthorizationType: 'CUSTOM' },
    });
    // The six WhatsApp routes: they are what attaches the authorizer to the API.
    expect(Object.keys(methods).length).toBeGreaterThanOrEqual(6);
  });

  it('exposes the media upload route', () => {
    const template = getTemplate();
    template.hasResourceProperties('AWS::ApiGateway::Resource', { PathPart: 'media' });
    template.hasResourceProperties('AWS::ApiGateway::Resource', { PathPart: 'upload-url' });
  });
});

describe('WhatsApp media bucket', () => {
  it('is private, encrypted and SSL-only', () => {
    const template = getTemplate();
    template.hasResourceProperties('AWS::S3::Bucket', {
      BucketName: `${PREFIX}-whatsapp-media`,
      PublicAccessBlockConfiguration: {
        BlockPublicAcls: true,
        BlockPublicPolicy: true,
        IgnorePublicAcls: true,
        RestrictPublicBuckets: true,
      },
      BucketEncryption: {
        ServerSideEncryptionConfiguration: [
          { ServerSideEncryptionByDefault: { SSEAlgorithm: 'AES256' } },
        ],
      },
    });
    template.hasResourceProperties('AWS::S3::BucketPolicy', {
      PolicyDocument: {
        Statement: Match.arrayWith([
          Match.objectLike({
            Effect: 'Deny',
            Condition: { Bool: { 'aws:SecureTransport': 'false' } },
          }),
          Match.objectLike({
            Sid: 'AllowEndUserMessagingSocialMedia',
            Principal: { Service: 'social-messaging.amazonaws.com' },
          }),
        ]),
      },
    });
  });

  it('is destroyed with a dev stack', () => {
    const template = getTemplate();
    template.hasResource('AWS::S3::Bucket', {
      Properties: { BucketName: `${PREFIX}-whatsapp-media` },
      DeletionPolicy: 'Delete',
    });
  });

  it('keeps files forever unless MEDIA_RETENTION_DAYS is set', () => {
    const rules = (template: ReturnType<typeof getTemplate>) => {
      const buckets = template.findResources('AWS::S3::Bucket', {
        Properties: { BucketName: `${PREFIX}-whatsapp-media` },
      });
      const [bucket] = Object.values(buckets) as {
        Properties: { LifecycleConfiguration: { Rules: Record<string, unknown>[] } };
      }[];
      return bucket!.Properties.LifecycleConfiguration.Rules;
    };
    expect(rules(getTemplate()).some(rule => 'ExpirationInDays' in rule)).toBe(false);
    expect(rules(getTemplateWith({ mediaRetentionDays: 5 }))).toEqual(
      expect.arrayContaining([expect.objectContaining({ Id: 'ExpireMedia', ExpirationInDays: 5, Status: 'Enabled' })])
    );
  });

  it('passes the bucket and the URL lifetime only to the functions that use media', () => {
    const template = getTemplate();
    for (const name of ['ws-handler', 'get-messages', 'send-message', 'media-upload-url']) {
      template.hasResourceProperties('AWS::Lambda::Function', {
        FunctionName: `${PREFIX}-whatsapp-${name}`,
        Environment: {
          Variables: Match.objectLike({
            WHATSAPP_MEDIA_BUCKET_NAME: Match.anyValue(),
            MEDIA_URL_TTL_SECONDS: '900',
          }),
        },
      });
    }
    template.hasResourceProperties('AWS::Lambda::Function', {
      FunctionName: `${PREFIX}-whatsapp-get-templates`,
      Environment: { Variables: Match.objectLike({ WHATSAPP_MEDIA_BUCKET_NAME: Match.absent() }) },
    });
    getTemplateWith({ mediaUrlTtlSeconds: 300 }).hasResourceProperties('AWS::Lambda::Function', {
      FunctionName: `${PREFIX}-whatsapp-get-messages`,
      Environment: { Variables: Match.objectLike({ MEDIA_URL_TTL_SECONDS: '300' }) },
    });
  });

  it('lets only ws-handler download and only send-message upload to WhatsApp', () => {
    const template = getTemplate();
    const download = Object.keys(policiesWith(template, { Action: 'social-messaging:GetWhatsAppMessageMedia' }));
    const upload = Object.keys(policiesWith(template, { Action: 'social-messaging:PostWhatsAppMessageMedia' }));
    expect(download).toHaveLength(1);
    expect(download[0]).toContain(policyOf('ws-handler'));
    expect(upload).toHaveLength(1);
    expect(upload[0]).toContain(policyOf('send-message'));
  });

  it('scopes the bucket permissions per function', () => {
    const policies = getTemplate().findResources('AWS::IAM::Policy') as Record<
      string,
      { Properties: { PolicyDocument: { Statement: { Action: string | string[] }[] } } }
    >;
    const allowed = (name: string, action: string) =>
      Object.entries(policies).some(
        ([id, policy]) =>
          id.startsWith(policyOf(name)) &&
          policy.Properties.PolicyDocument.Statement.some(statement =>
            ([] as string[]).concat(statement.Action).includes(action)
          )
      );
    expect(allowed('ws-handler', 's3:PutObject')).toBe(true);
    expect(allowed('ws-handler', 's3:ListBucket')).toBe(true);
    expect(allowed('media-upload-url', 's3:PutObject')).toBe(true);
    expect(allowed('media-upload-url', 's3:GetObject')).toBe(false);
    expect(allowed('get-messages', 's3:GetObject')).toBe(true);
    expect(allowed('get-messages', 's3:PutObject')).toBe(false);
    expect(allowed('send-message', 's3:PutObject')).toBe(false);
    expect(allowed('send-message', 's3:ListBucket')).toBe(false);
    expect(allowed('get-templates', 's3:GetObject')).toBe(false);
  });
});
