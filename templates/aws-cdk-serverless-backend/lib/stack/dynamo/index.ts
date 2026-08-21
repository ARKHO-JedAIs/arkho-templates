import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import { CfnOutput } from 'aws-cdk-lib';
import { Construct } from 'constructs';
import { DynamoConstruct } from '../../construct/dynamo-construct';
import { ParamsConfig } from '../shared/util/env-config';

export interface DynamoFactoryProps {
  params: ParamsConfig;
}

/**
 * Centralized factory for the DynamoDB resources that back arkho-cli.
 *
 * Ships with a single single-table-design table (PK/SK) that stores arkho-cli
 * usage statistics. Installer telemetry and CLI command telemetry are tracked
 * separately by partitioning on PK (e.g. `INSTALL#<version>` vs
 * `USAGE#<command>`). No TTL is configured, so nothing is deleted
 * automatically; all events are retained.
 * Additional tables are added here by reusing DynamoConstruct.
 */
export class DynamoFactory extends Construct {
  public readonly usageStatsTable: DynamoConstruct;

  constructor(scope: Construct, id: string, props: DynamoFactoryProps) {
    super(scope, id);

    const { params } = props;
    const { envName, projectName } = params;

    this.usageStatsTable = new DynamoConstruct(this, 'UsageStatsTable', {
      params,
      tableConfig: {
        tableName: `${projectName}-${envName}-usage-stats`,
        partitionKey: {
          name: 'PK',
          type: dynamodb.AttributeType.STRING,
        },
        sortKey: {
          name: 'SK',
          type: dynamodb.AttributeType.STRING,
        },
        billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      },
    });

    new CfnOutput(this, 'UsageStatsTableName', {
      value: this.usageStatsTable.tableName,
      description: 'arkho-cli usage statistics DynamoDB table name',
      exportName: `${projectName}-${envName}-UsageStatsTableName`,
    });
  }
}
