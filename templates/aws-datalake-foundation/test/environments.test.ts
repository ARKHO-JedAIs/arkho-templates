import * as fs from 'fs';
import * as path from 'path';
import { RemovalPolicy } from 'aws-cdk-lib';
import {
  ACTIVE_ENV_NAMES,
  DEFAULT_ENV,
  DatalakeConfig,
  ENVIRONMENTS,
  EnvName,
  HARDENED_ENV,
  buildConfig,
  catalogDb,
  getConfig,
  parseEnvText,
  prefix,
} from '../lib/config/environments';

/**
 * Guardas del set de ambientes y de la resolución de cuentas AWS.
 *
 * NINGÚN test de acá puede nombrar un ambiente concreto en una afirmación
 * positiva: el set se elige en la generación y este mismo archivo tiene que pasar
 * en un proyecto de `dev`+`prod`, en uno de `stg`+`prod` y en uno de los cuatro.
 * Todo se deriva de `ACTIVE_ENV_NAMES`, y los nombres literales solo aparecen en
 * los casos negativos y en las guardas condicionales por presencia.
 *
 * La razón de ser original sigue vigente: con la estrategia de cuenta compartida
 * los tokens de cuenta por ambiente quedan VACÍOS en la generación y el fallback en
 * TypeScript tiene que haberlos resuelto. Un `''` que se cuele acá sintetizaría
 * stacks sin cuenta, y el error aparecería recién en el deploy.
 */
const CANONICAL: EnvName[] = ['dev', 'qa', 'stg', 'prod'];

const CONFIG_DIR = path.join(__dirname, '..', 'config');

describe('set de ambientes activos', () => {
  test('hay al menos un ambiente', () => {
    // Sin esto el proyecto no puede sintetizar nada, y el resto de los tests de
    // este archivo pasarían vacuamente al iterar una lista vacía.
    expect(ACTIVE_ENV_NAMES.length).toBeGreaterThan(0);
  });

  test('ENVIRONMENTS expone exactamente los ambientes activos', () => {
    expect(Object.keys(ENVIRONMENTS).sort()).toEqual([...ACTIVE_ENV_NAMES].sort());
  });

  test('ACTIVE_ENV_NAMES está en orden canónico, no en el de selección', () => {
    // El orden es un contrato: DEFAULT_ENV es el primero. Si el filtro contra
    // CANONICAL_ORDER se rompiera, acá quedaría el orden en que el usuario marcó
    // las opciones en el generador, que no es estable.
    const expected = CANONICAL.filter((name) => ACTIVE_ENV_NAMES.includes(name));
    expect(ACTIVE_ENV_NAMES).toEqual(expected);
  });

  test('no hay nombres fuera del vocabulario conocido', () => {
    for (const name of ACTIVE_ENV_NAMES) {
      expect(CANONICAL).toContain(name);
    }
  });

  test('DEFAULT_ENV es el primero y HARDENED_ENV el último de los activos', () => {
    expect(DEFAULT_ENV).toBe(ACTIVE_ENV_NAMES[0]);
    expect(HARDENED_ENV).toBe(ACTIVE_ENV_NAMES[ACTIVE_ENV_NAMES.length - 1]);
  });

  test('hay exactamente un archivo config/<ambiente>.env por ambiente activo', () => {
    // El ambiente EXISTE porque su archivo existe. Si esto se rompe, el
    // descubrimiento dejó de leer el disco y volvió a haber una lista que mantener.
    const files = fs.readdirSync(CONFIG_DIR).filter((f) => f.endsWith('.env'));
    expect(files.sort()).toEqual(ACTIVE_ENV_NAMES.map((n) => `${n}.env`).sort());
  });
});

describe('configuración de cada ambiente activo', () => {
  test.each(ACTIVE_ENV_NAMES)("la clave '%s' coincide con su envName", (name) => {
    // Atrapa el copy-paste clásico entre bloques del catálogo:
    // `stg: { envName: 'stg' }` copiado con el envName de otro.
    expect(getConfig(name).envName).toBe(name);
  });

  test.each(ACTIVE_ENV_NAMES)("'%s' tiene una cuenta AWS de 12 dígitos", (name) => {
    expect(getConfig(name).account).toMatch(/^[0-9]{12}$/);
  });

  test.each(ACTIVE_ENV_NAMES)("'%s' quedó con región y email poblados", (name) => {
    const cfg = getConfig(name);
    expect(cfg.region).toMatch(/^[a-z]{2}-[a-z]+-[0-9]$/);
    expect(cfg.alertEmail).toContain('@');
  });

  test.each(ACTIVE_ENV_NAMES)("'%s' no arrastra tokens sin resolver", (name) => {
    // Cada bloque del catálogo escribe sus 17 campos a mano; un token mal tipeado
    // en uno solo de ellos pasaría desapercibido sin esto.
    expect(JSON.stringify(getConfig(name))).not.toContain('{{');
  });

  test.each(ACTIVE_ENV_NAMES)("prefix() y catalogDb() llevan el ambiente '%s'", (name) => {
    const cfg = getConfig(name);
    expect(prefix(cfg)).toMatch(new RegExp(`-${name}$`));
    expect(catalogDb(cfg, 'raw')).toMatch(new RegExp(`_${name}_raw$`));
  });
});

/**
 * Validación de los archivos de config, con strings inyectados. No se escriben
 * archivos en config/: se ejercitan las funciones puras, así que estos tests valen
 * igual en cualquier proyecto generado, sin importar qué valores se eligieron.
 *
 * Importa que sean estrictos: son valores en texto plano que deciden si un
 * `cdk destroy` se lleva los datos, y un typo que se ignore en silencio dejaría el
 * valor viejo en efecto mientras el archivo dice otra cosa.
 */
describe('validación de config/<ambiente>.env', () => {
  // Base válida mínima, escrita a mano. Cada test rompe UNA cosa.
  const VALID: Record<string, string> = {
    ACCOUNT: '123456789012',
    REGION: 'us-east-1',
    REMOVAL_POLICY: 'RETAIN',
    AUTO_DELETE_OBJECTS: 'false',
    TERMINATION_PROTECTION: 'true',
    RAW_TRANSITION_DAYS: '90',
    ARCHIVE_RETENTION_YEARS: '7',
    PIPELINE_SCHEDULE: 'cron(0 7 * * ? *)',
    CRAWLER_SCHEDULE: 'cron(30 8 * * ? *)',
    GLUE_MAX_WORKERS: '3',
    ATHENA_BYTES_CUTOFF_GIB: '5',
    ALERT_EMAIL: 'ops@empresa.com',
    LOG_RETENTION_DAYS: '30',
    QUARANTINE_RETENTION_DAYS: '30',
    QUARANTINE_ALARM_THRESHOLD: '100',
    ICEBERG_SNAPSHOT_RETENTION_DAYS: '7',
  };

  const withKey = (key: string, value: string) => ({ ...VALID, [key]: value });

  test('una base válida construye una config completa', () => {
    const cfg = buildConfig('prod', VALID);
    expect(cfg.envName).toBe('prod');
    expect(cfg.account).toBe('123456789012');
    expect(cfg.removalPolicy).toBe(RemovalPolicy.RETAIN);
    expect(cfg.terminationProtection).toBe(true);
    // GIB se declara en gibibytes por legibilidad y se convierte a bytes acá.
    expect(cfg.athenaBytesCutoff).toBe(5 * 1024 * 1024 * 1024);
  });

  test('un ACCOUNT vacío cae en la cuenta por defecto del proyecto', () => {
    // Es la señal de diseño de la estrategia de cuenta compartida, no un olvido.
    expect(buildConfig('prod', withKey('ACCOUNT', '')).account).toMatch(/^[0-9]{12}$/);
  });

  test.each([
    ['cuenta que no son 12 dígitos', 'ACCOUNT', '12345'],
    ['región inventada', 'REGION', 'us-east'],
    ['removalPolicy desconocida', 'REMOVAL_POLICY', 'DESTROI'],
    ['booleano en mayúsculas', 'TERMINATION_PROTECTION', 'True'],
    ['booleano como 1', 'AUTO_DELETE_OBJECTS', '1'],
    ['entero con decimales', 'GLUE_MAX_WORKERS', '3.5'],
    ['entero vacío', 'LOG_RETENTION_DAYS', ''],
    ['entero fuera de rango', 'ARCHIVE_RETENTION_YEARS', '200'],
    ['entero negativo donde no aplica', 'QUARANTINE_RETENTION_DAYS', '-1'],
    ['cron sin envoltura cron()', 'PIPELINE_SCHEDULE', '0 7 * * ? *'],
    ['cron vacío', 'CRAWLER_SCHEDULE', 'cron()'],
    ['email sin arroba', 'ALERT_EMAIL', 'ops.empresa.com'],
  ])('rechaza %s', (_label, key, value) => {
    // El mensaje debe nombrar el archivo y la clave: lo lee alguien que está
    // editando un archivo de texto, no un stack trace.
    expect(() => buildConfig('prod', withKey(key, value)))
      .toThrow(new RegExp(`config/prod\\.env.*${key}`));
  });

  test('rechaza AUTO_DELETE_OBJECTS=true junto a REMOVAL_POLICY=RETAIN', () => {
    // CDK rechaza esa combinación al instanciar el bucket; atraparla acá señala
    // el archivo que la causó en vez de un construct.
    expect(() => buildConfig('prod', { ...VALID, AUTO_DELETE_OBJECTS: 'true' }))
      .toThrow(/exige REMOVAL_POLICY=DESTROY/);
  });

  test('parsea comentarios, líneas vacías y comillas alrededor del valor', () => {
    const text = [
      '# un comentario',
      '',
      '   # otro, indentado',
      'REGION="us-east-1"',
      "ALERT_EMAIL='ops@empresa.com'",
    ].join('\n');
    // Faltan claves, así que lanza — pero por las que faltan, no por el formato.
    expect(() => parseEnvText('prod', text)).toThrow(/faltan claves obligatorias/);
    expect(() => parseEnvText('prod', text)).not.toThrow(/se esperaba CLAVE=valor/);
  });

  test('un valor puede contener `=` sin escaparlo', () => {
    const values = parseEnvText('prod', Object.entries({ ...VALID, ALERT_EMAIL: 'a=b@c.com' })
      .map(([k, v]) => `${k}=${v}`).join('\n'));
    expect(values.ALERT_EMAIL).toBe('a=b@c.com');
  });

  test.each([
    ['una línea sin `=`', 'REGION'],
    ['una línea que empieza con `=`', '=us-east-1'],
  ])('rechaza %s en vez de ignorarla', (_label, line) => {
    // dotenv ignoraría estas líneas en silencio; acá tienen que cortar.
    expect(() => parseEnvText('prod', line)).toThrow(/se esperaba CLAVE=valor/);
  });

  test('rechaza una clave repetida', () => {
    expect(() => parseEnvText('prod', 'REGION=us-east-1\nREGION=eu-west-1'))
      .toThrow(/REGION está repetida/);
  });

  test('rechaza una clave desconocida', () => {
    // El caso real: un rename a medias, o un typo que dejó la clave vieja en su
    // lugar. Ignorarla haría que el valor recién editado no tuviera efecto.
    const text = Object.entries({ ...VALID, LOG_RETENTION_DAY: '30' })
      .map(([k, v]) => `${k}=${v}`).join('\n');
    expect(() => parseEnvText('prod', text)).toThrow(/claves no reconocidas: LOG_RETENTION_DAY/);
  });

  test('rechaza que falte una clave', () => {
    const { LOG_RETENTION_DAYS, ...rest } = VALID;
    const text = Object.entries(rest).map(([k, v]) => `${k}=${v}`).join('\n');
    expect(() => parseEnvText('prod', text))
      .toThrow(/faltan claves obligatorias: LOG_RETENTION_DAYS/);
  });

  test('los archivos reales del proyecto pasan la validación', () => {
    // Cierra el círculo: los tests de arriba usan una base sintética, este mira lo
    // que de verdad se generó, incluidos los tokens ya sustituidos.
    for (const name of ACTIVE_ENV_NAMES) {
      const raw = fs.readFileSync(path.join(CONFIG_DIR, `${name}.env`), 'utf8');
      expect(raw).not.toContain('{{');
      expect(() => buildConfig(name, parseEnvText(name, raw))).not.toThrow();
    }
  });
});

describe('getConfig', () => {
  test('rechaza nombres mal capitalizados, vacíos e inexistentes', () => {
    // 'staging' es la guarda de regresión del rename a 'stg'. Los demás son
    // nombres que el vocabulario no conoce en ningún proyecto.
    for (const bad of ['staging', 'STG', 'Prod', '', 'uat', 'production']) {
      expect(() => getConfig(bad)).toThrow(/Ambiente desconocido/);
    }
  });

  test('rechaza un ambiente del catálogo que este proyecto NO activó', () => {
    // El caso que importa con un subconjunto: `-c env=qa` en un proyecto de
    // dev+prod tiene que fallar con un mensaje que diga qué ambientes SÍ existen,
    // no sintetizar algo a medias.
    const inactive = CANONICAL.filter((name) => !ACTIVE_ENV_NAMES.includes(name));
    for (const name of inactive) {
      expect(() => getConfig(name)).toThrow(/Ambiente desconocido/);
      expect(() => getConfig(name)).toThrow(new RegExp(ACTIVE_ENV_NAMES.join(', ')));
    }
  });

  test('no resuelve propiedades heredadas del prototipo', () => {
    // Sin la guarda de hasOwnProperty, getConfig('toString') devolvía una función
    // en vez de lanzar, y el fallo real aparecía mucho más abajo.
    for (const bad of ['toString', 'constructor', 'valueOf', 'hasOwnProperty']) {
      expect(() => getConfig(bad)).toThrow(/Ambiente desconocido/);
    }
  });

  // La guarda de "cuenta sin completar" ya no vive acá: la validación ocurre al
  // CARGAR el archivo, no al pedir la config, así que la cubre el bloque de
  // validación de config/<ambiente>.env. Es un cambio a mejor — antes un `synth`
  // podía llegar a construir stacks de otros ambientes antes de fallar.
});

describe('endurecimiento por ambiente', () => {
  const isProtected = (cfg: DatalakeConfig) =>
    cfg.removalPolicy === RemovalPolicy.RETAIN && !cfg.autoDeleteObjects;

  // Condicionales a la PRESENCIA, no a la posición: un proyecto puede no tener
  // `dev` (stg+prod) ni `prod` (solo dev), y estas guardas tienen que valer igual.
  test('si existe, `dev` es el único ambiente que permite destruir datos', () => {
    for (const name of ACTIVE_ENV_NAMES) {
      const cfg = getConfig(name);
      if (name === 'dev') {
        expect(cfg.autoDeleteObjects).toBe(true);
        expect(cfg.removalPolicy).toBe(RemovalPolicy.DESTROY);
      } else {
        expect(isProtected(cfg)).toBe(true);
      }
    }
  });

  test('si existe, `prod` es el único con protección de terminación', () => {
    for (const name of ACTIVE_ENV_NAMES) {
      expect(getConfig(name).terminationProtection).toBe(name === 'prod');
    }
  });

  test('si existe, `prod` nunca baja de un año de retención de logs', () => {
    // Por debajo de 365 días no se sostiene una auditoría.
    if (ACTIVE_ENV_NAMES.includes('prod')) {
      expect(getConfig('prod').logRetentionDays).toBeGreaterThanOrEqual(365);
    }
  });

  test('ningún ambiente activo queda sin tunables operacionales poblados', () => {
    for (const name of ACTIVE_ENV_NAMES) {
      const cfg = getConfig(name);
      expect(cfg.glueMaxWorkers).toBeGreaterThan(0);
      expect(cfg.athenaBytesCutoff).toBeGreaterThan(0);
      expect(cfg.logRetentionDays).toBeGreaterThan(0);
      expect(cfg.quarantineRetentionDays).toBeGreaterThan(0);
      expect(cfg.quarantineAlarmThreshold).toBeGreaterThan(0);
      expect(cfg.icebergSnapshotRetentionDays).toBeGreaterThan(0);
      expect(cfg.pipelineSchedule).toMatch(/^cron\(.+\)$/);
      expect(cfg.crawlerSchedule).toMatch(/^cron\(.+\)$/);
    }
  });
});
