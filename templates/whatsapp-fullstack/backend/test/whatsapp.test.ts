import { Match } from 'aws-cdk-lib/assertions';
import { getTemplate, TEST_PARAMS } from './helpers/setup';

const PREFIX = `${TEST_PARAMS.projectName}-${TEST_PARAMS.envName}`;

const FUNCTIONS = [
  'ws-handler',
  'get-conversations',
  'get-messages',
  'send-message',
  'get-templates',
  'send-template',
  'put-control',
];

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

  it('exposes the WhatsApp routes behind the authorizer', () => {
    const template = getTemplate();
    for (const pathPart of ['conversations', 'messages', 'templates', 'send', 'control']) {
      template.hasResourceProperties('AWS::ApiGateway::Resource', { PathPart: pathPart });
    }
    const methods = template.findResources('AWS::ApiGateway::Method', {
      Properties: { AuthorizationType: 'CUSTOM' },
    });
    // presigned-url plus the six WhatsApp routes.
    expect(Object.keys(methods).length).toBeGreaterThanOrEqual(7);
  });
});
