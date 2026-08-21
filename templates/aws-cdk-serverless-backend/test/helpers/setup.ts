import * as cdk from 'aws-cdk-lib';
import { Template } from 'aws-cdk-lib/assertions';
import { MainStack } from '../../lib/stack/main-stack';

// Fixed values so the synthesized template is deterministic and does not
// depend on the developer's .env (which jest loads via dotenv).
export const TEST_ENV = {
  account: '111111111111',
  region: 'us-east-1',
};

export const TEST_PARAMS = {
  envName: 'dev',
  projectName: '{{ project_name }}',
  isProd: false,
};

let _template: Template | undefined;

export function getTemplate(): Template {
  if (!_template) {
    const app = new cdk.App();
    const stack = new MainStack(app, 'TestStack', {
      env: TEST_ENV,
      params: TEST_PARAMS,
      cognito: {
        domainPrefix: undefined,
        entraId: { enabled: false },
      },
    });
    _template = Template.fromStack(stack);
  }
  return _template;
}

export function getResources(): Record<string, { Type: string; Properties?: Record<string, unknown> }> {
  return getTemplate().toJSON().Resources;
}
