import { Construct } from 'constructs';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import { RemovalPolicy } from 'aws-cdk-lib';
import { ParamsConfig } from '../stack/shared/util/env-config';

/**
 * Interface for Global Secondary Index configuration
 */
export interface DynamoGSIConfig {
  indexName: string;
  partitionKey: {
    name: string;
    type: dynamodb.AttributeType;
  };
  sortKey?: {
    name: string;
    type: dynamodb.AttributeType;
  };
  projectionType?: dynamodb.ProjectionType;
  nonKeyAttributes?: string[];
  readCapacity?: number;
  writeCapacity?: number;
}

/**
 * Interface for Local Secondary Index configuration
 */
export interface DynamoLSIConfig {
  indexName: string;
  sortKey: {
    name: string;
    type: dynamodb.AttributeType;
  };
  projectionType?: dynamodb.ProjectionType;
  nonKeyAttributes?: string[];
}

/**
 * Interface for DynamoDB table configuration
 */
export interface DynamoTableConfig {
  tableName: string;
  partitionKey: {
    name: string;
    type: dynamodb.AttributeType;
  };
  sortKey?: {
    name: string;
    type: dynamodb.AttributeType;
  };
  billingMode?: dynamodb.BillingMode;
  readCapacity?: number;
  writeCapacity?: number;
  globalSecondaryIndexes?: DynamoGSIConfig[];
  localSecondaryIndexes?: DynamoLSIConfig[];
  streamSpecification?: dynamodb.StreamViewType;
  timeToLiveAttribute?: string;
  pointInTimeRecoverySpecification?: {
    pointInTimeRecoveryEnabled: boolean;
  };
  deletionProtection?: boolean;
}

/**
 * Interface for DynamoDB construct properties
 */
export interface DynamoConstructProps {
  params: ParamsConfig;
  tableConfig: DynamoTableConfig;
}

/**
 * Simple DynamoDB Construct for creating a single DynamoDB table
 */
export class DynamoConstruct extends Construct {
  public readonly table: dynamodb.Table;
  public readonly tableArn: string;
  public readonly tableName: string;

  constructor(scope: Construct, id: string, props: DynamoConstructProps) {
    super(scope, id);

    const { params, tableConfig } = props;

    // Create table
    this.table = new dynamodb.Table(this, tableConfig.tableName, {
      tableName: tableConfig.tableName,
      partitionKey: {
        name: tableConfig.partitionKey.name,
        type: tableConfig.partitionKey.type,
      },
      sortKey: tableConfig.sortKey ? {
        name: tableConfig.sortKey.name,
        type: tableConfig.sortKey.type,
      } : undefined,
      billingMode: tableConfig.billingMode || dynamodb.BillingMode.PAY_PER_REQUEST,
      readCapacity: tableConfig.billingMode === dynamodb.BillingMode.PROVISIONED ? 
        (tableConfig.readCapacity || 5) : undefined,
      writeCapacity: tableConfig.billingMode === dynamodb.BillingMode.PROVISIONED ? 
        (tableConfig.writeCapacity || 5) : undefined,
      stream: tableConfig.streamSpecification,
      timeToLiveAttribute: tableConfig.timeToLiveAttribute,
      pointInTimeRecoverySpecification: tableConfig.pointInTimeRecoverySpecification ?? {
        pointInTimeRecoveryEnabled: params.isProd
      },
      deletionProtection: tableConfig.deletionProtection ?? params.isProd,
      removalPolicy: params.isProd ? RemovalPolicy.RETAIN : RemovalPolicy.DESTROY,
    });

    // Add Global Secondary Indexes
    tableConfig.globalSecondaryIndexes?.forEach(gsiConfig => {
      this.table.addGlobalSecondaryIndex({
        indexName: gsiConfig.indexName,
        partitionKey: {
          name: gsiConfig.partitionKey.name,
          type: gsiConfig.partitionKey.type,
        },
        sortKey: gsiConfig.sortKey ? {
          name: gsiConfig.sortKey.name,
          type: gsiConfig.sortKey.type,
        } : undefined,
        projectionType: gsiConfig.projectionType || dynamodb.ProjectionType.ALL,
        nonKeyAttributes: gsiConfig.nonKeyAttributes,
        readCapacity: tableConfig.billingMode === dynamodb.BillingMode.PROVISIONED ? 
          (gsiConfig.readCapacity || 5) : undefined,
        writeCapacity: tableConfig.billingMode === dynamodb.BillingMode.PROVISIONED ? 
          (gsiConfig.writeCapacity || 5) : undefined,
      });
    });

    // Add Local Secondary Indexes
    tableConfig.localSecondaryIndexes?.forEach(lsiConfig => {
      this.table.addLocalSecondaryIndex({
        indexName: lsiConfig.indexName,
        sortKey: {
          name: lsiConfig.sortKey.name,
          type: lsiConfig.sortKey.type,
        },
        projectionType: lsiConfig.projectionType || dynamodb.ProjectionType.ALL,
        nonKeyAttributes: lsiConfig.nonKeyAttributes,
      });
    });

    // Store references
    this.tableArn = this.table.tableArn;
    this.tableName = this.table.tableName;
  }
}