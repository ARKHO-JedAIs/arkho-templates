import * as cdk from 'aws-cdk-lib';
import { Template } from 'aws-cdk-lib/assertions';
import { DEFAULT_ENV, DatalakeConfig, getConfig } from '../lib/config/environments';
import { buildStacks } from './helpers';

/**
 * Las dos ramas de retención (activada / desactivada con 0) se prueban con
 * configs construidas a mano. El test de storage-stack solo puede cubrir la
 * rama que corresponda a los valores elegidos en la generación; aquí cubrimos
 * ambas siempre, independiente de esos valores.
 */
const withRetention = (
  base: DatalakeConfig,
  rawTransitionDays: number,
  archiveRetentionYears: number,
): DatalakeConfig => ({ ...base, rawTransitionDays, archiveRetentionYears });

const synth = (id: string, cfg: DatalakeConfig): Template =>
  Template.fromStack(buildStacks(id, cfg).storage);

const bucketByPrefix = (t: Template, prefix: string) => {
  const buckets = t.findResources('AWS::S3::Bucket');
  const key = Object.keys(buckets).find((k) => k.startsWith(prefix));
  if (!key) throw new Error(`no se encontró el bucket ${prefix}`);
  return buckets[key];
};

describe('retención configurable', () => {
  const base = getConfig(DEFAULT_ENV);

  describe('con retención activada (90 días / 7 años)', () => {
    const t = synth('On', withRetention(base, 90, 7));

    test('Raw transiciona a Glacier IR a los 90 días', () => {
      const rules = bucketByPrefix(t, 'RawZoneBucket').Properties.LifecycleConfiguration.Rules;
      expect(rules).toEqual(expect.arrayContaining([
        expect.objectContaining({
          Transitions: [{ StorageClass: 'GLACIER_IR', TransitionInDays: 90 }],
        }),
      ]));
    });

    test('Archive expira a los 7 años', () => {
      const rules = bucketByPrefix(t, 'ArchiveZoneBucket').Properties.LifecycleConfiguration.Rules;
      expect(rules).toEqual(expect.arrayContaining([
        expect.objectContaining({ ExpirationInDays: 7 * 365 }),
      ]));
    });
  });

  describe('con retención desactivada (0 / 0)', () => {
    const t = synth('Off', withRetention(base, 0, 0));

    test('Raw NO transiciona a Glacier: los datos quedan en Standard', () => {
      const rules: any[] =
        bucketByPrefix(t, 'RawZoneBucket').Properties.LifecycleConfiguration.Rules;
      expect(rules.some((r) => r.Transitions)).toBe(false);
    });

    test('Archive sigue en Glacier IR desde el día 1 pero NO expira', () => {
      const rules = bucketByPrefix(t, 'ArchiveZoneBucket').Properties.LifecycleConfiguration.Rules;
      expect(rules).toEqual(expect.arrayContaining([
        expect.objectContaining({
          Transitions: [{ StorageClass: 'GLACIER_IR', TransitionInDays: 1 }],
        }),
      ]));
      for (const rule of rules as any[]) {
        expect(rule.ExpirationInDays).toBeUndefined();
      }
    });
  });
});

describe('propagación de removalPolicy', () => {
  // Config construida A MANO y no `getConfig('prod')`: qué ambientes existe se
  // elige en la generación, y este proyecto podría no tener `prod`. Lo que se
  // prueba es el MECANISMO — una config con RETAIN produce buckets que sobreviven
  // al destroy —, que es válido en cualquier proyecto. Que `prod` sea justamente
  // uno de esos ambientes lo afirma environments.test.ts, cuando existe.
  const retained: DatalakeConfig = {
    ...getConfig(DEFAULT_ENV),
    removalPolicy: cdk.RemovalPolicy.RETAIN,
    autoDeleteObjects: false,
  };

  test('RETAIN sintetiza todos los buckets con DeletionPolicy Retain', () => {
    const t = synth('Retained', retained);
    const buckets = t.findResources('AWS::S3::Bucket');
    expect(Object.keys(buckets).length).toBeGreaterThan(0);
    for (const bucket of Object.values(buckets)) {
      expect(bucket.DeletionPolicy).toBe('Retain');
    }
  });

  // 'staging' no pertenece al vocabulario en NINGÚN proyecto: sirve como guarda
  // del rename staging → stg sin depender de qué ambientes se eligieron.
  test('un ambiente inexistente falla con un mensaje útil', () => {
    expect(() => getConfig('staging')).toThrow(/Ambiente desconocido/);
  });
});

describe('storage: propiedades transversales', () => {
  const t = synth('Common', getConfig(DEFAULT_ENV));

  test('todos los buckets deniegan tráfico sin TLS', () => {
    const policies = Object.values(t.findResources('AWS::S3::BucketPolicy'));
    expect(policies.length).toBeGreaterThan(0);
    for (const policy of policies) {
      const stmts = policy.Properties.PolicyDocument.Statement as any[];
      const denyInsecure = stmts.filter(
        (s) => s.Effect === 'Deny' && s.Condition?.Bool?.['aws:SecureTransport'] === 'false',
      );
      expect(denyInsecure).toHaveLength(1);
    }
  });
});
