#!/usr/bin/env node
import * as cdk from 'aws-cdk-lib';
import { AwsSolutionsChecks } from 'cdk-nag';
import { getConfig, prefix } from '../lib/config/environments';
import { SecurityStack } from '../lib/stacks/security-stack';
import { StorageStack } from '../lib/stacks/storage-stack';
import { GovernanceStack } from '../lib/stacks/governance-stack';
import { IngestionStack } from '../lib/stacks/ingestion-stack';
import { ProcessingStack } from '../lib/stacks/processing-stack';
import { ConsumptionStack } from '../lib/stacks/consumption-stack';
import { ObservabilityStack } from '../lib/stacks/observability-stack';

const app = new cdk.App();
const cfg = getConfig(app.node.tryGetContext('env') ?? 'dev');
const p = prefix(cfg);
const env: cdk.Environment = {
  account: cfg.account ?? process.env.CDK_DEFAULT_ACCOUNT,
  region: cfg.region,
};
const common = { env, terminationProtection: cfg.terminationProtection };

const security = new SecurityStack(app, `${p}-security`, { ...common, config: cfg });

const storage = new StorageStack(app, `${p}-storage`, {
  ...common,
  config: cfg,
  dataKey: security.dataKey,
});

new GovernanceStack(app, `${p}-governance`, {
  ...common,
  config: cfg,
  rawBucket: storage.rawBucket,
  cleanBucket: storage.cleanBucket,
  curatedBucket: storage.curatedBucket,
});

new IngestionStack(app, `${p}-ingestion`, {
  ...common,
  config: cfg,
  rawBucket: storage.rawBucket,
  dataKey: security.dataKey,
  opsKey: security.opsKey,
  alertsTopic: security.alertsTopic,
});

new ProcessingStack(app, `${p}-processing`, {
  ...common,
  config: cfg,
  rawBucket: storage.rawBucket,
  cleanBucket: storage.cleanBucket,
  curatedBucket: storage.curatedBucket,
  dataKey: security.dataKey,
  opsKey: security.opsKey,
  alertsTopic: security.alertsTopic,
});

new ConsumptionStack(app, `${p}-consumption`, {
  ...common,
  config: cfg,
  athenaResultsBucket: storage.athenaResultsBucket,
  dataKey: security.dataKey,
});

new ObservabilityStack(app, `${p}-observability`, {
  ...common,
  config: cfg,
  dataBuckets: [storage.rawBucket, storage.cleanBucket, storage.curatedBucket],
});

// Tagging transversal: FinOps + trazabilidad (mejor práctica: tags a nivel de app)
cdk.Tags.of(app).add('proyecto', '{{ project_slug }}');
cdk.Tags.of(app).add('cliente', '{{ project_slug }}');
cdk.Tags.of(app).add('ambiente', cfg.envName);
cdk.Tags.of(app).add('gestionado-por', 'cdk');
cdk.Tags.of(app).add('owner', 'arkho');

// cdk-nag (AWS Solutions): `npm run nag` o -c nag=true
if (app.node.tryGetContext('nag') === 'true') {
  cdk.Aspects.of(app).add(new AwsSolutionsChecks({ verbose: true }));
}
