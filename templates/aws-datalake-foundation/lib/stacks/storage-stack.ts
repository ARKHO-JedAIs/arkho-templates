import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as kms from 'aws-cdk-lib/aws-kms';
import * as s3 from 'aws-cdk-lib/aws-s3';
import { DatalakeConfig } from '../config/environments';

export interface StorageStackProps extends cdk.StackProps {
  readonly config: DatalakeConfig;
  readonly dataKey: kms.IKey;
}

/**
 * Backbone del Data Lake: 4 zonas S3 (Raw, Clean, Curated, Archive) +
 * bucket de resultados Athena + bucket de access logs centralizados.
 *
 * Mejores prácticas aplicadas:
 * - Sin nombres físicos (CDK genera nombres únicos, evita colisiones globales).
 * - BlockPublicAccess total, SSL forzado, versionado y cifrado SSE-KMS (CMK).
 * - Server access logs centralizados en un bucket SSE-S3 dedicado.
 * - Lifecycle diferenciado por zona:
 *   Raw → Glacier IR a los rawTransitionDays (0 = sin transición, queda en Standard).
 *   Clean/Curated → limpieza de versiones no actuales y multipart incompletos.
 *   Archive → Glacier IR desde el día 1, expira a los archiveRetentionYears
 *             (0 = sin expiración, retención indefinida).
 *   AthenaResults → expira a los 30 días (resultados transitorios).
 */
export class StorageStack extends cdk.Stack {
  public readonly rawBucket: s3.Bucket;
  public readonly cleanBucket: s3.Bucket;
  public readonly curatedBucket: s3.Bucket;
  public readonly archiveBucket: s3.Bucket;
  public readonly athenaResultsBucket: s3.Bucket;
  public readonly accessLogsBucket: s3.Bucket;

  constructor(scope: Construct, id: string, props: StorageStackProps) {
    super(scope, id, props);
    const cfg = props.config;

    // Access logs: S3 solo admite SSE-S3 en el bucket destino de logs
    this.accessLogsBucket = new s3.Bucket(this, 'AccessLogsBucket', {
      encryption: s3.BucketEncryption.S3_MANAGED,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      enforceSSL: true,
      objectOwnership: s3.ObjectOwnership.BUCKET_OWNER_PREFERRED,
      lifecycleRules: [{ expiration: cdk.Duration.days(365) }],
      removalPolicy: cfg.removalPolicy,
      autoDeleteObjects: cfg.autoDeleteObjects,
    });

    const zoneDefaults: s3.BucketProps = {
      encryption: s3.BucketEncryption.KMS,
      encryptionKey: props.dataKey,
      bucketKeyEnabled: true, // reduce llamadas (y costo) KMS hasta ~90 %
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      enforceSSL: true,
      versioned: true,
      serverAccessLogsBucket: this.accessLogsBucket,
      removalPolicy: cfg.removalPolicy,
      autoDeleteObjects: cfg.autoDeleteObjects,
    };

    // rawTransitionDays === 0 → sin transición a Glacier (los datos quedan en Standard).
    const rawRule: s3.LifecycleRule = {
      noncurrentVersionExpiration: cdk.Duration.days(30),
      abortIncompleteMultipartUploadAfter: cdk.Duration.days(7),
      ...(cfg.rawTransitionDays > 0
        ? {
            transitions: [
              {
                storageClass: s3.StorageClass.GLACIER_INSTANT_RETRIEVAL,
                transitionAfter: cdk.Duration.days(cfg.rawTransitionDays),
              },
            ],
          }
        : {}),
    };

    this.rawBucket = new s3.Bucket(this, 'RawZoneBucket', {
      ...zoneDefaults,
      serverAccessLogsPrefix: 'raw/',
      lifecycleRules: [rawRule],
    });

    this.cleanBucket = new s3.Bucket(this, 'CleanZoneBucket', {
      ...zoneDefaults,
      serverAccessLogsPrefix: 'clean/',
      lifecycleRules: [
        {
          noncurrentVersionExpiration: cdk.Duration.days(90),
          abortIncompleteMultipartUploadAfter: cdk.Duration.days(7),
        },
        { prefix: 'glue-temp/', expiration: cdk.Duration.days(7) },
      ],
    });

    this.curatedBucket = new s3.Bucket(this, 'CuratedZoneBucket', {
      ...zoneDefaults,
      serverAccessLogsPrefix: 'curated/',
      lifecycleRules: [
        {
          noncurrentVersionExpiration: cdk.Duration.days(90),
          abortIncompleteMultipartUploadAfter: cdk.Duration.days(7),
        },
      ],
    });

    // Archive: Glacier IR desde día 1, expiración a los N años configurados.
    // Usar para datos que deben retenerse por normativa pero rara vez se acceden.
    // archiveRetentionYears === 0 → sin expiración (retención indefinida).
    const archiveRule: s3.LifecycleRule = {
      transitions: [
        {
          storageClass: s3.StorageClass.GLACIER_INSTANT_RETRIEVAL,
          transitionAfter: cdk.Duration.days(1),
        },
      ],
      noncurrentVersionExpiration: cdk.Duration.days(30),
      abortIncompleteMultipartUploadAfter: cdk.Duration.days(7),
      ...(cfg.archiveRetentionYears > 0
        ? { expiration: cdk.Duration.days(cfg.archiveRetentionYears * 365) }
        : {}),
    };

    this.archiveBucket = new s3.Bucket(this, 'ArchiveZoneBucket', {
      ...zoneDefaults,
      serverAccessLogsPrefix: 'archive/',
      lifecycleRules: [archiveRule],
    });

    this.athenaResultsBucket = new s3.Bucket(this, 'AthenaResultsBucket', {
      ...zoneDefaults,
      versioned: false,
      serverAccessLogsPrefix: 'athena-results/',
      lifecycleRules: [{ expiration: cdk.Duration.days(30) }],
    });

    new cdk.CfnOutput(this, 'RawBucketName', { value: this.rawBucket.bucketName });
    new cdk.CfnOutput(this, 'CleanBucketName', { value: this.cleanBucket.bucketName });
    new cdk.CfnOutput(this, 'CuratedBucketName', { value: this.curatedBucket.bucketName });
    new cdk.CfnOutput(this, 'ArchiveBucketName', { value: this.archiveBucket.bucketName });
  }
}
