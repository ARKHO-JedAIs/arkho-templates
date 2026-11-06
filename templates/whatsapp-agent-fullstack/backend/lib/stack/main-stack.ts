import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import { AgentConfig, CognitoConfig, EnvironmentConfig, ParamsConfig, WhatsAppConfig } from './shared/util/env-config';
import { LayerFactory } from './layer';
import { LambdaFactory } from './lambda';
import { CognitoFactory } from './cognito';
import { ApiFactory } from './api';
import { SetupFactory } from './setup';
import { UsersFactory } from './users';
import { WhatsAppFactory } from './whatsapp';
import { AgentFactory } from './agent';
import { AccessFactory } from './access';

interface MainStackProps extends cdk.StackProps {
  env: EnvironmentConfig;
  params: ParamsConfig;
  cognito: CognitoConfig;
  whatsapp: WhatsAppConfig;
  /** Wire the /admin/users API of the frontend's Usuarios screen. */
  usersApiEnabled?: boolean;
  /** The AI agent that answers WhatsApp; unset or runtime none = no agent. */
  agent?: AgentConfig;
  /** Users the deploy puts in the hidden developer role (DEVELOPER_EMAILS). */
  developerEmails?: string[];
}

/**
 * Root stack for arkho-cli-cdk.
 *
 * Active resources: the python-common layer, the core Lambda functions
 * (authorizer, not-found), Cognito (with optional Microsoft Entra ID and Google
 * sign-in), the REST API, the WhatsApp and Users modules that register their
 * own routes on it, roles and permissions (AccessFactory: the hidden developer
 * role, /me/permissions and the realtime authorizer), and the AI agent that
 * answers WhatsApp with its prompt manager (Bedrock Prompt Management). The
 * authorizer receives the Cognito ids after the user pool is created.
 *
 * The remaining service constructs under lib/construct stay as generic,
 * reusable building blocks and are wired in as the backend grows.
 */
export class MainStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: MainStackProps) {
    super(scope, id, props);

    const { params, cognito, whatsapp, usersApiEnabled, agent, developerEmails = [] } = props;
    const { envName, projectName } = params;

    const layerFactory = new LayerFactory(this, 'LayerFactory', { params });

    const lambdaFactory = new LambdaFactory(this, 'LambdaFactory', { params, layerFactory });

    const cognitoFactory = new CognitoFactory(this, 'CognitoFactory', { params, cognito });

    const apiFactory = new ApiFactory(this, 'ApiFactory', { params, lambdaFactory });

    // Post-creation wiring: the authorizer needs the Cognito ids, which only
    // exist after the user pool is created.
    new SetupFactory(this, 'SetupFactory', { lambdaFactory, cognitoFactory });

    // Roles and permissions: every module below checks them (common.access).
    const accessFactory = new AccessFactory(this, 'AccessFactory', {
      params,
      layerFactory,
      jwtLayers: lambdaFactory.jwtLayers,
      cognitoFactory,
      apiFactory,
      developerEmails,
    });

    const whatsappFactory = new WhatsAppFactory(this, 'WhatsAppFactory', {
      params,
      whatsapp,
      layerFactory,
      cognitoFactory,
      apiFactory,
      access: accessFactory,
    });

    if (agent && agent.runtime !== 'none') {
      new AgentFactory(this, 'AgentFactory', {
        params,
        agent,
        adminGroup: whatsapp.adminGroup,
        whatsappFactory,
        configApi: { layerFactory, apiFactory, access: accessFactory },
      });
    }

    if (usersApiEnabled) {
      const usersFactory = new UsersFactory(this, 'UsersFactory', {
        params,
        adminGroup: whatsapp.adminGroup,
        layerFactory,
        cognitoFactory,
        apiFactory,
      });
      accessFactory.grantRead(usersFactory.usersLambda.function);
      accessFactory.seedAfter(...usersFactory.groups);
    }

    cdk.Tags.of(this).add('Project', projectName);
    cdk.Tags.of(this).add('Environment', envName);
  }
}
