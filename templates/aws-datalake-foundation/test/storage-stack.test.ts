import { Match, Template } from 'aws-cdk-lib/assertions';
import { buildEnv } from './helpers';

describe('StorageStack', () => {
  const { cfg, storage } = buildEnv('Test', 'dev');
  const template = Template.fromStack(storage);

  test('crea las 5 zonas + Athena results + access logs (7 buckets)', () => {
    template.resourceCountIs('AWS::S3::Bucket', 7);
  });

  test('todos los buckets bloquean acceso público', () => {
    const buckets = template.findResources('AWS::S3::Bucket');
    for (const bucket of Object.values(buckets)) {
      expect(bucket.Properties.PublicAccessBlockConfiguration).toEqual({
        BlockPublicAcls: true,
        BlockPublicPolicy: true,
        IgnorePublicAcls: true,
        RestrictPublicBuckets: true,
      });
    }
  });

  test('las zonas del lake usan SSE-KMS con CMK', () => {
    template.hasResourceProperties('AWS::S3::Bucket', {
      BucketEncryption: {
        ServerSideEncryptionConfiguration: Match.arrayWith([
          Match.objectLike({
            ServerSideEncryptionByDefault: Match.objectLike({ SSEAlgorithm: 'aws:kms' }),
          }),
        ]),
      },
    });
  });

  test('Raw Zone: transición a Glacier IR según rawTransitionDays (0 = sin transición)', () => {
    if (cfg.rawTransitionDays > 0) {
      template.hasResourceProperties('AWS::S3::Bucket', {
        LifecycleConfiguration: {
          Rules: Match.arrayWith([
            Match.objectLike({
              Transitions: [{ StorageClass: 'GLACIER_IR', TransitionInDays: cfg.rawTransitionDays }],
            }),
          ]),
        },
      });
    } else {
      // Sin retención: la Raw Zone no debe tener transición a Glacier
      const rawKey = Object.keys(template.findResources('AWS::S3::Bucket')).find(k =>
        k.startsWith('RawZoneBucket'));
      const raw = template.findResources('AWS::S3::Bucket')[rawKey!];
      const rules = raw.Properties.LifecycleConfiguration?.Rules ?? [];
      expect(rules.some((r: any) => r.Transitions)).toBe(false);
    }
  });

  test('Archive Zone: Glacier IR día 1 y expiración según archiveRetentionYears (0 = sin expiración)', () => {
    if (cfg.archiveRetentionYears > 0) {
      template.hasResourceProperties('AWS::S3::Bucket', {
        LifecycleConfiguration: {
          Rules: Match.arrayWith([
            Match.objectLike({
              Transitions: [{ StorageClass: 'GLACIER_IR', TransitionInDays: 1 }],
              ExpirationInDays: cfg.archiveRetentionYears * 365,
            }),
          ]),
        },
      });
    } else {
      template.hasResourceProperties('AWS::S3::Bucket', {
        LifecycleConfiguration: {
          Rules: Match.arrayWith([
            Match.objectLike({
              Transitions: [{ StorageClass: 'GLACIER_IR', TransitionInDays: 1 }],
              ExpirationInDays: Match.absent(),
            }),
          ]),
        },
      });
    }
  });

  test('Athena results bucket tiene expiración de 30 días', () => {
    template.hasResourceProperties('AWS::S3::Bucket', {
      LifecycleConfiguration: {
        Rules: Match.arrayWith([
          Match.objectLike({ ExpirationInDays: 30 }),
        ]),
      },
    });
  });
});
