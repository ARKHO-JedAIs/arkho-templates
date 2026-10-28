import { describe, it, expect } from 'vitest';
import * as cdk from 'aws-cdk-lib';
import { Template } from 'aws-cdk-lib/assertions';
import { MainStack } from '../lib/stack/main-stack';
import { getTemplate, TEST_ENV, TEST_PARAMS, TEST_WHATSAPP } from './helpers/setup';

function templateWithEmailMfa(): Template {
  const app = new cdk.App();
  const stack = new MainStack(app, 'MfaStack', {
    env: TEST_ENV,
    params: TEST_PARAMS,
    cognito: {
      domainPrefix: undefined,
      entraId: { enabled: false },
      emailMfa: { enabled: true, fromEmail: 'no-reply@example.com' },
    },
    whatsapp: TEST_WHATSAPP,
  });
  return Template.fromStack(stack);
}

describe('Cognito email MFA', () => {
  it('is off by default', () => {
    // CDK omits MfaConfiguration when MFA is not set, which Cognito reads as OFF.
    const pools = Object.values(getTemplate().findResources('AWS::Cognito::UserPool'));
    expect(pools).toHaveLength(1);
    expect(pools[0]?.Properties?.MfaConfiguration ?? 'OFF').toBe('OFF');
  });

  it('requires an emailed code sent through SES when enabled', () => {
    const template = templateWithEmailMfa();
    template.hasResourceProperties('AWS::Cognito::UserPool', {
      MfaConfiguration: 'ON',
      EnabledMfas: ['EMAIL_OTP'],
      EmailConfiguration: { EmailSendingAccount: 'DEVELOPER' },
    });
    template.hasResourceProperties('AWS::Cognito::UserPoolClient', {
      AuthSessionValidity: 10,
    });
  });
});
