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
  catalogDb,
  getConfig,
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

  test('el context `environments` de cdk.json coincide con ACTIVE_ENV_NAMES', () => {
    // scripts/each-env.js lee la lista de cdk.json en vez de importar este módulo,
    // para seguir siendo node puro. Este test es lo que impide que las dos copias
    // divergan por una edición a medias: sin él, `nag:all` y el CI podrían estar
    // recorriendo un set distinto al que despliega la app.
    const cdkJson = JSON.parse(
      fs.readFileSync(path.join(__dirname, '..', 'cdk.json'), 'utf8'),
    );
    const fromContext: string[] = String(cdkJson.context.environments)
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    expect(fromContext.sort()).toEqual([...ACTIVE_ENV_NAMES].sort());
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

  test('una cuenta sin completar falla con un mensaje accionable', () => {
    // `account` es readonly solo a nivel de tipos. try/finally para no filtrar
    // la mutación al resto del archivo.
    const target = HARDENED_ENV;
    const mutable = getConfig(target) as { account: string };
    const original = mutable.account;
    try {
      mutable.account = '';
      expect(() => getConfig(target)).toThrow(
        new RegExp(`Cuenta AWS inválida para el ambiente '${target}'`),
      );
      mutable.account = '12345';
      expect(() => getConfig(target)).toThrow(/Cuenta AWS inválida/);
    } finally {
      mutable.account = original;
    }
  });
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
