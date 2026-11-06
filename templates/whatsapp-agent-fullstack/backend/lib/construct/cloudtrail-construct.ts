import { Construct } from 'constructs';
import * as cloudtrail from 'aws-cdk-lib/aws-cloudtrail';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as logs from 'aws-cdk-lib/aws-logs';
import { RemovalPolicy, Duration } from 'aws-cdk-lib';
import { ParamsConfig } from '../stack/shared/util/env-config';

export interface CloudTrailConstructProps {
  params: ParamsConfig;
}

export class CloudTrailConstruct extends Construct {
  public readonly trail: cloudtrail.Trail;

  constructor(scope: Construct, id: string, props: CloudTrailConstructProps) {
    super(scope, id);

    const { params } = props;

    const logBucket = new s3.Bucket(this, 'TrailBucket', {
      bucketName: `${params.projectName}-${params.envName}-cloudtrail-logs`,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      enforceSSL: true,
      versioned: false,
      lifecycleRules: [
        {
          id: 'ExpireOldLogs',
          enabled: true,
          expiration: Duration.days(90),
        },
      ],
      removalPolicy: params.isProd ? RemovalPolicy.RETAIN : RemovalPolicy.DESTROY,
      autoDeleteObjects: !params.isProd,
    });

    const logGroup = new logs.LogGroup(this, 'TrailLogGroup', {
      logGroupName: `/aws/cloudtrail/${params.projectName}-${params.envName}`,
      retention: logs.RetentionDays.THREE_MONTHS,
      removalPolicy: params.isProd ? RemovalPolicy.RETAIN : RemovalPolicy.DESTROY,
    });

    this.trail = new cloudtrail.Trail(this, 'Trail', {
      trailName: `${params.projectName}-${params.envName}-trail`,
      bucket: logBucket,
      sendToCloudWatchLogs: true,
      cloudWatchLogGroup: logGroup,
      includeGlobalServiceEvents: true,
      isMultiRegionTrail: false,
      enableFileValidation: true,
    });
  }
}
