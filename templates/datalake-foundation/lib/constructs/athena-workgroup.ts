import * as athena from 'aws-cdk-lib/aws-athena';
import * as s3 from 'aws-cdk-lib/aws-s3';
import { Construct } from 'constructs';

interface AthenaWorkgroupProps {
  projectName: string;
  environment: string;
  analyticsBucket: s3.IBucket;
}

export class AthenaWorkgroup extends Construct {
  public readonly workgroupName: string;

  constructor(scope: Construct, id: string, props: AthenaWorkgroupProps) {
    super(scope, id);

    const { projectName, environment, analyticsBucket } = props;
    this.workgroupName = `${projectName}-${environment}-wg`;

    new athena.CfnWorkGroup(this, 'Workgroup', {
      name: this.workgroupName,
      description: `Athena workgroup para ${projectName} (${environment})`,
      state: 'ENABLED',
      workGroupConfiguration: {
        resultConfiguration: {
          outputLocation: `s3://${analyticsBucket.bucketName}/athena-results/`,
          encryptionConfiguration: {
            encryptionOption: 'SSE_S3',
          },
        },
        enforceWorkGroupConfiguration: true,
        publishCloudWatchMetricsEnabled: true,
        // Corte de seguridad: 1 GB por query
        bytesScannedCutoffPerQuery: 1_000_000_000,
      },
    });
  }
}
