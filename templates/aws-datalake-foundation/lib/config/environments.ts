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

/** Zonas del lake que tienen base de datos en el Glue Data Catalog. */
export type CatalogZone = 'raw' | 'clean' | 'curated';

/**
 * Nombre de la base de datos Glue de una zona. Fuente única de verdad:
 * la usan tanto `GovernanceStack` (que las crea) como `ProcessingStack`
 * (cuyos crawlers las referencian por nombre).
 */
export function catalogDb(cfg: DatalakeConfig, zone: CatalogZone): string {
  return `{{ catalog_prefix }}_${cfg.envName}_${zone}`;
}

const csv = (value: string): string[] =>
  value.split(',').map((s) => s.trim()).filter(Boolean);

/** Valores del LF-Tag `dominio` (taxonomía de negocio). */
export const LF_TAG_DOMAINS: string[] = csv('{{ lf_tag_domains }}');

/** Valores del LF-Tag `sensibilidad` (clasificación de datos). */
export const LF_TAG_SENSITIVITIES: string[] = csv('{{ lf_tag_sensitivities }}');

export const ENVIRONMENTS: Record<EnvName, DatalakeConfig> = {
  dev: {
    envName: 'dev',
    region: '{{ aws_region }}',
    removalPolicy: RemovalPolicy.DESTROY,
    autoDeleteObjects: true,
    terminationProtection: false,
    rawTransitionDays: {{ raw_retention_days }},
    archiveRetentionYears: {{ archive_retention_years }},
    // Horarios en UTC (EventBridge siempre interpreta cron en UTC).
    // El crawler debe partir DESPUÉS de que el pipeline termine: si tus jobs
    // Glue se acercan al timeout de 60 min, aleja `crawlerSchedule`.
    ingestSchedule: '{{ ingest_schedule }}',
    pipelineSchedule: '{{ pipeline_schedule }}',
    crawlerSchedule: '{{ crawler_schedule }}',
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
    ingestSchedule: '{{ ingest_schedule }}',
    pipelineSchedule: '{{ pipeline_schedule }}',
    crawlerSchedule: '{{ crawler_schedule }}',
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
    ingestSchedule: '{{ ingest_schedule }}',
    pipelineSchedule: '{{ pipeline_schedule }}',
    crawlerSchedule: '{{ crawler_schedule }}',
    glueMaxWorkers: 5,
    athenaBytesCutoff: 10 * GIB,
    alertEmail: '{{ admin_email }}',
    sftp: {
      // Habilitar requiere `url` Y `trustedHostKeys` (obtenlas con
      // `ssh-keyscan <host>`); el stack falla en synth si falta alguna.
      enabled: false,
      // url: 'sftp://sftp.example.com',
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
