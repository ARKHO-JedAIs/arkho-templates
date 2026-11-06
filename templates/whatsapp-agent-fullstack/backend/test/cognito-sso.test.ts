import { describe, it, expect } from 'vitest';
import * as cdk from 'aws-cdk-lib';
import { Match, Template } from 'aws-cdk-lib/assertions';
import { MainStack } from '../lib/stack/main-stack';
import { getTemplate, TEST_ENV, TEST_PARAMS, TEST_WHATSAPP } from './helpers/setup';

const PREFIX = `${TEST_PARAMS.projectName}-${TEST_PARAMS.envName}`;

const ENTRA_ID = {
  enabled: true,
  clientId: 'entra-client-id',
  clientSecret: 'entra-client-secret',
  issuerUrl: 'https://login.microsoftonline.com/00000000-0000-0000-0000-000000000000/v2.0',
};

const GOOGLE = {
  enabled: true,
  clientId: 'google-client-id.apps.googleusercontent.com',
  clientSecret: 'google-client-secret',
};

function templateWith(providers: { microsoft?: boolean; google?: boolean }): Template {
  const app = new cdk.App();
  const stack = new MainStack(app, 'SsoStack', {
    env: TEST_ENV,
    params: TEST_PARAMS,
    cognito: {
      domainPrefix: PREFIX,
      entraId: providers.microsoft ? ENTRA_ID : { enabled: false },
      google: providers.google ? GOOGLE : { enabled: false },
      emailMfa: { enabled: false },
    },
    whatsapp: TEST_WHATSAPP,
  });
  return Template.fromStack(stack);
}

function outputNames(template: Template): string[] {
  return Object.keys(template.toJSON().Outputs ?? {});
}

function supportedProviders(template: Template): unknown {
  const clients = Object.values(template.findResources('AWS::Cognito::UserPoolClient'));
  expect(clients).toHaveLength(1);
  return clients[0]?.Properties?.SupportedIdentityProviders;
}

describe('Cognito sign-up and sign-in', () => {
  it('lets only an administrator create users', () => {
    getTemplate().hasResourceProperties('AWS::Cognito::UserPool', {
      AdminCreateUserConfig: Match.objectLike({ AllowAdminCreateUserOnly: true }),
    });
  });

  it('returns to the frontend after sign-in and sign-out', () => {
    getTemplate().hasResourceProperties('AWS::Cognito::UserPoolClient', {
      CallbackURLs: ['http://localhost:5173/auth/callback'],
      LogoutURLs: ['http://localhost:5173/login'],
    });
  });

  it('federates nothing and creates no Hosted UI domain without SSO', () => {
    const template = getTemplate();
    template.resourceCountIs('AWS::Cognito::UserPoolIdentityProvider', 0);
    template.resourceCountIs('AWS::Cognito::UserPoolDomain', 0);
    expect(supportedProviders(template)).toEqual(['COGNITO']);
    expect(outputNames(template).some((name) => name.includes('CognitoIdpRedirectUri'))).toBe(false);
  });

  it('signs in with Microsoft Entra ID only', () => {
    const template = templateWith({ microsoft: true });
    template.resourceCountIs('AWS::Cognito::UserPoolIdentityProvider', 1);
    template.hasResourceProperties('AWS::Cognito::UserPoolIdentityProvider', {
      ProviderName: 'EntraID',
      ProviderType: 'OIDC',
    });
    template.hasResourceProperties('AWS::Cognito::UserPoolDomain', { Domain: PREFIX });
    expect(supportedProviders(template)).toEqual(['COGNITO', 'EntraID']);
  });

  it('signs in with Google only', () => {
    const template = templateWith({ google: true });
    template.resourceCountIs('AWS::Cognito::UserPoolIdentityProvider', 1);
    template.hasResourceProperties('AWS::Cognito::UserPoolIdentityProvider', {
      ProviderName: 'Google',
      ProviderType: 'Google',
      ProviderDetails: Match.objectLike({ authorize_scopes: 'openid email profile' }),
      AttributeMapping: Match.objectLike({ email: 'email', name: 'name' }),
    });
    template.hasResourceProperties('AWS::Cognito::UserPoolDomain', { Domain: PREFIX });
    expect(supportedProviders(template)).toEqual(['COGNITO', 'Google']);
  });

  it('signs in with both and outputs the domain and redirect URI to register', () => {
    const template = templateWith({ microsoft: true, google: true });
    template.resourceCountIs('AWS::Cognito::UserPoolIdentityProvider', 2);
    template.resourceCountIs('AWS::Cognito::UserPoolDomain', 1);
    expect(supportedProviders(template)).toEqual(['COGNITO', 'EntraID', 'Google']);

    const outputs = template.toJSON().Outputs as Record<string, { Export?: { Name?: string } }>;
    const exports = Object.values(outputs).map((output) => output.Export?.Name);
    expect(exports).toContain(`${PREFIX}-CognitoDomainUrl`);
    expect(exports).toContain(`${PREFIX}-CognitoIdpRedirectUri`);
    const redirect = Object.entries(outputs).find(([name]) => name.includes('CognitoIdpRedirectUri'));
    expect(JSON.stringify(redirect?.[1])).toContain('/oauth2/idpresponse');
  });

  it('refuses a provider without a Hosted UI domain', () => {
    const app = new cdk.App();
    expect(
      () =>
        new MainStack(app, 'NoDomainStack', {
          env: TEST_ENV,
          params: TEST_PARAMS,
          cognito: {
            domainPrefix: undefined,
            entraId: { enabled: false },
            google: GOOGLE,
            emailMfa: { enabled: false },
          },
          whatsapp: TEST_WHATSAPP,
        })
    ).toThrow(/domainPrefix/);
  });
});
