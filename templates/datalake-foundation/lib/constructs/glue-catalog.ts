import * as cdk from 'aws-cdk-lib';
import * as glue from 'aws-cdk-lib/aws-glue';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as s3 from 'aws-cdk-lib/aws-s3';
import { Construct } from 'constructs';

export interface GlueDatabaseNames {
  raw: string;
  curated: string;
  analytics: string;
}

interface GlueCatalogProps {
  projectName: string;
  environment: string;
  rawBucket: s3.IBucket;
  curatedBucket: s3.IBucket;
  analyticsBucket: s3.IBucket;
}

export class GlueCatalog extends Construct {
  public readonly databaseNames: GlueDatabaseNames;

  constructor(scope: Construct, id: string, props: GlueCatalogProps) {
    super(scope, id);

    const { projectName, environment, rawBucket, curatedBucket, analyticsBucket } = props;
    const account = cdk.Stack.of(this).account;
    const prefix = `${projectName}_${environment}`;

    this.databaseNames = {
      raw: `${prefix}_raw`,
      curated: `${prefix}_curated`,
      analytics: `${prefix}_analytics`,
    };

    const zones: [string, string, s3.IBucket][] = [
      [this.databaseNames.raw, 'Zona raw (landing)', rawBucket],
      [this.databaseNames.curated, 'Zona curated (silver)', curatedBucket],
      [this.databaseNames.analytics, 'Zona analytics (gold)', analyticsBucket],
    ];

    for (const [dbName, description] of zones) {
      new glue.CfnDatabase(this, `${dbName}Database`, {
        catalogId: account,
        databaseInput: {
          name: dbName,
          description: `${description} — ${projectName} (${environment})`,
        },
      });
    }

    const crawlerRole = new iam.Role(this, 'CrawlerRole', {
      assumedBy: new iam.ServicePrincipal('glue.amazonaws.com'),
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSGlueServiceRole'),
      ],
    });

    [rawBucket, curatedBucket, analyticsBucket].forEach(b => b.grantRead(crawlerRole));

    // Crawler daily en raw; curated y analytics se actualiza vía job ETL
    new glue.CfnCrawler(this, 'RawCrawler', {
      name: `${prefix}-raw-crawler`,
      role: crawlerRole.roleArn,
      databaseName: this.databaseNames.raw,
      targets: {
        s3Targets: [{ path: `s3://${rawBucket.bucketName}/` }],
      },
      schedule: { scheduleExpression: 'cron(0 6 * * ? *)' },
      schemaChangePolicy: {
        updateBehavior: 'UPDATE_IN_DATABASE',
        deleteBehavior: 'LOG',
      },
    });
  }
}
