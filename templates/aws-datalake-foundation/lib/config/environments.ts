import { RemovalPolicy } from 'aws-cdk-lib';
import * as logs from 'aws-cdk-lib/aws-logs';

export type EnvName = 'dev' | 'qa' | 'stg' | 'prod';

export interface DatalakeConfig {
  readonly envName: EnvName;
  /**
   * Cuenta AWS destino (12 dígitos). Fuente única de verdad de dónde despliega
   * cada ambiente — ver el bloque de resolución de cuentas más abajo. `getConfig`
   * la valida antes de cualquier llamada a AWS.
   */
  readonly account: string;
  /**
   * Región destino. Se preguntó UNA vez en la generación y se sembró en cada
   * ambiente, pero es un campo POR AMBIENTE a propósito: puedes mover `prod` a
   * otra región editando su bloque. Si divergen, haz `cdk bootstrap` en cada
   * par cuenta/región.
   */
  readonly region: string;
  readonly removalPolicy: RemovalPolicy;
  readonly autoDeleteObjects: boolean;
  readonly terminationProtection: boolean;
  /** Días antes de transicionar Raw Zone a Glacier Instant Retrieval (0 = nunca). */
  readonly rawTransitionDays: number;
  /** Años de retención en Archive Zone antes de expirar (0 = indefinida). */
  readonly archiveRetentionYears: number;
  /** Cron EventBridge del pipeline Step Functions. */
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
  /**
   * Filas rechazadas por corrida a partir de las cuales el pipeline se detiene y
   * se dispara la alarma. Es un valor ABSOLUTO: en un día de 10 millones de filas
   * 100 rechazos no lo cortan, y en uno de 10 mil sí. Ajústalo al volumen real.
   */
  readonly quarantineAlarmThreshold: number;
  /** Ventana de time-travel de Iceberg: snapshots más viejos se expiran. */
  readonly icebergSnapshotRetentionDays: number;
}

const GIB = 1024 * 1024 * 1024;

/** Zonas del lake que tienen base de datos en el Glue Data Catalog. */
export type CatalogZone = 'raw' | 'clean' | 'curated' | 'quarantine';

/** Todas las zonas catalogadas, en orden de flujo. */
export const CATALOG_ZONES: readonly CatalogZone[] = [
  'raw', 'clean', 'curated', 'quarantine',
];

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
 * Valores del LF-Tag `dominio` (taxonomía de negocio). Placeholder: reemplázalos
 * por los dominios reales del cliente.
 */
export const LF_TAG_DOMAINS: string[] = csv('{{ lf_tag_domains }}');

/**
 * Valores del LF-Tag `sensibilidad` (clasificación de datos).
 *
 * EL ORDEN ES UN CONTRATO: el primer valor es el MÁS RESTRICTIVO y el último el
 * más abierto. `GovernanceStack` etiqueta Raw, Clean y Quarantine con el primero,
 * Curated con el último, y el grant del rol de analista EXCLUYE el primero.
 * Invertir la lista le daría al analista acceso justo a lo que debe protegerse.
 */
export const LF_TAG_SENSITIVITIES: string[] = csv('{{ lf_tag_sensitivities }}');

/** La clasificación más restrictiva. Ver el contrato de orden arriba. */
export const MOST_RESTRICTIVE_SENSITIVITY = LF_TAG_SENSITIVITIES[0];

/** La clasificación más abierta. */
export const LEAST_RESTRICTIVE_SENSITIVITY =
  LF_TAG_SENSITIVITIES[LF_TAG_SENSITIVITIES.length - 1];

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

// ── Ambientes activos ────────────────────────────────────────────────────────
// Los ambientes de ESTE proyecto se eligieron en la generación. El catálogo más
// abajo define los cuatro que el template sabe construir; acá se filtra a los que
// realmente existen.

/**
 * Orden canónico: de MENOS a MÁS endurecido.
 *
 * ES UN CONTRATO, no cosmética. `ACTIVE_ENV_NAMES` se ordena contra esta lista
 * porque el orden en que la respuesta llega desde el generador es el orden en que
 * el usuario marcó las opciones, no uno estable — y `DEFAULT_ENV` depende de que
 * el primero sea determinista.
 */
const CANONICAL_ORDER: readonly EnvName[] = ['dev', 'qa', 'stg', 'prod'];

const selected = csv('{{ environments }}') as EnvName[];

/**
 * Los ambientes que tiene este proyecto, en orden canónico.
 *
 * Para agregar uno después: añádelo acá, completa su `account` en el catálogo y
 * haz `cdk bootstrap` de ese par cuenta/región. Para quitarlo, sácalo de la lista
 * — el bloque del catálogo puede quedarse, no se instancia nada.
 */
export const ACTIVE_ENV_NAMES: EnvName[] =
  CANONICAL_ORDER.filter((name) => selected.includes(name));

/**
 * Destino por defecto de `synth`/`diff`/`deploy` cuando no se pasa `-c env=`.
 * El menos endurecido de los activos, que es el del trabajo diario.
 */
export const DEFAULT_ENV: EnvName = ACTIVE_ENV_NAMES[0];

/** El más endurecido de los activos. */
export const HARDENED_ENV: EnvName = ACTIVE_ENV_NAMES[ACTIVE_ENV_NAMES.length - 1];

// ── Resolución de cuentas AWS ────────────────────────────────────────────────
// El template soporta dos estrategias, elegidas en la generación:
//
//   shared          → todos los ambientes despliegan en UNA cuenta
//   per_environment → cada ambiente tiene la suya
//
// El mismo archivo generado sirve para ambas: cada ambiente pasa por `accountOr`
// y cae en la cuenta por defecto cuando su token quedó vacío.

/**
 * Cuenta respondida en la generación (`aws_account_id`). Con la estrategia
 * compartida es la de todos los ambientes; con una cuenta por ambiente es el
 * fallback de cualquiera que quede en blanco.
 */
const DEFAULT_ACCOUNT = '{{ aws_account_id }}';

/**
 * Los IDs por ambiente solo se preguntan con la estrategia "una cuenta por
 * ambiente", y solo para los ambientes elegidos. En cualquier otro caso el
 * generador los deja VACÍOS y el ambiente cae en `DEFAULT_ACCOUNT`: el string
 * vacío es una señal de diseño, no un token sin resolver. Para separar un
 * ambiente después, escribe su ID de 12 dígitos aquí.
 */
const accountOr = (perEnv: string): string => perEnv.trim() || DEFAULT_ACCOUNT;

// ── Catálogo de ambientes ────────────────────────────────────────────────────
// Los cuatro ambientes que el template sabe construir, cada uno con TODOS sus
// campos escritos explícitamente. Nada se hereda de un objeto compartido: cambiar
// la retención de logs solo en `prod`, o mover `stg` de región, es editar una
// línea dentro de su bloque.
//
// Los valores se sembraron con las respuestas de la generación, pero de acá en
// adelante son código: ninguno se vuelve a preguntar. Ajústalos por ambiente.
//
// Los cuatro bloques están siempre presentes aunque el proyecto use menos: son el
// catálogo del que `ACTIVE_ENV_NAMES` selecciona, y sirven de plantilla completa
// cuando agregas un ambiente más adelante.

const CATALOG: Record<EnvName, DatalakeConfig> = {
  dev: {
    envName: 'dev',
    account: accountOr('{{ aws_account_id_dev }}'),
    region: '{{ aws_region }}',
    // El ambiente donde `cdk destroy` se lleva los datos. Si esto te incomoda,
    // cámbialo a RETAIN + autoDeleteObjects: false y quedará como los demás.
    removalPolicy: RemovalPolicy.DESTROY,
    autoDeleteObjects: true,
    terminationProtection: false,
    rawTransitionDays: {{ raw_retention_days }},
    archiveRetentionYears: {{ archive_retention_years }},
    // Horarios en UTC (EventBridge siempre interpreta cron en UTC). El crawler
    // debe partir DESPUÉS de que el pipeline termine: si tus jobs Glue se acercan
    // al timeout de 60 min, aleja `crawlerSchedule`.
    pipelineSchedule: '{{ pipeline_schedule }}',
    crawlerSchedule: '{{ crawler_schedule }}',
    glueMaxWorkers: 3,
    athenaBytesCutoff: 5 * GIB,
    alertEmail: '{{ admin_email }}',
    logRetentionDays: 30,
    quarantineRetentionDays: 30,
    quarantineAlarmThreshold: 100,
    icebergSnapshotRetentionDays: 7,
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
    pipelineSchedule: '{{ pipeline_schedule }}',
    crawlerSchedule: '{{ crawler_schedule }}',
    glueMaxWorkers: 3,
    athenaBytesCutoff: 5 * GIB,
    alertEmail: '{{ admin_email }}',
    logRetentionDays: 30,
    quarantineRetentionDays: 30,
    quarantineAlarmThreshold: 100,
    icebergSnapshotRetentionDays: 7,
  },
  stg: {
    envName: 'stg',
    account: accountOr('{{ aws_account_id_stg }}'),
    region: '{{ aws_region }}',
    removalPolicy: RemovalPolicy.RETAIN,
    autoDeleteObjects: false,
    terminationProtection: false,
    rawTransitionDays: {{ raw_retention_days }},
    archiveRetentionYears: {{ archive_retention_years }},
    pipelineSchedule: '{{ pipeline_schedule }}',
    crawlerSchedule: '{{ crawler_schedule }}',
    glueMaxWorkers: 3,
    athenaBytesCutoff: 5 * GIB,
    alertEmail: '{{ admin_email }}',
    logRetentionDays: 30,
    quarantineRetentionDays: 30,
    quarantineAlarmThreshold: 100,
    icebergSnapshotRetentionDays: 7,
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
    pipelineSchedule: '{{ pipeline_schedule }}',
    crawlerSchedule: '{{ crawler_schedule }}',
    glueMaxWorkers: 5,
    athenaBytesCutoff: 10 * GIB,
    alertEmail: '{{ admin_email }}',
    // Prod nunca baja de un año de logs: por debajo no se sostiene una auditoría.
    logRetentionDays: 365,
    quarantineRetentionDays: 30,
    quarantineAlarmThreshold: 100,
    icebergSnapshotRetentionDays: 7,
  },
};

/**
 * Los ambientes de este proyecto. `Partial` es honesto: si el proyecto se generó
 * con `dev` y `prod`, `ENVIRONMENTS.qa` no existe. Usa `getConfig()`, que valida.
 */
export const ENVIRONMENTS: Partial<Record<EnvName, DatalakeConfig>> =
  Object.fromEntries(ACTIVE_ENV_NAMES.map((name) => [name, CATALOG[name]]));

const ACCOUNT_RE = /^[0-9]{12}$/;

/**
 * Único embudo para obtener la config de un ambiente. Valida acá (y no en
 * `bin/app.ts`) porque tanto la app como los tests pasan por esta función, así
 * que `npm test` ejercita las guardas gratis.
 */
export function getConfig(envName: string): DatalakeConfig {
  if (ACTIVE_ENV_NAMES.length === 0) {
    throw new Error(
      'Este proyecto no tiene ningún ambiente activo. Agrega al menos uno a ' +
        'CANONICAL_ORDER/ACTIVE_ENV_NAMES en lib/config/environments.ts.',
    );
  }
  // `hasOwnProperty`: ENVIRONMENTS hereda de Object.prototype, así que un índice
  // directo resolvía miembros heredados (getConfig('toString') devolvía una
  // función en vez de lanzar).
  const cfg = Object.prototype.hasOwnProperty.call(ENVIRONMENTS, envName)
    ? ENVIRONMENTS[envName as EnvName]
    : undefined;
  if (!cfg) {
    throw new Error(
      `Ambiente desconocido '${envName}'. Este proyecto tiene: ` +
        `${ACTIVE_ENV_NAMES.join(', ')}. Usa -c env=${ACTIVE_ENV_NAMES.join('|')}, ` +
        'o agrega el ambiente a ACTIVE_ENV_NAMES en lib/config/environments.ts.',
    );
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
