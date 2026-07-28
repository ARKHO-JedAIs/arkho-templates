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
import { NetworkStack } from '../lib/stacks/network-stack';

const app = new cdk.App();
const cfg = getConfig(app.node.tryGetContext('env') ?? '{{ environment }}');
const p = prefix(cfg);

const env: cdk.Environment = {
  account: '{{ aws_account_id }}',
  region: cfg.region,
};
const common = { env, terminationProtection: cfg.terminationProtection };

// Flags opcionales leídos desde cdk.json context (baked en la generación)
const enableIngestionLambdas = app.node.tryGetContext('enableIngestionLambdas') !== 'false';
const enableVpc = app.node.tryGetContext('enableVpc') === 'true';
const vpcCidr = (app.node.tryGetContext('vpcCidr') as string | undefined) ?? '10.0.0.0/16';

// ── Stack 1: Red (opcional) ───────────────────────────────────────────────────
const network = enableVpc
  ? new NetworkStack(app, `${p}-network`, { ...common, vpcCidr })
  : undefined;

// ── Stack 2: Seguridad — KMS CMKs + SNS alertas ───────────────────────────────
const security = new SecurityStack(app, `${p}-security`, { ...common, config: cfg });

// ── Stack 3: Storage — 4 zonas S3 + Athena results + access logs ──────────────
const storage = new StorageStack(app, `${p}-storage`, {
  ...common,
  config: cfg,
  dataKey: security.dataKey,
});

// ── Stack 4: Gobernanza — Glue Catalog + Lake Formation FGAC ──────────────────
new GovernanceStack(app, `${p}-governance`, {
  ...common,
  config: cfg,
  rawBucket: storage.rawBucket,
  cleanBucket: storage.cleanBucket,
  curatedBucket: storage.curatedBucket,
});

// ── Stack 5: Ingesta (opcional) — Lambdas API + SFTP Connector ────────────────
if (enableIngestionLambdas) {
  new IngestionStack(app, `${p}-ingestion`, {
    ...common,
    config: cfg,
    rawBucket: storage.rawBucket,
    dataKey: security.dataKey,
    opsKey: security.opsKey,
    alertsTopic: security.alertsTopic,
  });
}

// ── Stack 6: Procesamiento — Glue ETL + Step Functions ───────────────────────
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

// ── Stack 7: Consumo — Athena Workgroup ──────────────────────────────────────
new ConsumptionStack(app, `${p}-consumption`, {
  ...common,
  config: cfg,
  athenaResultsBucket: storage.athenaResultsBucket,
  dataKey: security.dataKey,
});

// ── Stack 8: Observabilidad — CloudTrail con data events ─────────────────────
new ObservabilityStack(app, `${p}-observability`, {
  ...common,
  config: cfg,
  dataBuckets: [
    storage.rawBucket,
    storage.cleanBucket,
    storage.curatedBucket,
    storage.archiveBucket,
  ],
});

// ── Tags transversales (FinOps + trazabilidad) ────────────────────────────────
cdk.Tags.of(app).add('proyecto', '{{ project_slug }}');
cdk.Tags.of(app).add('cliente', '{{ client_name }}');
cdk.Tags.of(app).add('ambiente', cfg.envName);
cdk.Tags.of(app).add('gestionado-por', 'cdk');
cdk.Tags.of(app).add('owner', 'arkho');

// cdk-nag (AWS Solutions checks): ejecutar con `{{ package_manager }} run nag`
if (app.node.tryGetContext('nag') === 'true') {
  cdk.Aspects.of(app).add(new AwsSolutionsChecks({ verbose: true }));
}
