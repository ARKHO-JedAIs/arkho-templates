#!/usr/bin/env node
import * as cdk from 'aws-cdk-lib';
import { AwsSolutionsChecks } from 'cdk-nag';
import { getConfig, prefix } from '../lib/config/environments';
import { applyStandardTags } from '../lib/config/tags';
import { SecurityStack } from '../lib/stacks/security-stack';
import { StorageStack } from '../lib/stacks/storage-stack';
import { GovernanceStack } from '../lib/stacks/governance-stack';
import { IngestionStack } from '../lib/stacks/ingestion-stack';
import { ProcessingStack } from '../lib/stacks/processing-stack';
import { ConsumptionStack } from '../lib/stacks/consumption-stack';
import { ObservabilityStack } from '../lib/stacks/observability-stack';
import { NetworkStack } from '../lib/stacks/network-stack';

const app = new cdk.App();
// `env` viene del context en cdk.json (baked a {{ environment }}); se puede
// sobreescribir en despliegue con `-c env=qa|stg|prod`.
const cfg = getConfig(app.node.tryGetContext('env'));
const p = prefix(cfg);

// Cuenta y región salen del ambiente: con la estrategia de una cuenta por
// ambiente, cada uno apunta a la suya. `getConfig` ya validó los 12 dígitos, y
// fijar la cuenta explícitamente hace que el CDK CLI aborte si las credenciales
// activas (AWS_PROFILE) son de otra cuenta — es el seguro contra desplegar prod
// con el perfil de dev.
const env: cdk.Environment = {
  account: cfg.account,
  region: cfg.region,
};
const common = { env, terminationProtection: cfg.terminationProtection };

// Flags opcionales leídos desde cdk.json context (baked en la generación)
const enableIngestionLambdas = app.node.tryGetContext('enableIngestionLambdas') !== 'false';
const enableVpc = app.node.tryGetContext('enableVpc') === 'true';
const vpcCidr = (app.node.tryGetContext('vpcCidr') as string | undefined) ?? '10.0.0.0/16';

// ── Stack 1: Red (opcional) ───────────────────────────────────────────────────
// Se despliega por adelantado como building block: no se le asocia ningún
// recurso automáticamente (ver el docstring de NetworkStack).
if (enableVpc) {
  new NetworkStack(app, `${p}-network`, {
    ...common,
    vpcCidr,
    removalPolicy: cfg.removalPolicy,
  });
}

// ── Stack 2: Seguridad — KMS CMKs + SNS alertas ───────────────────────────────
const security = new SecurityStack(app, `${p}-security`, { ...common, config: cfg });

// ── Stack 3: Storage — 4 zonas S3 + Athena results + access logs ──────────────
// `enableObjectLock` es IRREVERSIBLE en los buckets que lo reciben: solo se puede
// activar al crearlos y nunca desactivar. Ver StorageStack.
const enableObjectLock = app.node.tryGetContext('enableObjectLock') !== 'false';

const storage = new StorageStack(app, `${p}-storage`, {
  ...common,
  config: cfg,
  dataKey: security.dataKey,
  enableObjectLock,
});

// ── Stack 4: Gobernanza — Glue Catalog + Lake Formation FGAC ──────────────────
const governance = new GovernanceStack(app, `${p}-governance`, {
  ...common,
  config: cfg,
  rawBucket: storage.rawBucket,
  cleanBucket: storage.cleanBucket,
  curatedBucket: storage.curatedBucket,
  archiveBucket: storage.archiveBucket,
  athenaResultsBucket: storage.athenaResultsBucket,
  dataKey: security.dataKey,
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
const processing = new ProcessingStack(app, `${p}-processing`, {
  ...common,
  config: cfg,
  rawBucket: storage.rawBucket,
  cleanBucket: storage.cleanBucket,
  curatedBucket: storage.curatedBucket,
  archiveBucket: storage.archiveBucket,
  quarantineBucket: storage.quarantineBucket,
  dataKey: security.dataKey,
  opsKey: security.opsKey,
  alertsTopic: security.alertsTopic,
});

// Los crawlers referencian las bases de datos Glue por NOMBRE (string), no por
// Ref de CloudFormation, así que no existe dependencia implícita: sin esto
// `deploy --all` puede intentar crear los crawlers antes que sus bases.
processing.addStackDependency(governance);

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
  // La alarma de "el pipeline no corrió" necesita la máquina de estados.
  stateMachine: processing.stateMachine,
  alertsTopic: security.alertsTopic,
  enableObjectLock,
});

// ── Tags transversales (FinOps + trazabilidad) ────────────────────────────────
// Set base + los tags extra que exija la organización del cliente. La lógica vive
// en lib/config/tags.ts; acá solo se aplica al app para que alcance todos los stacks.
applyStandardTags(app, cfg);

// cdk-nag (AWS Solutions checks): ejecutar con `{{ package_manager }} run nag`
if (app.node.tryGetContext('nag') === 'true') {
  cdk.Aspects.of(app).add(new AwsSolutionsChecks({ verbose: true }));
}
