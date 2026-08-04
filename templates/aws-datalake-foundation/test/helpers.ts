import * as cdk from 'aws-cdk-lib';
import { DatalakeConfig, getConfig } from '../lib/config/environments';
import { SecurityStack } from '../lib/stacks/security-stack';
import { StorageStack } from '../lib/stacks/storage-stack';
import { GovernanceStack } from '../lib/stacks/governance-stack';
import { ProcessingStack } from '../lib/stacks/processing-stack';
import { NetworkStack } from '../lib/stacks/network-stack';
import { ConsumptionStack } from '../lib/stacks/consumption-stack';
import { ObservabilityStack } from '../lib/stacks/observability-stack';

/**
 * Constructor único de stacks para los tests.
 *
 * Existe para que agregar un prop a un stack toque UN lugar y no los seis archivos
 * de test. El wiring espeja `bin/app.ts` a propósito: si divergen, los tests estarían
 * validando una topología que no es la que se despliega.
 */
export interface BuildOptions {
  /** Contexto de CDK, para los flags que leen los stacks (lfAdminArn, lfStrictMode…). */
  readonly context?: Record<string, unknown>;
  /** Object Lock en Archive y el trail. Default `true`, igual que el app. */
  readonly enableObjectLock?: boolean;
}

export interface BuiltStacks {
  readonly app: cdk.App;
  readonly cfg: DatalakeConfig;
  readonly security: SecurityStack;
  readonly storage: StorageStack;
  readonly governance: GovernanceStack;
  readonly processing: ProcessingStack;
  readonly network: NetworkStack;
  readonly consumption: ConsumptionStack;
  readonly observability: ObservabilityStack;
}

/** Construye el set completo de stacks para un ambiente. */
export function buildStacks(
  prefix: string,
  cfg: DatalakeConfig,
  opts: BuildOptions = {},
): BuiltStacks {
  const app = new cdk.App({ context: opts.context });
  // La cuenta sale de la config, igual que en bin/app.ts: así un `accountOr` roto
  // hace fallar la suite en vez de pasar con una cuenta sintética.
  const env = { account: cfg.account, region: cfg.region };
  const common = { env, config: cfg };
  const enableObjectLock = opts.enableObjectLock ?? true;

  const security = new SecurityStack(app, `${prefix}Security`, common);
  const storage = new StorageStack(app, `${prefix}Storage`, {
    ...common,
    dataKey: security.dataKey,
    enableObjectLock,
  });
  const governance = new GovernanceStack(app, `${prefix}Governance`, {
    ...common,
    rawBucket: storage.rawBucket,
    cleanBucket: storage.cleanBucket,
    curatedBucket: storage.curatedBucket,
    archiveBucket: storage.archiveBucket,
    athenaResultsBucket: storage.athenaResultsBucket,
    dataKey: security.dataKey,
  });
  const processing = new ProcessingStack(app, `${prefix}Processing`, {
    ...common,
    rawBucket: storage.rawBucket,
    cleanBucket: storage.cleanBucket,
    curatedBucket: storage.curatedBucket,
    archiveBucket: storage.archiveBucket,
    quarantineBucket: storage.quarantineBucket,
    dataKey: security.dataKey,
    opsKey: security.opsKey,
    alertsTopic: security.alertsTopic,
  });
  // NetworkStack se construye siempre en los tests aunque el app lo haga condicional:
  // sin esto el barrido de tags nunca verificaba sus recursos y las entradas
  // AWS::EC2::* de UNTAGGABLE_TYPES quedaban sin comprobar.
  const network = new NetworkStack(app, `${prefix}Network`, {
    ...common, vpcCidr: '10.0.0.0/16',
  });
  const consumption = new ConsumptionStack(app, `${prefix}Consumption`, {
    ...common,
    athenaResultsBucket: storage.athenaResultsBucket,
    dataKey: security.dataKey,
  });
  const observability = new ObservabilityStack(app, `${prefix}Observability`, {
    ...common,
    dataBuckets: [
      storage.rawBucket,
      storage.cleanBucket,
      storage.curatedBucket,
      storage.archiveBucket,
    ],
    stateMachine: processing.stateMachine,
    alertsTopic: security.alertsTopic,
    enableObjectLock,
  });

  return {
    app, cfg, security, storage, governance,
    processing, consumption, observability, network,
  };
}

/** Atajo para el caso más común: los stacks de un ambiente por nombre. */
export const buildEnv = (prefix: string, envName: string, opts?: BuildOptions) =>
  buildStacks(prefix, getConfig(envName), opts);
