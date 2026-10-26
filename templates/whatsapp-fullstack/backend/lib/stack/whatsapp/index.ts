import { readFileSync } from 'fs';
import { CfnOutput, Duration, RemovalPolicy, Stack } from 'aws-cdk-lib';
import * as appsync from 'aws-cdk-lib/aws-appsync';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as iam from 'aws-cdk-lib/aws-iam';
import { Code } from 'aws-cdk-lib/aws-lambda';
import { RetentionDays } from 'aws-cdk-lib/aws-logs';
import * as ssm from 'aws-cdk-lib/aws-ssm';
import { Construct } from 'constructs';
import { AppSyncConstruct } from '../../construct/appsync-construct';
import { DynamoConstruct } from '../../construct/dynamo-construct';
import { LambdaConstruct } from '../../construct/lambda-construct';
import { SnsConstruct } from '../../construct/sns-construct';
import { SsmParametersConstruct } from '../../construct/ssm-parameters-construct';
import { ApiFactory } from '../api';
import { CognitoFactory } from '../cognito';
import { LayerFactory } from '../layer';
import { ParamsConfig } from '../shared/util/env-config';
import { PYTHON_RUNTIME } from '../shared/util/runtime';

export interface WhatsAppFactoryProps {
  params: ParamsConfig;
  layerFactory: LayerFactory;
  cognitoFactory: CognitoFactory;
  apiFactory: ApiFactory;
}

const CONFIGURATION_FILE = 'src/parameter/whatsapp-configuration.json';
const SCHEMA_FILE = 'src/graphql/schema.graphql';
const CONFIGURATION_KEY = 'whatsappConfiguration';
const PUBLISH_EVENT_FIELD = 'publishEvent';

// Local resolver: the arguments are returned as the mutation result, which is
// what AppSync forwards to the subscribers of the event id.
const PUBLISH_EVENT_REQUEST = `
{
  "version": "2018-05-29",
  "payload": {
    "id": $util.toJson($ctx.args.id),
    "type": $util.toJson($ctx.args.type),
    "message": $util.toJson($ctx.args.message),
    "payload": $util.toJson($ctx.args.payload),
    "timestamp": $util.toJson($util.time.nowISO8601())
  }
}
`;
const PING_REQUEST = `{ "version": "2018-05-29", "payload": "pong" }`;
const RESOLVER_RESPONSE = `
#if($ctx.error)
  $util.error($ctx.error.message, $ctx.error.type)
#end
$util.toJson($ctx.result)
`;

interface WhatsAppFunction {
  name: string;
  description: string;
  route?: { path: string; method: string };
  tables: 'read' | 'write';
  sends?: boolean;
  readsTemplates?: boolean;
}

// One Lambda per folder under src/lambda/whatsapp. `route` exposes it on the
// REST API behind the authorizer; ws-handler has none, SNS invokes it.
const FUNCTIONS: WhatsAppFunction[] = [
  { name: 'ws-handler', description: 'Receives WhatsApp messages from End User Messaging Social (SNS)', tables: 'write', sends: true },
  { name: 'get-conversations', description: 'Lists the WhatsApp conversations', route: { path: '/whatsapp/conversations', method: 'GET' }, tables: 'read' },
  { name: 'get-messages', description: 'Returns one WhatsApp conversation', route: { path: '/whatsapp/messages', method: 'GET' }, tables: 'read' },
  { name: 'send-message', description: 'Sends a WhatsApp text message from the web', route: { path: '/whatsapp/messages', method: 'POST' }, tables: 'write', sends: true },
  { name: 'get-templates', description: 'Lists the approved WhatsApp templates', route: { path: '/whatsapp/templates', method: 'GET' }, tables: 'read', readsTemplates: true },
  { name: 'send-template', description: 'Sends an approved WhatsApp template', route: { path: '/whatsapp/templates/send', method: 'POST' }, tables: 'write', sends: true },
  { name: 'put-control', description: 'Hands a conversation to a person or back to the automatic replies', route: { path: '/whatsapp/control', method: 'PUT' }, tables: 'write' },
];

/**
 * Everything WhatsApp, in one module so the rest of the backend stays as the
 * aws-cdk-serverless-backend template ships it.
 *
 * Inbound: the WABA (created from the End User Messaging Social console) sends
 * its notifications to the ws-handler SNS topic. Outbound: the functions call
 * socialmessaging:SendWhatsAppMessage with their IAM role, so no Meta token is
 * stored. Conversations and messages live in DynamoDB; every change is
 * announced on the AppSync events API the front subscribes to.
 */
export class WhatsAppFactory extends Construct {
  public readonly conversationsTable: DynamoConstruct;
  public readonly messagesTable: DynamoConstruct;
  public readonly topic: SnsConstruct;
  public readonly eventsApi: AppSyncConstruct;
  public readonly functions: Record<string, LambdaConstruct> = {};

  constructor(scope: Construct, id: string, props: WhatsAppFactoryProps) {
    super(scope, id);

    const { params, layerFactory, cognitoFactory, apiFactory } = props;
    const { envName, projectName, isProd } = params;
    const { account, partition, region } = Stack.of(this);
    const prefix = `${projectName}-${envName}`;

    this.conversationsTable = new DynamoConstruct(this, 'ConversationsTable', {
      params,
      tableConfig: {
        tableName: `${prefix}-whatsapp-conversations`,
        partitionKey: { name: 'phone', type: dynamodb.AttributeType.STRING },
        billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      },
    });

    this.messagesTable = new DynamoConstruct(this, 'MessagesTable', {
      params,
      tableConfig: {
        tableName: `${prefix}-whatsapp-messages`,
        partitionKey: { name: 'phone', type: dynamodb.AttributeType.STRING },
        sortKey: { name: 'date', type: dynamodb.AttributeType.STRING },
        billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      },
    });

    // Parsed here so a malformed file fails the synth instead of the Lambdas.
    const configuration = JSON.parse(readFileSync(CONFIGURATION_FILE, 'utf-8'));
    const parameters = new SsmParametersConstruct(this, 'Parameters', {
      params,
      parameterConfigs: [
        {
          key: CONFIGURATION_KEY,
          parameterName: `/${prefix}-whatsapp-configuration`,
          simpleName: false,
          stringValue: JSON.stringify(configuration),
          dataType: ssm.ParameterDataType.TEXT,
          description: 'WhatsApp configuration: phone number id, WABA id, default prefix, auto reply',
        },
      ],
    });

    this.eventsApi = new AppSyncConstruct(this, 'EventsApi', {
      params,
      apiName: `${prefix}-whatsapp-events`,
      schemaPath: SCHEMA_FILE,
      defaultAuthorization: {
        authorizationType: appsync.AuthorizationType.USER_POOL,
        userPoolConfig: { userPool: cognitoFactory.cognitoConstruct.userPool },
      },
      additionalAuthorizationModes: [{ authorizationType: appsync.AuthorizationType.IAM }],
    });
    const events = this.eventsApi.addNoneDataSource('Events', {
      description: 'Local data source: events are only forwarded to their subscribers',
    });
    events.createResolver('PublishEvent', {
      typeName: 'Mutation',
      fieldName: PUBLISH_EVENT_FIELD,
      requestMappingTemplate: appsync.MappingTemplate.fromString(PUBLISH_EVENT_REQUEST),
      responseMappingTemplate: appsync.MappingTemplate.fromString(RESOLVER_RESPONSE),
    });
    events.createResolver('Ping', {
      typeName: 'Query',
      fieldName: 'ping',
      requestMappingTemplate: appsync.MappingTemplate.fromString(PING_REQUEST),
      responseMappingTemplate: appsync.MappingTemplate.fromString(RESOLVER_RESPONSE),
    });

    const logging = {
      logRetention: RetentionDays.ONE_MONTH,
      removalPolicy: isProd ? RemovalPolicy.RETAIN : RemovalPolicy.DESTROY,
    };

    // The phone numbers and the WABA are created from the console, so their ids
    // are unknown at synth time: the scope is every one of this account.
    const sendStatement = new iam.PolicyStatement({
      actions: ['social-messaging:SendWhatsAppMessage'],
      resources: [`arn:${partition}:social-messaging:${region}:${account}:phone-number-id/*`],
    });
    const templatesStatement = new iam.PolicyStatement({
      actions: ['social-messaging:ListWhatsAppMessageTemplates', 'social-messaging:GetWhatsAppMessageTemplate'],
      resources: [`arn:${partition}:social-messaging:${region}:${account}:waba/*`],
    });

    for (const definition of FUNCTIONS) {
      const fn = new LambdaConstruct(this, `${definition.name}-lambda`, {
        functionName: `${prefix}-whatsapp-${definition.name}`,
        description: definition.description,
        code: Code.fromAsset(`src/lambda/whatsapp/${definition.name}`),
        handler: 'index.handler',
        runtime: PYTHON_RUNTIME,
        layers: [layerFactory.pythonCommonLayer.layer],
        timeout: Duration.seconds(30),
        environment: {
          WHATSAPP_CONVERSATIONS_TABLE_NAME: this.conversationsTable.tableName,
          WHATSAPP_MESSAGES_TABLE_NAME: this.messagesTable.tableName,
          WHATSAPP_CONFIGURATION_PARAMETER_NAME: parameters.getParameterName(CONFIGURATION_KEY),
          APPSYNC_GRAPHQL_URL: this.eventsApi.graphqlUrl,
        },
        logging,
      });
      this.functions[definition.name] = fn;

      if (definition.tables === 'write') {
        this.conversationsTable.table.grantReadWriteData(fn.function);
        this.messagesTable.table.grantReadWriteData(fn.function);
      } else {
        this.conversationsTable.table.grantReadData(fn.function);
        this.messagesTable.table.grantReadData(fn.function);
      }
      parameters.grantRead(fn.function, CONFIGURATION_KEY);
      this.eventsApi.grantMutation(fn.function, PUBLISH_EVENT_FIELD);
      if (definition.sends) fn.function.addToRolePolicy(sendStatement);
      if (definition.readsTemplates) fn.function.addToRolePolicy(templatesStatement);

      if (definition.route) {
        apiFactory.restApi.addRoute({
          path: definition.route.path,
          method: definition.route.method,
          lambda: fn.function,
        });
      }
    }

    // End User Messaging Social does not support FIFO topics.
    this.topic = new SnsConstruct(this, 'WsHandlerTopic', {
      params,
      topicConfig: {
        topicName: `${prefix}-whatsapp-ws-handler`,
        displayName: 'WhatsApp messages and events for the ws-handler Lambda',
        enforceSSL: true,
      },
    });
    this.topic.addLambdaSubscription(this.functions['ws-handler'].function);
    // The service publishes the WABA notifications itself, so the permission is
    // a topic policy for its principal, scoped to this account.
    this.topic.addToResourcePolicy(
      new iam.PolicyStatement({
        sid: 'AllowEndUserMessagingSocialPublish',
        effect: iam.Effect.ALLOW,
        principals: [new iam.ServicePrincipal('social-messaging.amazonaws.com')],
        actions: ['sns:Publish'],
        resources: [this.topic.topicArn],
        conditions: {
          StringEquals: { 'aws:SourceAccount': account },
          ArnLike: { 'aws:SourceArn': `arn:${partition}:social-messaging:${region}:${account}:*` },
        },
      })
    );

    new CfnOutput(this, 'WhatsAppTopicArn', {
      value: this.topic.topicArn,
      description: 'Set it as the event destination of the WABA in End User Messaging Social',
      exportName: `${prefix}-WhatsAppTopicArn`,
    });
    new CfnOutput(this, 'WhatsAppEventsGraphqlUrl', {
      value: this.eventsApi.graphqlUrl,
      description: 'VITE_APPSYNC_URL of the frontend',
      exportName: `${prefix}-WhatsAppEventsGraphqlUrl`,
    });
    new CfnOutput(this, 'WhatsAppConfigurationParameterName', {
      value: parameters.getParameterName(CONFIGURATION_KEY),
      description: 'Parameter Store name of the WhatsApp configuration',
      exportName: `${prefix}-WhatsAppConfigurationParameterName`,
    });
  }
}
