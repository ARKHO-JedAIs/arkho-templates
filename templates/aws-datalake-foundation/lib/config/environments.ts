import { RemovalPolicy } from 'aws-cdk-lib';

export type EnvName = 'dev' | 'staging' | 'prod';

export interface SftpConfig {
  /** Habilita el SFTP Connector (requiere `url` y `trustedHostKeys`). */
  readonly enabled: boolean;
  /** URL del servidor SFTP origen, ej: sftp://sftp.origen.cl */
  readonly url?: string;
  /** Host keys públicas del servidor origen (ssh-keyscan). */
  readonly trustedHostKeys?: string[];
}

export interface DatalakeConfig {
  readonly envName: EnvName;
  readonly region: string;
  readonly removalPolicy: RemovalPolicy;
  readonly autoDeleteObjects: boolean;
  readonly terminationProtection: boolean;
  /** Días antes de transicionar Raw Zone a Glacier Instant Retrieval. */
  readonly rawTransitionDays: number;
  /** Años de retención en Archive Zone (Glacier) antes de expirar. */
  readonly archiveRetentionYears: number;
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
  readonly alertEmail: string;
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
    rawTransitionDays: {{ raw_retention_days }},
    archiveRetentionYears: {{ archive_retention_years }},
    ingestSchedule: 'cron(0 6 * * ? *)',   // 06:00 UTC diario
    pipelineSchedule: 'cron(0 7 * * ? *)', // 1 h después de la ingesta
    crawlerSchedule: 'cron(30 8 * * ? *)', // tras finalizar el pipeline
    glueMaxWorkers: 3,
    athenaBytesCutoff: 5 * GIB,
    alertEmail: '{{ admin_email }}',
    sftp: { enabled: false },
  },
  staging: {
    envName: 'staging',
    region: '{{ aws_region }}',
    removalPolicy: RemovalPolicy.RETAIN,
    autoDeleteObjects: false,
    terminationProtection: false,
    rawTransitionDays: {{ raw_retention_days }},
    archiveRetentionYears: {{ archive_retention_years }},
    ingestSchedule: 'cron(0 6 * * ? *)',
    pipelineSchedule: 'cron(0 7 * * ? *)',
    crawlerSchedule: 'cron(30 8 * * ? *)',
    glueMaxWorkers: 3,
    athenaBytesCutoff: 5 * GIB,
    alertEmail: '{{ admin_email }}',
    sftp: { enabled: false },
  },
  prod: {
    envName: 'prod',
    region: '{{ aws_region }}',
    removalPolicy: RemovalPolicy.RETAIN,
    autoDeleteObjects: false,
    terminationProtection: true,
    rawTransitionDays: {{ raw_retention_days }},
    archiveRetentionYears: {{ archive_retention_years }},
    ingestSchedule: 'cron(0 6 * * ? *)',
    pipelineSchedule: 'cron(0 7 * * ? *)',
    crawlerSchedule: 'cron(30 8 * * ? *)',
    glueMaxWorkers: 5,
    athenaBytesCutoff: 10 * GIB,
    alertEmail: '{{ admin_email }}',
    sftp: {
      enabled: false, // habilitar tras la Fase 0 con url + trustedHostKeys reales
      // url: 'sftp://sftp.origen.cl',
      // trustedHostKeys: ['ssh-rsa AAAA...'],
    },
  },
};

export function getConfig(envName: string): DatalakeConfig {
  const cfg = ENVIRONMENTS[envName as EnvName];
  if (!cfg) {
    throw new Error(`Ambiente desconocido '${envName}'. Usa -c env=dev|staging|prod`);
  }
  return cfg;
}

export function prefix(cfg: DatalakeConfig): string {
  return `{{ project_slug }}-${cfg.envName}`;
}
