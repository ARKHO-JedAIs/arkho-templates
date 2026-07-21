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
 * Backbone del Data Lake: 3 zonas S3 (Raw, Clean, Curated) + bucket de
 * resultados Athena + bucket de access logs.
 *
 * Mejores prácticas aplicadas:
 * - Sin nombres físicos (CDK genera nombres únicos, evita colisiones).
 * - BlockPublicAccess total, SSL forzado, versionado y cifrado SSE-KMS (CMK).
 * - Server access logs centralizados.
 * - Lifecycle: Raw → Glacier IR a los 90 días (decisión v2), limpieza de
 *   versiones no actuales y multipart incompletos.
 */
export class StorageStack extends cdk.Stack {
  public readonly rawBucket: s3.Bucket;
  public readonly cleanBucket: s3.Bucket;
  public readonly curatedBucket: s3.Bucket;
  public readonly athenaResultsBucket: s3.Bucket;
  public readonly accessLogsBucket: s3.Bucket;

  constructor(scope: Construct, id: string, props: StorageStackProps) {
    super(scope, id, props);
    const cfg = props.config;

    // Los access logs de S3 solo soportan SSE-S3 en el bucket destino
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
      bucketKeyEnabled: true, // reduce llamadas (y costo) KMS
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      enforceSSL: true,
      versioned: true,
      serverAccessLogsBucket: this.accessLogsBucket,
      removalPolicy: cfg.removalPolicy,
      autoDeleteObjects: cfg.autoDeleteObjects,
    };

    this.rawBucket = new s3.Bucket(this, 'RawZoneBucket', {
      ...zoneDefaults,
      serverAccessLogsPrefix: 'raw/',
      lifecycleRules: [
        {
          transitions: [
            {
              storageClass: s3.StorageClass.GLACIER_INSTANT_RETRIEVAL,
              transitionAfter: cdk.Duration.days(cfg.rawTransitionDays),
            },
          ],
          noncurrentVersionExpiration: cdk.Duration.days(90),
          abortIncompleteMultipartUploadAfter: cdk.Duration.days(7),
        },
      ],
    });

    this.cleanBucket = new s3.Bucket(this, 'CleanZoneBucket', {
      ...zoneDefaults,
      serverAccessLogsPrefix: 'clean/',
      lifecycleRules: [
        {
          noncurrentVersionExpiration: cdk.Duration.days(90),
          abortIncompleteMultipartUploadAfter: cdk.Duration.days(7),
        },
        // Área temporal de Glue: se limpia sola
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

    this.athenaResultsBucket = new s3.Bucket(this, 'AthenaResultsBucket', {
      ...zoneDefaults,
      versioned: false,
      serverAccessLogsPrefix: 'athena-results/',
      lifecycleRules: [{ expiration: cdk.Duration.days(30) }],
    });

    new cdk.CfnOutput(this, 'RawBucketName', { value: this.rawBucket.bucketName });
    new cdk.CfnOutput(this, 'CleanBucketName', { value: this.cleanBucket.bucketName });
    new cdk.CfnOutput(this, 'CuratedBucketName', { value: this.curatedBucket.bucketName });
  }
}
