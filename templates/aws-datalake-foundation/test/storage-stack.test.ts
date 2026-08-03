import * as cdk from 'aws-cdk-lib';
import { Match, Template } from 'aws-cdk-lib/assertions';
import { getConfig } from '../lib/config/environments';
import { SecurityStack } from '../lib/stacks/security-stack';
import { StorageStack } from '../lib/stacks/storage-stack';

describe('StorageStack', () => {
  const app = new cdk.App();
  const cfg = getConfig('dev');
  const env = { account: cfg.account, region: cfg.region };
  const security = new SecurityStack(app, 'TestSecurity', { env, config: cfg });
  const storage = new StorageStack(app, 'TestStorage', {
    env,
    config: cfg,
    dataKey: security.dataKey,
  });
  const template = Template.fromStack(storage);

  test('crea las 4 zonas + Athena results + access logs (6 buckets)', () => {
    template.resourceCountIs('AWS::S3::Bucket', 6);
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
