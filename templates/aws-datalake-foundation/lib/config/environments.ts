import { RemovalPolicy } from 'aws-cdk-lib';
import * as logs from 'aws-cdk-lib/aws-logs';

export type EnvName = 'dev' | 'qa' | 'stg' | 'prod';

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
  /**
   * Cuenta AWS destino (12 dígitos). Fuente única de verdad de dónde despliega
   * cada ambiente — ver el bloque de resolución de cuentas más abajo.
   */
  readonly account: string;
  /**
   * Región destino. Se preguntó UNA vez en la generación y se aplicó a los 4
   * ambientes, pero es un campo POR AMBIENTE a propósito: puedes mover `prod` a
   * otra región editando su entrada. Si divergen, haz `cdk bootstrap` en cada
   * par cuenta/región.
   */
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
  /** Días de retención de los logs en CloudWatch. */
  readonly logRetentionDays: number;
  /** Días que los registros rechazados permanecen en la Quarantine Zone. */
  readonly quarantineRetentionDays: number;
  /** Filas rechazadas por corrida a partir de las cuales se alarma. */
  readonly quarantineAlarmThreshold: number;
  /** Ventana de time-travel de Iceberg: snapshots más viejos se expiran. */
  readonly icebergSnapshotRetentionDays: number;
  readonly sftp: SftpConfig;
}

const GIB = 1024 * 1024 * 1024;

/** Zonas del lake que tienen base de datos en el Glue Data Catalog. */
export type CatalogZone = 'raw' | 'clean' | 'curated';

/** Todas las zonas catalogadas, en orden de flujo. */
export const CATALOG_ZONES: readonly CatalogZone[] = ['raw', 'clean', 'curated'];

/**
 * Namespace de las métricas custom que publican los jobs Glue (filas procesadas,
 * filas en cuarentena). Compartido entre el job que las publica y las alarmas que
 * las consumen: si se separan, la alarma queda mirando un namespace vacío para
 * siempre y nadie se entera.
 */
export const METRIC_NAMESPACE = '{{ project_slug }}/datalake';

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

/**
 * Principal autorizado a asumir el rol de analista. Vacío = cuenta root, que se
 * documenta como punto de partida a acotar.
 */
export const ANALYST_PRINCIPAL_ARN = '{{ analyst_principal_arn }}'.trim();

/**
 * Convierte días a un `RetentionDays` válido.
 *
 * CloudWatch solo acepta un conjunto discreto de valores; cualquier otro número lo
 * rechaza en el deploy, no en el synth. Se redondea hacia ARRIBA al valor permitido
 * más cercano: quedarse corto en retención de auditoría es peor que pasarse.
 */
export function logRetention(cfg: DatalakeConfig): logs.RetentionDays {
  const allowed = [
    1, 3, 5, 7, 14, 30, 60, 90, 120, 150, 180, 365, 400, 545, 731,
    1096, 1827, 2192, 2557, 2922, 3288, 3653,
  ];
  const days = cfg.logRetentionDays;
  const match = allowed.find((v) => v >= days) ?? allowed[allowed.length - 1];
  return match as logs.RetentionDays;
}

/** Valores del LF-Tag `dominio` (taxonomía de negocio). */
export const LF_TAG_DOMAINS: string[] = csv('{{ lf_tag_domains }}');

/** Valores del LF-Tag `sensibilidad` (clasificación de datos). */
export const LF_TAG_SENSITIVITIES: string[] = csv('{{ lf_tag_sensitivities }}');

// ── Resolución de cuentas AWS ────────────────────────────────────────────────
// El template soporta dos estrategias, elegidas en la generación:
//
//   shared          → los 4 ambientes despliegan en UNA cuenta
//   per_environment → cada ambiente tiene la suya
//
// El mismo archivo generado sirve para ambas. `dev` usa directamente la cuenta
// respondida; los otros tres caen en ella cuando su token quedó vacío.

/**
 * Cuenta respondida en la generación (`aws_account_id`). Con la estrategia
 * compartida es la de los 4 ambientes; con una cuenta por ambiente es la de
 * `dev` y el fallback del resto.
 */
const DEFAULT_ACCOUNT = '{{ aws_account_id }}';

/**
 * Los IDs por ambiente solo se preguntan con la estrategia "una cuenta por
 * ambiente". Con la compartida el generador los deja VACÍOS y el ambiente cae en
 * `DEFAULT_ACCOUNT`: el string vacío es una señal de diseño, no un token sin
 * resolver. Para separar un ambiente después, escribe su ID de 12 dígitos aquí.
 */
const accountOr = (perEnv: string): string => perEnv.trim() || DEFAULT_ACCOUNT;

export const ENVIRONMENTS: Record<EnvName, DatalakeConfig> = {
  dev: {
    envName: 'dev',
    account: DEFAULT_ACCOUNT,
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
    logRetentionDays: {{ log_retention_days }},
    quarantineRetentionDays: {{ quarantine_retention_days }},
    quarantineAlarmThreshold: {{ quarantine_alarm_threshold }},
    icebergSnapshotRetentionDays: {{ iceberg_snapshot_retention_days }},
    sftp: { enabled: false },
  },
  qa: {
    envName: 'qa',
    account: accountOr('{{ aws_account_id_qa }}'),
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
    logRetentionDays: {{ log_retention_days }},
    quarantineRetentionDays: {{ quarantine_retention_days }},
    quarantineAlarmThreshold: {{ quarantine_alarm_threshold }},
    icebergSnapshotRetentionDays: {{ iceberg_snapshot_retention_days }},
    sftp: { enabled: false },
  },
  // `stg` y `qa` son idénticos salvo el nombre y la cuenta: el endurecimiento
  // real (protección de terminación, más workers, cutoff mayor) ocurre en `prod`.
  // Si quieres ensayos de performance representativos en stg, súbele
  // glueMaxWorkers y athenaBytesCutoff a los valores de prod — duplica su costo Glue.
  stg: {
    envName: 'stg',
    account: accountOr('{{ aws_account_id_stg }}'),
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
    logRetentionDays: {{ log_retention_days }},
    quarantineRetentionDays: {{ quarantine_retention_days }},
    quarantineAlarmThreshold: {{ quarantine_alarm_threshold }},
    icebergSnapshotRetentionDays: {{ iceberg_snapshot_retention_days }},
    sftp: { enabled: false },
  },
  prod: {
    envName: 'prod',
    account: accountOr('{{ aws_account_id_prod }}'),
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
    // Prod nunca baja de un año de logs, sin importar lo respondido en la
    // generación: por debajo de eso no se sostiene una auditoría.
    logRetentionDays: Math.max({{ log_retention_days }}, 365),
    quarantineRetentionDays: {{ quarantine_retention_days }},
    quarantineAlarmThreshold: {{ quarantine_alarm_threshold }},
    icebergSnapshotRetentionDays: {{ iceberg_snapshot_retention_days }},
    sftp: {
      // Habilitar requiere `url` Y `trustedHostKeys` (obtenlas con
      // `ssh-keyscan <host>`); el stack falla en synth si falta alguna.
      enabled: false,
      // url: 'sftp://sftp.example.com',
      // trustedHostKeys: ['ssh-rsa AAAA...'],
    },
  },
};

const ACCOUNT_RE = /^[0-9]{12}$/;

/**
 * Único embudo para obtener la config de un ambiente. Valida acá (y no en
 * `bin/app.ts`) porque tanto la app como los tests pasan por esta función, así
 * que `npm test` ejercita las guardas gratis.
 */
export function getConfig(envName: string): DatalakeConfig {
  // `hasOwnProperty`: ENVIRONMENTS es un objeto literal y hereda de
  // Object.prototype, así que un índice directo resolvía miembros heredados
  // (getConfig('toString') devolvía una función en vez de lanzar).
  const cfg = Object.prototype.hasOwnProperty.call(ENVIRONMENTS, envName)
    ? ENVIRONMENTS[envName as EnvName]
    : undefined;
  if (!cfg) {
    throw new Error(`Ambiente desconocido '${envName}'. Usa -c env=dev|qa|stg|prod`);
  }
  // Falla antes de cualquier llamada a AWS: con la estrategia de una cuenta por
  // ambiente, un ID sin completar produciría stacks sin cuenta y el error real
  // aparecería recién en el deploy.
  if (!ACCOUNT_RE.test(cfg.account)) {
    throw new Error(
      `Cuenta AWS inválida para el ambiente '${cfg.envName}': '${cfg.account}'. ` +
        'Debe ser un ID de 12 dígitos; complétala en lib/config/environments.ts.',
    );
  }
  return cfg;
}

export function prefix(cfg: DatalakeConfig): string {
  return `{{ project_slug }}-${cfg.envName}`;
}
