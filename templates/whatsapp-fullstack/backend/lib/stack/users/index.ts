import { RemovalPolicy } from 'aws-cdk-lib';
import { UserPoolGroup } from 'aws-cdk-lib/aws-cognito';
import { Code } from 'aws-cdk-lib/aws-lambda';
import { RetentionDays } from 'aws-cdk-lib/aws-logs';
import { Construct } from 'constructs';
import { LambdaConstruct } from '../../construct/lambda-construct';
import { ApiFactory } from '../api';
import { CognitoFactory } from '../cognito';
import { LayerFactory } from '../layer';
import { ParamsConfig } from '../shared/util/env-config';
import { PYTHON_RUNTIME } from '../shared/util/runtime';

export interface UsersFactoryProps {
  params: ParamsConfig;
  /** Group that may manage users; empty = any signed-in user (single profile). */
  adminGroup: string;
  layerFactory: LayerFactory;
  cognitoFactory: CognitoFactory;
  apiFactory: ApiFactory;
}

const MEMBER_GROUP = 'member';

// Every route the frontend's Usuarios screen calls; one function serves them all.
const ROUTES = [
  { path: '/admin/users', method: 'GET' },
  { path: '/admin/users', method: 'POST' },
  { path: '/admin/users/{username}', method: 'PATCH' },
  { path: '/admin/users/{username}', method: 'DELETE' },
  { path: '/admin/users/{username}/status', method: 'PATCH' },
  { path: '/admin/users/{username}/password', method: 'POST' },
];

/**
 * The user-management API behind the frontend's Usuarios screen: list, create
 * (Cognito emails the temporary password), edit, enable/disable, reset the
 * password and delete Cognito users, plus the `admin` and `member` role
 * groups. Wired only when USERS_API_ENABLED=true.
 */
export class UsersFactory extends Construct {
  public readonly usersLambda: LambdaConstruct;

  constructor(scope: Construct, id: string, props: UsersFactoryProps) {
    super(scope, id);

    const { params, adminGroup, layerFactory, cognitoFactory, apiFactory } = props;
    const { envName, projectName, isProd } = params;
    const userPool = cognitoFactory.cognitoConstruct.userPool;

    for (const [groupId, groupName, description] of [
      ['AdminGroup', adminGroup || 'admin', 'Administrators: every screen, including Usuarios'],
      ['MemberGroup', MEMBER_GROUP, 'Members: the regular screens'],
    ]) {
      new UserPoolGroup(this, groupId, { userPool, groupName, description });
    }

    this.usersLambda = new LambdaConstruct(this, 'AdminUsersLambda', {
      functionName: `${projectName}-${envName}-admin-users`,
      description: 'User management API for the Usuarios screen',
      code: Code.fromAsset('src/lambda/users/admin-users'),
      handler: 'index.handler',
      runtime: PYTHON_RUNTIME,
      layers: [layerFactory.pythonCommonLayer.layer],
      environment: {
        USER_POOL_ID: userPool.userPoolId,
        ADMIN_GROUP: adminGroup,
        MEMBER_GROUP,
      },
      logging: {
        logRetention: RetentionDays.ONE_MONTH,
        removalPolicy: isProd ? RemovalPolicy.RETAIN : RemovalPolicy.DESTROY,
      },
    });

    userPool.grant(
      this.usersLambda.function,
      'cognito-idp:ListUsers',
      'cognito-idp:AdminCreateUser',
      'cognito-idp:AdminUpdateUserAttributes',
      'cognito-idp:AdminEnableUser',
      'cognito-idp:AdminDisableUser',
      'cognito-idp:AdminDeleteUser',
      'cognito-idp:AdminSetUserPassword',
      'cognito-idp:AdminListGroupsForUser',
      'cognito-idp:AdminAddUserToGroup',
      'cognito-idp:AdminRemoveUserFromGroup'
    );

    for (const route of ROUTES) {
      apiFactory.restApi.addRoute({ ...route, lambda: this.usersLambda.function });
    }
  }
}
