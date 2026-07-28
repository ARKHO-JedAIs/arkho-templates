import * as iam from 'aws-cdk-lib/aws-iam';
import * as lf from 'aws-cdk-lib/aws-lakeformation';
import * as s3 from 'aws-cdk-lib/aws-s3';
import { Construct } from 'constructs';
import { GlueDatabaseNames } from './glue-catalog';

interface LakeFormationProps {
  projectName: string;
  rawBucket: s3.IBucket;
  curatedBucket: s3.IBucket;
  analyticsBucket: s3.IBucket;
  glueDatabaseNames: GlueDatabaseNames;
}

export class LakeFormation extends Construct {
  constructor(scope: Construct, id: string, props: LakeFormationProps) {
    super(scope, id);

    const { projectName, rawBucket, curatedBucket, analyticsBucket } = props;

    const lfRole = new iam.Role(this, 'LakeFormationServiceRole', {
      assumedBy: new iam.ServicePrincipal('lakeformation.amazonaws.com'),
      description: `Lake Formation service role — ${projectName}`,
    });

    const buckets: { bucket: s3.IBucket; id: string }[] = [
      { bucket: rawBucket, id: 'RawLFResource' },
      { bucket: curatedBucket, id: 'CuratedLFResource' },
      { bucket: analyticsBucket, id: 'AnalyticsLFResource' },
    ];

    for (const { bucket, id } of buckets) {
      bucket.grantReadWrite(lfRole);

      new lf.CfnResource(this, id, {
        resourceArn: bucket.bucketArn,
        useServiceLinkedRole: false,
        roleArn: lfRole.roleArn,
      });
    }
  }
}
