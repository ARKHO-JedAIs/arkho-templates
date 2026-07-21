import * as cdk from 'aws-cdk-lib';
import { Match, Template } from 'aws-cdk-lib/assertions';
import { getConfig } from '../lib/config/environments';
import { SecurityStack } from '../lib/stacks/security-stack';
import { StorageStack } from '../lib/stacks/storage-stack';

describe('StorageStack', () => {
  const app = new cdk.App();
  const cfg = getConfig('dev');
  const env = { account: '111111111111', region: cfg.region };
  const security = new SecurityStack(app, 'TestSecurity', { env, config: cfg });
  const storage = new StorageStack(app, 'TestStorage', {
    env,
    config: cfg,
    dataKey: security.dataKey,
  });
  const template = Template.fromStack(storage);

  test('crea las 3 zonas + resultados Athena + access logs', () => {
    template.resourceCountIs('AWS::S3::Bucket', 5);
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

  test('Raw Zone transiciona a Glacier IR a los 90 días', () => {
    template.hasResourceProperties('AWS::S3::Bucket', {
      LifecycleConfiguration: {
        Rules: Match.arrayWith([
          Match.objectLike({
            Transitions: [{ StorageClass: 'GLACIER_IR', TransitionInDays: 90 }],
          }),
        ]),
      },
    });
  });
});
