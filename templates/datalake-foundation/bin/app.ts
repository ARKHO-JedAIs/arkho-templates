#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from 'aws-cdk-lib';
import { DatalakeFoundationStack } from '../lib/datalake-foundation-stack';

const app = new cdk.App();

new DatalakeFoundationStack(app, '{{ project_name }}-datalake-{{ environment }}', {
  env: {
    account: '{{ aws_account_id }}',
    region: '{{ aws_region }}',
  },
  description: 'Datalake fundacional para {{ project_name }} ({{ environment }})',
});
