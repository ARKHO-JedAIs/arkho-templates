import * as cdk from 'aws-cdk-lib';
import * as s3 from 'aws-cdk-lib/aws-s3';
import { Construct } from 'constructs';

interface StorageZonesProps {
  projectName: string;
  environment: string;
  bucketPrefix: string;
  rawRetentionDays: number;
  archiveRetentionYears: number;
}

export class StorageZones extends Construct {
  public readonly rawBucket: s3.Bucket;
  public readonly curatedBucket: s3.Bucket;
  public readonly analyticsBucket: s3.Bucket;
  public readonly archiveBucket: s3.Bucket;

  constructor(scope: Construct, id: string, props: StorageZonesProps) {
    super(scope, id);

    const { bucketPrefix, environment, rawRetentionDays, archiveRetentionYears } = props;
    const suffix = `${bucketPrefix}-${environment}`;

    const commonProps: Omit<s3.BucketProps, 'bucketName' | 'lifecycleRules'> = {
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      encryption: s3.BucketEncryption.S3_MANAGED,
      enforceSSL: true,
      versioned: true,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    };

    this.rawBucket = new s3.Bucket(this, 'RawBucket', {
      ...commonProps,
      bucketName: `${suffix}-raw`,
      lifecycleRules: [
        {
          id: 'raw-tiering-and-expiry',
          transitions: [
            {
              storageClass: s3.StorageClass.INTELLIGENT_TIERING,
              transitionAfter: cdk.Duration.days(30),
            },
          ],
          expiration: cdk.Duration.days(rawRetentionDays),
          noncurrentVersionExpiration: cdk.Duration.days(30),
        },
      ],
    });

    this.curatedBucket = new s3.Bucket(this, 'CuratedBucket', {
      ...commonProps,
      bucketName: `${suffix}-curated`,
      lifecycleRules: [
        {
          id: 'curated-tiering',
          transitions: [
            {
              storageClass: s3.StorageClass.INTELLIGENT_TIERING,
              transitionAfter: cdk.Duration.days(90),
            },
          ],
        },
      ],
    });

    this.analyticsBucket = new s3.Bucket(this, 'AnalyticsBucket', {
      ...commonProps,
      bucketName: `${suffix}-analytics`,
      lifecycleRules: [
        {
          id: 'analytics-tiering',
          transitions: [
            {
              storageClass: s3.StorageClass.INTELLIGENT_TIERING,
              transitionAfter: cdk.Duration.days(90),
            },
          ],
        },
      ],
    });

    this.archiveBucket = new s3.Bucket(this, 'ArchiveBucket', {
      ...commonProps,
      bucketName: `${suffix}-archive`,
      lifecycleRules: [
        {
          id: 'archive-glacier-expiry',
          transitions: [
            {
              storageClass: s3.StorageClass.GLACIER_INSTANT_RETRIEVAL,
              transitionAfter: cdk.Duration.days(1),
            },
          ],
          expiration: cdk.Duration.days(archiveRetentionYears * 365),
        },
      ],
    });
  }
}
