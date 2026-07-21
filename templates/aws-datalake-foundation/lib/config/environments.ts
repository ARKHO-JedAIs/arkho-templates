import { RemovalPolicy } from 'aws-cdk-lib';

export type EnvName = 'dev' | 'prod';

export interface SftpConfig {
  /** Habilita el SFTP Connector (requiere `url` y `trustedHostKeys`). */
  readonly enabled: boolean;
  /** URL del servidor SFTP origen, ej: sftp://sftp.bkserviciosfinancieros.cl */
  readonly url?: string;
  /** Host keys públicas del servidor origen (ssh-keyscan). */
  readonly trustedHostKeys?: string[];
}

export interface DatalakeConfig {
  readonly envName: EnvName;
  /** Cuenta AWS destino. Si se omite usa CDK_DEFAULT_ACCOUNT. */
  readonly account?: string;
  readonly region: string;
  readonly removalPolicy: RemovalPolicy;
  readonly autoDeleteObjects: boolean;
  readonly terminationProtection: boolean;
  /** Días antes de transicionar Raw Zone a Glacier Instant Retrieval. */
  readonly rawTransitionDays: number;
  /** Cron EventBridge de la ingesta por APIs (GA4/Meta). */
  readonly ingestSchedule: string;
  /** Cron EventBridge del pipeline Step Functions (posterior a la ingesta). */
  readonly pipelineSchedule: string;
  /** Cron de los Glue Crawlers (posterior al pipeline). */
  readonly crawlerSchedule: string;
  /** Máximo de workers Glue (con auto-scaling escala hacia abajo). */
  readonly glueMaxWorkers: number;
  /** Corte de bytes escaneados por query en Athena (control de costos). */
  readonly athenaBytesCutoff: number;
  /** Email para alertas operacionales (SNS). */
  readonly alertEmail?: string;
  readonly sftp: SftpConfig;
}

const GIB = 1024 * 1024 * 1024;

export const ENVIRONMENTS: Record<EnvName, DatalakeConfig> = {
  dev: {
    envName: 'dev',
    region: '{{ aws_region }}',
    removalPolicy: RemovalPolicy.DESTROY,
    autoDeleteObjects: true,
    terminationProtection: false,
    rawTransitionDays: 90,
    ingestSchedule: 'cron(0 6 * * ? *)', // 06:00 UTC diario
    pipelineSchedule: 'cron(0 7 * * ? *)', // 1 h después de la ingesta
    crawlerSchedule: 'cron(30 8 * * ? *)', // tras finalizar el pipeline
    glueMaxWorkers: 3,
    athenaBytesCutoff: 5 * GIB,
    // alertEmail: 'equipo-datos@example.com', // definir antes de desplegar
    sftp: { enabled: false },
  },
  prod: {
    envName: 'prod',
    region: '{{ aws_region }}',
    removalPolicy: RemovalPolicy.RETAIN,
    autoDeleteObjects: false,
    terminationProtection: true,
    rawTransitionDays: 90,
    ingestSchedule: 'cron(0 6 * * ? *)',
    pipelineSchedule: 'cron(0 7 * * ? *)',
    crawlerSchedule: 'cron(30 8 * * ? *)',
    glueMaxWorkers: 5,
    athenaBytesCutoff: 10 * GIB,
    // alertEmail: 'datos@bkserviciosfinancieros.cl',
    sftp: {
      enabled: false, // habilitar tras la Fase 0 (GO/NO-GO) con url + host keys reales
      // url: 'sftp://sftp.origen.cl',
      // trustedHostKeys: ['ssh-rsa AAAA...'],
    },
  },
};

export function getConfig(envName: string): DatalakeConfig {
  const cfg = ENVIRONMENTS[envName as EnvName];
  if (!cfg) {
    throw new Error(`Ambiente desconocido '${envName}'. Usa -c env=dev|prod`);
  }
  return cfg;
}

export function prefix(cfg: DatalakeConfig): string {
  return `{{ project_slug }}-${cfg.envName}`;
}
