import { RemovalPolicy } from 'aws-cdk-lib';
import {
  DatalakeConfig,
  ENVIRONMENTS,
  EnvName,
  catalogDb,
  getConfig,
  prefix,
} from '../lib/config/environments';

const ALL: EnvName[] = ['dev', 'qa', 'stg', 'prod'];

/**
 * Guardas del mapa de ambientes y de la resolución de cuentas AWS.
 *
 * La razón de ser de este archivo: con la estrategia de cuenta compartida, los
 * tokens de cuenta por ambiente quedan VACÍOS en la generación y el fallback en
 * TypeScript tiene que haberlos resuelto. Un `''` que se cuele acá sintetizaría
 * stacks sin cuenta, y el error aparecería recién en el deploy.
 */
describe('mapa de ambientes', () => {
  test('ENVIRONMENTS tiene exactamente los EnvName declarados', () => {
    // Que FALTE una clave ya es error de compilación (Record<EnvName, ...>); lo
    // que este test agrega es detectar una clave de sobra.
    expect(Object.keys(ENVIRONMENTS).sort()).toEqual([...ALL].sort());
  });

  test.each(ALL)("la clave '%s' coincide con su envName", (name) => {
    // Atrapa el copy-paste clásico: `stg: { envName: 'staging' }`.
    expect(ENVIRONMENTS[name].envName).toBe(name);
  });

  test.each(ALL)("'%s' tiene una cuenta AWS de 12 dígitos", (name) => {
    expect(ENVIRONMENTS[name].account).toMatch(/^[0-9]{12}$/);
  });

  test.each(ALL)("'%s' quedó con región y email poblados tras la generación", (name) => {
    expect(ENVIRONMENTS[name].region).toMatch(/^[a-z]{2}-[a-z]+-[0-9]$/);
    expect(ENVIRONMENTS[name].alertEmail).toContain('@');
  });

  test.each(ALL)("prefix() y catalogDb() llevan el ambiente '%s'", (name) => {
    const cfg = ENVIRONMENTS[name];
    expect(prefix(cfg)).toMatch(new RegExp(`-${name}$`));
    expect(catalogDb(cfg, 'raw')).toMatch(new RegExp(`_${name}_raw$`));
  });
});

describe('getConfig', () => {
  test.each(ALL)("resuelve '%s'", (name) => {
    expect(getConfig(name).envName).toBe(name);
  });

  test('rechaza nombres viejos, mal capitalizados e inexistentes', () => {
    // 'staging' es la guarda de regresión del rename a 'stg'.
    for (const bad of ['staging', 'STG', 'Prod', '', 'uat']) {
      expect(() => getConfig(bad)).toThrow(/Ambiente desconocido/);
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
    const mutable = ENVIRONMENTS.qa as { account: string };
    const original = mutable.account;
    try {
      mutable.account = '';
      expect(() => getConfig('qa')).toThrow(/Cuenta AWS inválida para el ambiente 'qa'/);
      mutable.account = '12345';
      expect(() => getConfig('qa')).toThrow(/Cuenta AWS inválida/);
    } finally {
      mutable.account = original;
    }
  });
});

describe('endurecimiento por ambiente', () => {
  const isProtected = (cfg: DatalakeConfig) =>
    cfg.removalPolicy === RemovalPolicy.RETAIN && !cfg.autoDeleteObjects;

  test('solo dev permite destruir datos', () => {
    expect(ENVIRONMENTS.dev.autoDeleteObjects).toBe(true);
    for (const name of ['qa', 'stg', 'prod'] as EnvName[]) {
      expect(isProtected(ENVIRONMENTS[name])).toBe(true);
    }
  });

  test('solo prod tiene protección de terminación', () => {
    expect(ENVIRONMENTS.prod.terminationProtection).toBe(true);
    for (const name of ['dev', 'qa', 'stg'] as EnvName[]) {
      expect(ENVIRONMENTS[name].terminationProtection).toBe(false);
    }
  });
});
