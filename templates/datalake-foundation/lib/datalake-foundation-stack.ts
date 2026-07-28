import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import { StorageZones } from './constructs/storage-zones';
import { GlueCatalog } from './constructs/glue-catalog';
import { AthenaWorkgroup } from './constructs/athena-workgroup';
import { LakeFormation } from './constructs/lake-formation';
import { VpcNetwork } from './constructs/vpc-network';

export class DatalakeFoundationStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    const projectName = this.node.tryGetContext('projectName') as string;
    const environment = this.node.tryGetContext('environment') as string;
    const bucketPrefix = this.node.tryGetContext('bucketPrefix') as string;
    const rawRetentionDays = parseInt(this.node.tryGetContext('rawRetentionDays') ?? '90', 10);
    const archiveRetentionYears = parseInt(this.node.tryGetContext('archiveRetentionYears') ?? '7', 10);

    const enableGlue = this.node.tryGetContext('enableGlueDataCatalog') === 'true';
    const enableAthena = this.node.tryGetContext('enableAthena') === 'true';
    const enableLakeFormation = this.node.tryGetContext('enableLakeFormation') === 'true';
    const enableVpc = this.node.tryGetContext('enableVpc') === 'true';
    const vpcCidr = (this.node.tryGetContext('vpcCidr') as string | undefined) ?? '10.0.0.0/16';

    const vpc = enableVpc
      ? new VpcNetwork(this, 'VpcNetwork', { vpcCidr })
      : undefined;

    const storage = new StorageZones(this, 'StorageZones', {
      projectName,
      environment,
      bucketPrefix,
      rawRetentionDays,
      archiveRetentionYears,
    });

    const glue = enableGlue
      ? new GlueCatalog(this, 'GlueCatalog', {
          projectName,
          environment,
          rawBucket: storage.rawBucket,
          curatedBucket: storage.curatedBucket,
          analyticsBucket: storage.analyticsBucket,
        })
      : undefined;

    const athena = enableAthena
      ? new AthenaWorkgroup(this, 'AthenaWorkgroup', {
          projectName,
          environment,
          analyticsBucket: storage.analyticsBucket,
        })
      : undefined;

    if (enableLakeFormation && glue) {
      new LakeFormation(this, 'LakeFormation', {
        projectName,
        rawBucket: storage.rawBucket,
        curatedBucket: storage.curatedBucket,
        analyticsBucket: storage.analyticsBucket,
        glueDatabaseNames: glue.databaseNames,
      });
    }

    // ── Outputs ──────────────────────────────────────────────────────────────
    new cdk.CfnOutput(this, 'RawBucketName', {
      value: storage.rawBucket.bucketName,
      description: 'Zona raw (landing)',
    });
    new cdk.CfnOutput(this, 'CuratedBucketName', {
      value: storage.curatedBucket.bucketName,
      description: 'Zona curated (silver)',
    });
    new cdk.CfnOutput(this, 'AnalyticsBucketName', {
      value: storage.analyticsBucket.bucketName,
      description: 'Zona analytics (gold)',
    });
    new cdk.CfnOutput(this, 'ArchiveBucketName', {
      value: storage.archiveBucket.bucketName,
      description: 'Zona archive (Glacier)',
    });

    if (glue) {
      new cdk.CfnOutput(this, 'GlueRawDatabase', { value: glue.databaseNames.raw });
      new cdk.CfnOutput(this, 'GlueCuratedDatabase', { value: glue.databaseNames.curated });
      new cdk.CfnOutput(this, 'GlueAnalyticsDatabase', { value: glue.databaseNames.analytics });
    }

    if (athena) {
      new cdk.CfnOutput(this, 'AthenaWorkgroupName', { value: athena.workgroupName });
    }

    if (vpc) {
      new cdk.CfnOutput(this, 'VpcId', { value: vpc.vpc.vpcId });
    }
  }
}
