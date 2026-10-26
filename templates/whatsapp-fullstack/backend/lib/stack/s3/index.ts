import { CfnOutput } from 'aws-cdk-lib';
import * as s3 from 'aws-cdk-lib/aws-s3';
import { Construct } from 'constructs';
import { S3Construct } from '../../construct/s3-construct';
import { ParamsConfig } from '../shared/util/env-config';

export interface S3FactoryProps {
  params: ParamsConfig;
}

/**
 * Centralized factory for the S3 resources that back arkho-cli.
 *
 * Provisions the templates bucket consumed by the presigned-url-template Lambda.
 * It stores the project templates the CLI scaffolds from (e.g. reactjs). The
 * bucket is private and SSE-S3 encrypted; uploads land under the `templates/`
 * prefix.
 */
export class S3Factory extends Construct {
  public readonly templateBucket: S3Construct;

  constructor(scope: Construct, id: string, props: S3FactoryProps) {
    super(scope, id);

    const { params } = props;
    const { envName, projectName } = params;

    this.templateBucket = new S3Construct(this, 'TemplateBucket', {
      params,
      bucketConfig: {
        bucketName: `${projectName}-${envName}-templates`,
        encryption: { type: 's3Managed' },
        enforceSSL: true,
        blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      },
    });

    new CfnOutput(this, 'TemplateBucketName', {
      value: this.templateBucket.bucketName,
      description: 'arkho-cli templates S3 bucket name',
      exportName: `${projectName}-${envName}-TemplateBucketName`,
    });
  }
}
