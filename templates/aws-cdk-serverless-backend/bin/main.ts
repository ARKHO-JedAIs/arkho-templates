#!/usr/bin/env node
import * as cdk from 'aws-cdk-lib';
import { MainStack } from '../lib/stack/main-stack';
import { config } from '../lib/stack/shared/util/env-config';
import { capitalizeFirstLetter } from '../lib/stack/shared/util/capitalize';

const app = new cdk.App();
const { env, params, cognito } = config;
const { envName, projectName } = params;
const mainStackName = `${capitalizeFirstLetter(projectName)}${capitalizeFirstLetter(envName)}Stack`;

new MainStack(app, mainStackName, {
  env,
  params,
  cognito,
});
