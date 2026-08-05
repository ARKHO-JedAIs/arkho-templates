import * as fs from 'fs';
import * as path from 'path';
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
// Los ambientes de este proyecto SON los archivos de config que existen: cada
// `config/<nombre>.env` es un ambiente. Agregar `qa` es copiar un archivo;
// quitarlo es borrarlo. No hay ninguna lista que mantener en sincronía.

// Relativo a __dirname y no a process.cwd(): la CDK CLI, jest y el runner de
// ambientes se invocan desde directorios distintos.
const CONFIG_DIR = path.join(__dirname, '..', '..', 'config');

/**
 * Orden canónico: de MENOS a MÁS endurecido.
 *
 * ES UN CONTRATO, no cosmética: `DEFAULT_ENV` es el primero. Es también el
 * vocabulario cerrado de nombres que el template conoce, así que un `uat.env` se
 * rechaza en vez de convertirse en un ambiente a medias — y de paso un
 * `dev.env.bak` o un `prod.env~` del editor tampoco se cuelan.
 */
const CANONICAL_ORDER: readonly EnvName[] = ['dev', 'qa', 'stg', 'prod'];

/** Descubre los ambientes leyendo `config/*.env`, en orden canónico. */
function discoverEnvNames(): EnvName[] {
  let entries: string[];
  try {
    entries = fs.readdirSync(CONFIG_DIR);
  } catch {
    throw new Error(
      `No se encontró el directorio de configuración '${CONFIG_DIR}'. Cada ambiente ` +
        'es un archivo config/<nombre>.env; sin ellos no hay nada que sintetizar.',
    );
  }

  const found = entries
    .filter((name) => name.endsWith('.env'))
    .map((name) => name.slice(0, -'.env'.length));

  const unknown = found.filter((name) => !CANONICAL_ORDER.includes(name as EnvName));
  if (unknown.length > 0) {
    throw new Error(
      `Nombre de ambiente no reconocido en config/: ${unknown.join(', ')}. Los ` +
        `válidos son ${CANONICAL_ORDER.join(', ')}. Renombra el archivo o bórralo: ` +
        'no se ignora en silencio para que un respaldo no termine desplegando ' +
        'infraestructura.',
    );
  }

  const names = CANONICAL_ORDER.filter((name) => found.includes(name));
  if (names.length === 0) {
    throw new Error(
      `No hay ningún archivo config/<ambiente>.env en '${CONFIG_DIR}'. Crea al ` +
        `menos uno (${CANONICAL_ORDER.join(', ')}).`,
    );
  }
  return names;
}

/** Los ambientes que tiene este proyecto, en orden canónico. */
export const ACTIVE_ENV_NAMES: EnvName[] = discoverEnvNames();

/**
 * Destino por defecto de `synth`/`diff`/`deploy` cuando no se pasa `-c env=`.
 * El menos endurecido de los activos, que es el del trabajo diario.
 */
export const DEFAULT_ENV: EnvName = ACTIVE_ENV_NAMES[0];

/** El más endurecido de los activos. */
export const HARDENED_ENV: EnvName = ACTIVE_ENV_NAMES[ACTIVE_ENV_NAMES.length - 1];

// ── Lectura y validación de los archivos de config ───────────────────────────
// Parser propio y no `dotenv`: el formato que se necesita es un subconjunto
// estricto (sin multilínea, sin interpolación) y, sobre todo, `dotenv` ignora en
// silencio las líneas que no entiende. Acá una línea malformada tiene que cortar
// el synth — son los valores que deciden si `cdk destroy` se lleva los datos.

/** Claves esperadas en un archivo de ambiente. Falta una o sobra una: error. */
const EXPECTED_KEYS = [
  'ACCOUNT', 'REGION', 'REMOVAL_POLICY', 'AUTO_DELETE_OBJECTS',
  'TERMINATION_PROTECTION', 'RAW_TRANSITION_DAYS', 'ARCHIVE_RETENTION_YEARS',
  'PIPELINE_SCHEDULE', 'CRAWLER_SCHEDULE', 'GLUE_MAX_WORKERS',
  'ATHENA_BYTES_CUTOFF_GIB', 'ALERT_EMAIL', 'LOG_RETENTION_DAYS',
  'QUARANTINE_RETENTION_DAYS', 'QUARANTINE_ALARM_THRESHOLD',
  'ICEBERG_SNAPSHOT_RETENTION_DAYS',
] as const;

/**
 * Parsea el contenido de un archivo de ambiente. Pura y exportada a propósito:
 * los tests ejercitan la validación con strings inyectados, sin escribir archivos
 * de basura en config/ ni depender de los valores que eligió la generación.
 */
export function parseEnvText(envName: string, raw: string): Record<string, string> {
  const values: Record<string, string> = {};

  raw.split(/\r?\n/).forEach((line, i) => {
    const text = line.trim();
    if (text === '' || text.startsWith('#')) return;
    const eq = text.indexOf('=');
    if (eq <= 0) {
      throw new Error(
        `config/${envName}.env:${i + 1}: se esperaba CLAVE=valor y se leyó "${text}".`,
      );
    }
    const key = text.slice(0, eq).trim();
    // Se parte en el PRIMER '=': un valor puede contener '=' sin escaparlo.
    const value = text.slice(eq + 1).trim().replace(/^(["'])(.*)\1$/, '$2');
    if (Object.prototype.hasOwnProperty.call(values, key)) {
      throw new Error(`config/${envName}.env:${i + 1}: la clave ${key} está repetida.`);
    }
    values[key] = value;
  });

  const missing = EXPECTED_KEYS.filter((k) => values[k] === undefined);
  if (missing.length > 0) {
    throw new Error(
      `config/${envName}.env: faltan claves obligatorias: ${missing.join(', ')}.`,
    );
  }
  // Una clave de sobra suele ser un rename a medias o un typo que dejó la vieja en
  // su lugar; ignorarla haría que el valor recién editado no tuviera efecto.
  const extra = Object.keys(values).filter(
    (k) => !(EXPECTED_KEYS as readonly string[]).includes(k),
  );
  if (extra.length > 0) {
    throw new Error(
      `config/${envName}.env: claves no reconocidas: ${extra.join(', ')}. Las ` +
        `válidas son ${EXPECTED_KEYS.join(', ')}.`,
    );
  }
  return values;
}

/**
 * Cuenta respondida en la generación. Es el único valor que NO vive en los
 * archivos de ambiente, precisamente porque es el fallback de todos: con la
 * estrategia de cuenta compartida cada `ACCOUNT=` queda vacío y todos caen acá.
 */
const DEFAULT_ACCOUNT = '{{ aws_account_id }}';

const ACCOUNT_RE = /^[0-9]{12}$/;

// Lectores tipados. Cada mensaje nombra archivo, clave, valor leído y qué se
// esperaba: son errores que va a leer alguien editando un archivo de texto.

function readInt(
  envName: string, values: Record<string, string>, key: string,
  min: number, max: number,
): number {
  const raw = values[key];
  if (!/^-?[0-9]+$/.test(raw)) {
    throw new Error(`config/${envName}.env: ${key}="${raw}" no es un entero.`);
  }
  const n = Number(raw);
  if (n < min || n > max) {
    throw new Error(
      `config/${envName}.env: ${key}=${n} está fuera de rango (${min}..${max}).`,
    );
  }
  return n;
}

function readBool(
  envName: string, values: Record<string, string>, key: string,
): boolean {
  const raw = values[key];
  if (raw !== 'true' && raw !== 'false') {
    throw new Error(
      `config/${envName}.env: ${key}="${raw}" debe ser exactamente true o false.`,
    );
  }
  return raw === 'true';
}

function readCron(
  envName: string, values: Record<string, string>, key: string,
): string {
  const raw = values[key];
  if (!/^cron\(.+\)$/.test(raw)) {
    throw new Error(
      `config/${envName}.env: ${key}="${raw}" debe ser una expresión cron de ` +
        'EventBridge en UTC, p. ej. cron(0 7 * * ? *).',
    );
  }
  return raw;
}

function readMatch(
  envName: string, values: Record<string, string>, key: string,
  re: RegExp, hint: string,
): string {
  const raw = values[key];
  if (!re.test(raw)) {
    throw new Error(`config/${envName}.env: ${key}="${raw}" ${hint}.`);
  }
  return raw;
}

/**
 * Construye y VALIDA la config de un ambiente a partir de sus claves ya
 * parseadas. Pura y exportada por la misma razón que parseEnvText.
 */
export function buildConfig(envName: EnvName, v: Record<string, string>): DatalakeConfig {

  const removalPolicy = v.REMOVAL_POLICY;
  if (removalPolicy !== 'RETAIN' && removalPolicy !== 'DESTROY') {
    throw new Error(
      `config/${envName}.env: REMOVAL_POLICY="${removalPolicy}" debe ser RETAIN o DESTROY.`,
    );
  }
  const autoDeleteObjects = readBool(envName, v, 'AUTO_DELETE_OBJECTS');
  // CDK rechaza autoDeleteObjects junto a RETAIN, y ese error aparecería recién al
  // instanciar el bucket. Se atrapa acá, con el nombre del archivo que lo causó.
  if (autoDeleteObjects && removalPolicy === 'RETAIN') {
    throw new Error(
      `config/${envName}.env: AUTO_DELETE_OBJECTS=true exige REMOVAL_POLICY=DESTROY ` +
        '(CDK rechaza la combinación con RETAIN).',
    );
  }

  // `ACCOUNT` vacío es la señal de diseño de la estrategia de cuenta compartida.
  const account = v.ACCOUNT.trim() || DEFAULT_ACCOUNT;
  if (!ACCOUNT_RE.test(account)) {
    throw new Error(
      `config/${envName}.env: ACCOUNT="${v.ACCOUNT}" no es un ID de cuenta AWS de ` +
        '12 dígitos. Déjalo vacío para usar la cuenta por defecto del proyecto.',
    );
  }

  return {
    envName,
    account,
    region: readMatch(envName, v, 'REGION', /^[a-z]{2}-[a-z]+-[0-9]$/,
      'no es una región AWS válida, p. ej. us-east-1'),
    removalPolicy:
      removalPolicy === 'DESTROY' ? RemovalPolicy.DESTROY : RemovalPolicy.RETAIN,
    autoDeleteObjects,
    terminationProtection: readBool(envName, v, 'TERMINATION_PROTECTION'),
    rawTransitionDays: readInt(envName, v, 'RAW_TRANSITION_DAYS', 0, 3650),
    archiveRetentionYears: readInt(envName, v, 'ARCHIVE_RETENTION_YEARS', 0, 99),
    pipelineSchedule: readCron(envName, v, 'PIPELINE_SCHEDULE'),
    crawlerSchedule: readCron(envName, v, 'CRAWLER_SCHEDULE'),
    glueMaxWorkers: readInt(envName, v, 'GLUE_MAX_WORKERS', 2, 100),
    athenaBytesCutoff: readInt(envName, v, 'ATHENA_BYTES_CUTOFF_GIB', 1, 1024) * GIB,
    alertEmail: readMatch(envName, v, 'ALERT_EMAIL', /^[^@\s]+@[^@\s]+\.[^@\s]+$/,
      'no es una dirección de correo válida'),
    logRetentionDays: readInt(envName, v, 'LOG_RETENTION_DAYS', 1, 3653),
    quarantineRetentionDays: readInt(envName, v, 'QUARANTINE_RETENTION_DAYS', 1, 3650),
    quarantineAlarmThreshold:
      readInt(envName, v, 'QUARANTINE_ALARM_THRESHOLD', 1, 1000000),
    icebergSnapshotRetentionDays:
      readInt(envName, v, 'ICEBERG_SNAPSHOT_RETENTION_DAYS', 1, 3650),
  };
}

/**
 * Los ambientes de este proyecto, ya validados. Se cargan al importar el módulo:
 * un archivo malformado corta antes de que se construya cualquier stack.
 *
 * `Partial` es honesto: si el proyecto no tiene `config/qa.env`, `ENVIRONMENTS.qa`
 * no existe. Usa `getConfig()`.
 */
const loadConfig = (envName: EnvName): DatalakeConfig =>
  buildConfig(envName, parseEnvText(
    envName, fs.readFileSync(path.join(CONFIG_DIR, `${envName}.env`), 'utf8'),
  ));

export const ENVIRONMENTS: Partial<Record<EnvName, DatalakeConfig>> =
  Object.fromEntries(ACTIVE_ENV_NAMES.map((name) => [name, loadConfig(name)]));

/**
 * Único embudo para obtener la config de un ambiente. Valida acá (y no en
 * `bin/app.ts`) porque tanto la app como los tests pasan por esta función, así
 * que `npm test` ejercita las guardas gratis.
 */
export function getConfig(envName: string): DatalakeConfig {
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
        `o crea config/${envName}.env copiando el de otro ambiente.`,
    );
  }
  return cfg;
}

export function prefix(cfg: DatalakeConfig): string {
  return `{{ project_slug }}-${cfg.envName}`;
}
