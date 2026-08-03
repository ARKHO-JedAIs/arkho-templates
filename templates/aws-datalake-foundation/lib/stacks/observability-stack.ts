import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as cloudtrail from 'aws-cdk-lib/aws-cloudtrail';
import * as s3 from 'aws-cdk-lib/aws-s3';
import { NagSuppressions } from 'cdk-nag';
import { DatalakeConfig } from '../config/environments';

export interface ObservabilityStackProps extends cdk.StackProps {
  readonly config: DatalakeConfig;
  readonly dataBuckets: s3.IBucket[];
}

/**
 * Auditoría para cumplimiento normativo (protección de datos personales /
 * sector financiero): CloudTrail con data events sobre las zonas del lake
 * — quién accedió a qué objeto, cuándo y desde dónde.
 *
 * Nota de costo: los data events S3 se cobran por evento (~USD 0.10 por 100k)
 * y el trail registra las 4 zonas. El bucket de logs se crea aquí (en vez de
 * dejar que CloudTrail lo genere) para poder ponerle lifecycle: sin él, los
 * logs de auditoría crecen indefinidamente.
 */
export class ObservabilityStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: ObservabilityStackProps) {
    super(scope, id, props);
    const cfg = props.config;

    // Bucket propio del trail. CloudTrail exige SSE-S3 o una CMK con política
    // específica para `cloudtrail.amazonaws.com`; usamos SSE-S3, que es lo que
    // AWS recomienda para logs de auditoría y evita acoplar la data key.
    const trailBucket = new s3.Bucket(this, 'TrailBucket', {
      encryption: s3.BucketEncryption.S3_MANAGED,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      enforceSSL: true,
      versioned: true,
      lifecycleRules: [
        {
          // Los logs de auditoría se consultan de forma esporádica: a Glacier IR
          // a los 90 días y expiran al cumplir la retención normativa.
          transitions: [
            {
              storageClass: s3.StorageClass.GLACIER_INSTANT_RETRIEVAL,
              transitionAfter: cdk.Duration.days(90),
            },
          ],
          ...(cfg.archiveRetentionYears > 0
            ? { expiration: cdk.Duration.days(cfg.archiveRetentionYears * 365) }
            : {}),
          abortIncompleteMultipartUploadAfter: cdk.Duration.days(7),
        },
      ],
      removalPolicy: cfg.removalPolicy,
      autoDeleteObjects: cfg.autoDeleteObjects,
    });

    const trail = new cloudtrail.Trail(this, 'DataLakeTrail', {
      bucket: trailBucket,
      enableFileValidation: true,
      managementEvents: cloudtrail.ReadWriteType.ALL,
    });

    trail.addS3EventSelector(
      props.dataBuckets.map((bucket) => ({ bucket })),
      { readWriteType: cloudtrail.ReadWriteType.ALL },
    );

    new cdk.CfnOutput(this, 'TrailBucketName', { value: trailBucket.bucketName });

    // ── cdk-nag: supresión con evidencia ────────────────────────────────────
    NagSuppressions.addResourceSuppressions(trailBucket, [
      {
        id: 'AwsSolutions-S1',
        reason:
          'Este ES el bucket de auditoría. Habilitarle server access logs exigiría un segundo ' +
          'bucket de logs que a su vez pediría lo mismo (recursión). El acceso al bucket queda ' +
          'registrado por los management events del propio trail, con validación de integridad ' +
          'activada.',
      },
    ]);
  }
}
