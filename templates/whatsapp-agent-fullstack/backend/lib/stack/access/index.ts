import { Duration, RemovalPolicy } from 'aws-cdk-lib';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import { UserPoolGroup } from 'aws-cdk-lib/aws-cognito';
import { Code, Function as LambdaFunction, ILayerVersion } from 'aws-cdk-lib/aws-lambda';
import { RetentionDays } from 'aws-cdk-lib/aws-logs';
import { Trigger } from 'aws-cdk-lib/triggers';
import { Construct, IConstruct } from 'constructs';
import { DynamoConstruct } from '../../construct/dynamo-construct';
import { LambdaConstruct } from '../../construct/lambda-construct';
import { ApiFactory } from '../api';
import { CognitoFactory } from '../cognito';
import { LayerFactory } from '../layer';
import { ParamsConfig } from '../shared/util/env-config';
import { PYTHON_RUNTIME } from '../shared/util/runtime';

export interface AccessFactoryProps {
  params: ParamsConfig;
  layerFactory: LayerFactory;
  /** PyJWT and cryptography, for the realtime authorizer to check the token. */
  jwtLayers: ILayerVersion[];
  cognitoFactory: CognitoFactory;
  apiFactory: ApiFactory;
  /** Users the seed puts in the developer group (by email). */
  developerEmails: string[];
}

export const DEVELOPER_GROUP = 'developer';

/**
 * Roles and permissions (common.access in the python-common layer):
 *
 * - the access-control table: what each role may see (menu) and do (actions);
 * - the hidden `developer` group (admin and member live in UsersFactory);
 * - the seed, run on deploy: default permissions where missing, the
 *   DEVELOPER_EMAILS users in developer, and `member` for users with no role;
 * - GET /me/permissions, which the frontend builds its sidebar from;
 * - the AppSync Lambda authorizer of the realtime channel, so any role with
 *   the `whatsapp` page gets live updates.
 *
 * Every function that checks permissions gets the table through `grantRead`.
 */
export class AccessFactory extends Construct {
  public readonly table: DynamoConstruct;
  public readonly realtimeAuthorizer: LambdaConstruct;
  private readonly seedTrigger: Trigger;

  constructor(scope: Construct, id: string, props: AccessFactoryProps) {
    super(scope, id);

    const { params, layerFactory, jwtLayers, cognitoFactory, apiFactory, developerEmails } = props;
    const { envName, projectName, isProd } = params;
    const prefix = `${projectName}-${envName}`;
    const userPool = cognitoFactory.cognitoConstruct.userPool;
    const commonLayer = layerFactory.pythonCommonLayer.layer;
    const logging = {
      logRetention: RetentionDays.ONE_MONTH,
      removalPolicy: isProd ? RemovalPolicy.RETAIN : RemovalPolicy.DESTROY,
    };

    this.table = new DynamoConstruct(this, 'AccessTable', {
      params,
      tableConfig: {
        tableName: `${prefix}-access-control`,
        partitionKey: { name: 'PK', type: dynamodb.AttributeType.STRING },
        sortKey: { name: 'SK', type: dynamodb.AttributeType.STRING },
        billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      },
    });

    const developerGroup = new UserPoolGroup(this, 'DeveloperGroup', {
      userPool,
      groupName: DEVELOPER_GROUP,
      description: 'Developers (hidden): every screen, including the technical settings',
      precedence: 0,
    });

    const seed = new LambdaConstruct(this, 'SeedLambda', {
      functionName: `${prefix}-access-seed`,
      description: 'Seeds the default roles and assigns developer and member groups',
      code: Code.fromAsset('src/lambda/access/seed'),
      handler: 'index.handler',
      runtime: PYTHON_RUNTIME,
      layers: [commonLayer],
      timeout: Duration.minutes(2),
      environment: {
        USER_POOL_ID: userPool.userPoolId,
        DEVELOPER_EMAILS: developerEmails.join(','),
      },
      logging,
    });
    this.grantRead(seed.function);
    this.table.table.grantWriteData(seed.function);
    userPool.grant(
      seed.function,
      'cognito-idp:ListUsers',
      'cognito-idp:AdminListGroupsForUser',
      'cognito-idp:AdminAddUserToGroup'
    );
    this.seedTrigger = new Trigger(this, 'SeedTrigger', {
      handler: seed.function,
      executeOnHandlerChange: true,
      executeAfter: [this.table, developerGroup],
    });

    const mePermissions = new LambdaConstruct(this, 'MePermissionsLambda', {
      functionName: `${prefix}-me-permissions`,
      description: 'What the signed-in user may see and do',
      code: Code.fromAsset('src/lambda/access/me-permissions'),
      handler: 'index.handler',
      runtime: PYTHON_RUNTIME,
      layers: [commonLayer],
      logging,
    });
    this.grantRead(mePermissions.function);
    apiFactory.restApi.addRoute({ path: '/me/permissions', method: 'GET', lambda: mePermissions.function });

    this.realtimeAuthorizer = new LambdaConstruct(this, 'RealtimeAuthorizerLambda', {
      functionName: `${prefix}-realtime-authorizer`,
      description: 'AppSync authorizer: Cognito token plus the whatsapp permission',
      code: Code.fromAsset('src/lambda/access/appsync-authorizer'),
      handler: 'index.handler',
      runtime: PYTHON_RUNTIME,
      layers: [commonLayer, ...jwtLayers],
      timeout: Duration.seconds(10),
      memorySize: 256,
      environment: {
        USER_POOL_ID: userPool.userPoolId,
        APP_CLIENT_ID: cognitoFactory.userPoolClientId,
        REQUIRED_PERMISSION: 'whatsapp',
      },
      logging,
    });
    this.grantRead(this.realtimeAuthorizer.function);
  }

  /** Lets a function read the permissions (common.access) and tells it where they are. */
  public grantRead(fn: LambdaFunction): void {
    this.table.table.grantReadData(fn);
    fn.addEnvironment('ACCESS_TABLE_NAME', this.table.tableName);
  }

  /** Runs the seed only after these exist (the admin and member groups). */
  public seedAfter(...constructs: IConstruct[]): void {
    this.seedTrigger.executeAfter(...constructs);
  }
}
