import { describe, it } from 'vitest';
import * as cdk from 'aws-cdk-lib';
import { Match, Template } from 'aws-cdk-lib/assertions';
import { MainStack } from '../lib/stack/main-stack';
import { getTemplate, TEST_ENV, TEST_PARAMS, TEST_WHATSAPP } from './helpers/setup';

const PREFIX = `${TEST_PARAMS.projectName}-${TEST_PARAMS.envName}`;

function templateWithUsersApi(): Template {
  const app = new cdk.App();
  const stack = new MainStack(app, 'UsersStack', {
    env: TEST_ENV,
    params: TEST_PARAMS,
    cognito: { domainPrefix: undefined, entraId: { enabled: false }, emailMfa: { enabled: false } },
    whatsapp: TEST_WHATSAPP,
    usersApiEnabled: true,
  });
  return Template.fromStack(stack);
}

describe('UsersFactory', () => {
  it('is not wired unless USERS_API_ENABLED is true', () => {
    getTemplate().resourcePropertiesCountIs(
      'AWS::Lambda::Function',
      { FunctionName: `${PREFIX}-admin-users` },
      0
    );
  });

  it('serves the Usuarios screen from one function behind the authorizer', () => {
    const template = templateWithUsersApi();
    template.hasResourceProperties('AWS::Lambda::Function', {
      FunctionName: `${PREFIX}-admin-users`,
      Environment: {
        Variables: Match.objectLike({ ADMIN_GROUP: 'admin', MEMBER_GROUP: 'member' }),
      },
    });
    for (const pathPart of ['admin', 'users', '{username}', 'status', 'password']) {
      template.hasResourceProperties('AWS::ApiGateway::Resource', { PathPart: pathPart });
    }
  });

  it('lists the roles the caller may assign and may sign a user out', () => {
    const template = templateWithUsersApi();
    template.hasResourceProperties('AWS::ApiGateway::Resource', { PathPart: 'roles' });
    template.hasResourceProperties('AWS::IAM::Policy', {
      PolicyDocument: {
        Statement: Match.arrayWith([
          Match.objectLike({ Action: Match.arrayWith(['cognito-idp:AdminUserGlobalSignOut']) }),
        ]),
      },
    });
  });

  it('creates the admin and member role groups', () => {
    const template = templateWithUsersApi();
    template.hasResourceProperties('AWS::Cognito::UserPoolGroup', { GroupName: 'admin' });
    template.hasResourceProperties('AWS::Cognito::UserPoolGroup', { GroupName: 'member' });
  });

  it('may only call the Cognito admin actions it needs, on its own pool', () => {
    const template = templateWithUsersApi();
    template.hasResourceProperties('AWS::IAM::Policy', {
      PolicyDocument: {
        Statement: Match.arrayWith([
          Match.objectLike({
            Action: Match.arrayWith(['cognito-idp:AdminCreateUser', 'cognito-idp:AdminDeleteUser']),
            Resource: Match.objectLike({ 'Fn::GetAtt': Match.arrayWith(['Arn']) }),
          }),
        ]),
      },
    });
  });
});
