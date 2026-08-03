import * as cdk from 'aws-cdk-lib';
import { Template } from 'aws-cdk-lib/assertions';
import { ENVIRONMENTS, EnvName, getConfig } from '../lib/config/environments';
import {
  BASE_TAG_KEYS,
  UNTAGGABLE_TYPES,
  UNTAGGED_CDK_SINGLETON_PREFIXES,
  applyStandardTags,
  baseTags,
  parseExtraTags,
  sanitizeTagValue,
} from '../lib/config/tags';
import { SecurityStack } from '../lib/stacks/security-stack';
import { StorageStack } from '../lib/stacks/storage-stack';
import { GovernanceStack } from '../lib/stacks/governance-stack';
import { ProcessingStack } from '../lib/stacks/processing-stack';
import { IngestionStack } from '../lib/stacks/ingestion-stack';
import { ConsumptionStack } from '../lib/stacks/consumption-stack';
import { ObservabilityStack } from '../lib/stacks/observability-stack';

/**
 * Ningún test acá puede afirmar sobre el VALOR bakeado de `extra_tags` o
 * `tag_owner`: pasaría en el repo del template y fallaría en cada proyecto
 * generado. Se testea el parser con strings inyectados y la cobertura con
 * extras inyectados.
 */
describe('parseExtraTags', () => {
  test('sin tags extra devuelve un objeto vacío', () => {
    expect(parseExtraTags('')).toEqual({});
    expect(parseExtraTags('   ')).toEqual({});
  });

  test('parsea pares key=value', () => {
    expect(parseExtraTags('cost-center=1234,team=data')).toEqual({
      'cost-center': '1234',
      team: 'data',
    });
  });

  test('tolera espacios alrededor de claves y valores', () => {
    expect(parseExtraTags(' cost-center = 1234 , team = data ')).toEqual({
      'cost-center': '1234',
      team: 'data',
    });
  });

  test('acepta `=` dentro del valor (parte en el primer `=`)', () => {
    expect(parseExtraTags('filter=a=b')).toEqual({ filter: 'a=b' });
  });

  test.each([
    ['sin signo igual', 'cost-center'],
    ['clave vacía', '=1234'],
    ['valor vacío', 'cost-center='],
    ['clave duplicada', 'team=data,team=other'],
    ['prefijo aws: reservado', 'aws:cloudformation:x=y'],
    ['prefijo AWS: en mayúsculas', 'AWS:foo=bar'],
    ['colisión con clave base', 'Owner=someone'],
    ['colisión con clave base, otra capitalización', 'owner=someone'],
    ['carácter no permitido en el valor', 'team=Acme & Sons'],
    ['comilla simple en el valor', "team=O'Brien"],
  ])('rechaza: %s', (_label, raw) => {
    expect(() => parseExtraTags(raw)).toThrow(/extra_tags:/);
  });

  test('rechaza una clave de más de 128 caracteres', () => {
    expect(() => parseExtraTags(`${'k'.repeat(129)}=v`)).toThrow(/extra_tags:/);
  });

  test('rechaza un valor de más de 256 caracteres', () => {
    expect(() => parseExtraTags(`k=${'v'.repeat(257)}`)).toThrow(/extra_tags:/);
  });

  test('rechaza pasar del máximo de 50 tags por recurso', () => {
    // 5 del set base + 46 extras = 51 > 50
    const many = Array.from({ length: 46 }, (_, i) => `k${i}=v`).join(',');
    expect(() => parseExtraTags(many)).toThrow(/máximo de 50/);
  });

  test('45 extras + 5 base = 50, justo en el límite', () => {
    const many = Array.from({ length: 45 }, (_, i) => `k${i}=v`).join(',');
    expect(Object.keys(parseExtraTags(many))).toHaveLength(45);
  });
});

describe('sanitizeTagValue', () => {
  test('reemplaza los caracteres que AWS rechaza en un valor de tag', () => {
    // `client_name` permite `&`, `#` y paréntesis porque también se usa en prosa;
    // AWS los rechaza en tags y el fallo aparecería recién en el deploy.
    expect(sanitizeTagValue('Acme & Sons')).toBe('Acme - Sons');
    expect(sanitizeTagValue('Retail (Chile)')).toBe('Retail -Chile-');
    expect(sanitizeTagValue('A#1')).toBe('A-1');
  });

  test('PRESERVA los acentos: AWS los acepta y mutilarlos sería un bug', () => {
    expect(sanitizeTagValue('Compañía Minera')).toBe('Compañía Minera');
    expect(sanitizeTagValue('Diseño & Café')).toBe('Diseño - Café');
  });

  test('deja intacto lo que ya es válido', () => {
    expect(sanitizeTagValue('Acme Corp')).toBe('Acme Corp');
    expect(sanitizeTagValue('data-platform_1/prod')).toBe('data-platform_1/prod');
  });

  test('trunca a 256 caracteres', () => {
    expect(sanitizeTagValue('x'.repeat(300))).toHaveLength(256);
  });
});

describe('set base de tags', () => {
  test('usa claves en inglés y el ambiente correcto', () => {
    for (const name of Object.keys(ENVIRONMENTS) as EnvName[]) {
      const tags = baseTags(ENVIRONMENTS[name]);
      expect(Object.keys(tags).sort()).toEqual([...BASE_TAG_KEYS].sort());
      expect(tags.Environment).toBe(name);
      expect(tags.ManagedBy).toBe('cdk');
    }
  });

  test('ningún valor del set base queda vacío tras la generación', () => {
    for (const [key, value] of Object.entries(baseTags(getConfig('dev')))) {
      expect(value.length).toBeGreaterThan(0);
      expect(value).not.toContain('{{');  // token sin resolver
      expect(key).toMatch(/^[A-Z]/);      // claves en inglés, PascalCase
    }
  });
});

/** Normaliza las dos formas de tag de CloudFormation a un Record. */
const readTags = (props: Record<string, unknown>): Record<string, string> | undefined => {
  const raw = props?.Tags;
  if (raw === undefined) return undefined;
  if (Array.isArray(raw)) {
    return Object.fromEntries(raw.map((t: { Key: string; Value: string }) => [t.Key, t.Value]));
  }
  if (typeof raw === 'object') return raw as Record<string, string>;
  return undefined;
};

describe('cobertura de tags en los recursos sintetizados', () => {
  const cfg = getConfig('dev');
  const EXTRAS = { 'cost-center': '1234', team: 'data' };
  const app = new cdk.App();
  const env = { account: cfg.account, region: cfg.region };

  const security = new SecurityStack(app, 'Sec', { env, config: cfg });
  const storage = new StorageStack(app, 'Sto', { env, config: cfg, dataKey: security.dataKey });
  const governance = new GovernanceStack(app, 'Gov', {
    env,
    config: cfg,
    rawBucket: storage.rawBucket,
    cleanBucket: storage.cleanBucket,
    curatedBucket: storage.curatedBucket,
  });
  const processing = new ProcessingStack(app, 'Proc', {
    env,
    config: cfg,
    rawBucket: storage.rawBucket,
    cleanBucket: storage.cleanBucket,
    curatedBucket: storage.curatedBucket,
    archiveBucket: storage.archiveBucket,
    dataKey: security.dataKey,
    opsKey: security.opsKey,
    alertsTopic: security.alertsTopic,
  });
  const ingestion = new IngestionStack(app, 'Ing', {
    env,
    config: cfg,
    rawBucket: storage.rawBucket,
    dataKey: security.dataKey,
    opsKey: security.opsKey,
    alertsTopic: security.alertsTopic,
  });
  const consumption = new ConsumptionStack(app, 'Con', {
    env,
    config: cfg,
    athenaResultsBucket: storage.athenaResultsBucket,
    dataKey: security.dataKey,
  });
  const observability = new ObservabilityStack(app, 'Obs', {
    env,
    config: cfg,
    dataBuckets: [storage.rawBucket, storage.cleanBucket, storage.curatedBucket],
  });

  // Debe correr ANTES del primer Template.fromStack: esa llamada sintetiza y
  // ejecuta los aspectos, incluido el que aplica los tags.
  applyStandardTags(app, cfg, EXTRAS);

  const stacks = { security, storage, governance, processing, ingestion, consumption, observability };
  const expected = { ...baseTags(cfg), ...EXTRAS };

  test.each(Object.entries(stacks))(
    'todo recurso etiquetable del stack %s lleva el set completo',
    (_name, stack) => {
      const resources = Template.fromStack(stack).toJSON().Resources ?? {};
      const offenders: string[] = [];

      for (const [logicalId, resource] of Object.entries<any>(resources)) {
        if (UNTAGGABLE_TYPES.includes(resource.Type)) continue;
        if (UNTAGGED_CDK_SINGLETON_PREFIXES.some((pre) => logicalId.startsWith(pre))) continue;
        const tags = readTags(resource.Properties ?? {});
        if (tags === undefined) {
          offenders.push(`${logicalId} (${resource.Type}): sin propiedad Tags`);
          continue;
        }
        for (const [key, value] of Object.entries(expected)) {
          if (tags[key] !== value) {
            offenders.push(`${logicalId} (${resource.Type}): falta ${key}=${value}`);
          }
        }
      }

      // Si esto falla por un tipo nuevo que CloudFormation no permite etiquetar,
      // agrégalo a UNTAGGABLE_TYPES en lib/config/tags.ts con su justificación.
      expect(offenders).toEqual([]);
    },
  );

  test('los Glue Jobs y Crawlers llevan Tags como MAPA', () => {
    // AWS::Glue::* declara Tags como mapa JSON libre, no como lista {Key,Value}.
    // CDK lo modela con TagType.MAP; este test lo fija por si cambia.
    const t = Template.fromStack(processing);
    for (const type of ['AWS::Glue::Job', 'AWS::Glue::Crawler']) {
      const found = Object.values<any>(t.findResources(type));
      expect(found.length).toBeGreaterThan(0);
      for (const resource of found) {
        expect(Array.isArray(resource.Properties.Tags)).toBe(false);
        expect(resource.Properties.Tags).toMatchObject(expected);
      }
    }
  });

  test('los buckets S3 llevan Tags como LISTA {Key,Value}', () => {
    const buckets = Object.values<any>(Template.fromStack(storage).findResources('AWS::S3::Bucket'));
    expect(buckets.length).toBeGreaterThan(0);
    for (const bucket of buckets) {
      expect(Array.isArray(bucket.Properties.Tags)).toBe(true);
      expect(readTags(bucket.Properties)).toMatchObject(expected);
    }
  });

  test('las bases Glue NO llevan Tags: no son etiquetables en CloudFormation', () => {
    // La brecha, en forma ejecutable. AWS Glue no expone tagging de bases del
    // catálogo, así que la ausencia es lo esperado, no un olvido.
    const dbs = Object.values<any>(Template.fromStack(governance).findResources('AWS::Glue::Database'));
    expect(dbs.length).toBeGreaterThan(0);
    for (const db of dbs) {
      expect(db.Properties.Tags).toBeUndefined();
    }
  });
});
