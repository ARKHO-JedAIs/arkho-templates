import * as cdk from 'aws-cdk-lib';
import { Template } from 'aws-cdk-lib/assertions';
import { DatalakeConfig, getConfig } from '../lib/config/environments';
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
  const base = getConfig('dev');

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

describe('config por ambiente', () => {
  test('prod protege los datos: RETAIN, sin autoDelete y con terminación protegida', () => {
    const prod = getConfig('prod');
    expect(prod.removalPolicy).toBe(cdk.RemovalPolicy.RETAIN);
    expect(prod.autoDeleteObjects).toBe(false);
    expect(prod.terminationProtection).toBe(true);
  });

  test('prod sintetiza los buckets con DeletionPolicy Retain', () => {
    const t = synth('Prod', getConfig('prod'));
    const buckets = t.findResources('AWS::S3::Bucket');
    for (const bucket of Object.values(buckets)) {
      expect(bucket.DeletionPolicy).toBe('Retain');
    }
  });

  // 'staging' y no 'qa': qa es un ambiente VÁLIDO desde que el set pasó a
  // dev|qa|stg|prod, así que sirve además como guarda del rename staging → stg.
  test('un ambiente inexistente falla con un mensaje útil', () => {
    expect(() => getConfig('staging')).toThrow(/Ambiente desconocido/);
  });

  test('los LF-Tags y crons quedan poblados tras la generación', () => {
    const cfg = getConfig('dev');
    expect(cfg.ingestSchedule).toMatch(/^cron\(/);
    expect(cfg.pipelineSchedule).toMatch(/^cron\(/);
    expect(cfg.crawlerSchedule).toMatch(/^cron\(/);
  });
});

describe('storage: propiedades transversales', () => {
  const t = synth('Common', getConfig('dev'));

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
