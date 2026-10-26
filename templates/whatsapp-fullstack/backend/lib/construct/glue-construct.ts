import { Duration, Tags, RemovalPolicy } from 'aws-cdk-lib';
import * as glue from 'aws-cdk-lib/aws-glue';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as s3assets from 'aws-cdk-lib/aws-s3-assets';
import { LogGroup, RetentionDays } from 'aws-cdk-lib/aws-logs';
import { Construct } from 'constructs';

/**
 * Supported Glue job types
 */
export type GlueJobType = 'pythonshell' | 'glueetl' | 'gluestreaming';

/**
 * Supported Glue worker types for ETL/Streaming jobs
 */
export type GlueWorkerType = 'Standard' | 'G.1X' | 'G.2X' | 'G.025X' | 'Z.2X';

/**
 * Configuration for Glue job default arguments
 */
export interface GlueDefaultArguments {
  [key: string]: string;
}

/**
 * Configuration for Glue job connections
 */
export interface GlueConnectionConfig {
  connectionNames: string[];
}

/**
 * Configuration properties for the Glue construct
 */
export interface GlueConstructProps {
  /**
   * The name of the Glue job
   */
  jobName: string;

  /**
   * A description of the Glue job
   */
  description?: string;

  /**
   * The type of Glue job (default: 'pythonshell')
   */
  jobType?: GlueJobType;

  /**
   * Path to the local script file that will be uploaded to S3
   */
  scriptPath: string;

  /**
   * Python version for the job
   * Defaults by jobType: pythonshell → '3.9', glueetl/gluestreaming → '3.10'
   */
  pythonVersion?: string;

  /**
   * Glue version
   * Defaults by jobType: pythonshell → '3.0', glueetl/gluestreaming → '4.0'
   */
  glueVersion?: string;

  /**
   * Max capacity in DPUs for Python Shell jobs (default: 1)
   * For pythonshell: 0.0625 or 1
   * Not used when workerType and numberOfWorkers are set
   */
  maxCapacity?: number;

  /**
   * Worker type for ETL/Streaming jobs
   * When set, numberOfWorkers must also be provided
   */
  workerType?: GlueWorkerType;

  /**
   * Number of workers for ETL/Streaming jobs
   * When set, workerType must also be provided
   */
  numberOfWorkers?: number;

  /**
   * Job timeout in minutes (default: 240)
   */
  timeout?: number;

  /**
   * Maximum number of retries on failure (default: 1)
   */
  maxRetries?: number;

  /**
   * Default arguments passed to the Glue job
   */
  defaultArguments?: GlueDefaultArguments;

  /**
   * Custom IAM role (optional, one will be created if not provided)
   */
  customRole?: iam.Role;

  /**
   * Additional IAM policy statements for the job role
   */
  additionalPolicies?: iam.PolicyStatement[];

  /**
   * Connections configuration
   */
  connections?: GlueConnectionConfig;

  /**
   * Extra Python files (S3 paths) to include
   */
  extraPyFiles?: string[];

  /**
   * Extra JAR files (S3 paths) to include
   */
  extraJarsFiles?: string[];

  /**
   * Enable CloudWatch metrics (default: true)
   */
  enableMetrics?: boolean;

  /**
   * Enable continuous CloudWatch logging (default: false)
   */
  enableContinuousLogging?: boolean;

  /**
   * Enable job bookmarks (default: false)
   */
  enableBookmarks?: boolean;

  /**
   * Log retention for CloudWatch logs (default: ONE_MONTH)
   */
  logRetention?: RetentionDays;

  /**
   * Whether this is a production environment (retains the log group on delete)
   */
  isProd?: boolean;

  /**
   * Additional tags to apply to resources
   */
  tags?: { [key: string]: string };
}

/**
 * Level 2 Glue Construct for creating and configuring AWS Glue jobs
 *
 * This construct provides a simplified interface for creating Glue jobs
 * (Python Shell, ETL, or Streaming) with common configurations and
 * best practices included.
 *
 * @example
 * ```typescript
 * const glueJob = new GlueConstruct(this, 'ProcessData', {
 *   jobName: 'my-project-process-data',
 *   scriptPath: 'src/glue/process_data.py',
 *   jobType: 'pythonshell',
 *   maxCapacity: 1,
 *   timeout: 240,
 *   defaultArguments: {
 *     '--TABLE_NAME': processesTable.tableName,
 *   },
 *   additionalPolicies: [
 *     new iam.PolicyStatement({
 *       actions: ['dynamodb:BatchWriteItem'],
 *       resources: [processesTable.tableArn],
 *     }),
 *   ],
 * });
 * ```
 */
export class GlueConstruct extends Construct {
  /**
   * The Glue CfnJob created by this construct
   */
  public readonly job: glue.CfnJob;

  /**
   * The IAM role used by the Glue job
   */
  public readonly role: iam.Role;

  /**
   * The S3 asset containing the uploaded script
   */
  public readonly scriptAsset: s3assets.Asset;

  /**
   * The name of the Glue job
   */
  public readonly jobName: string;

  /**
   * The CloudWatch log group for the job
   */
  public readonly logGroup: LogGroup;

  constructor(scope: Construct, id: string, props: GlueConstructProps) {
    super(scope, id);

    const {
      jobName,
      description = '',
      jobType = 'pythonshell',
      scriptPath,
      maxCapacity = 1,
      workerType,
      numberOfWorkers,
      timeout = 240,
      maxRetries = 1,
      defaultArguments = {},
      customRole,
      additionalPolicies = [],
      connections,
      extraPyFiles = [],
      extraJarsFiles = [],
      enableMetrics = true,
      enableContinuousLogging = false,
      enableBookmarks = false,
      logRetention = RetentionDays.ONE_MONTH,
      isProd = false,
      tags = {},
    } = props;

    const isShell = jobType === 'pythonshell';
    const pythonVersion = props.pythonVersion ?? (isShell ? '3.9' : '3.10');
    const glueVersion = props.glueVersion ?? (isShell ? '3.0' : '4.0');

    this.jobName = jobName;

    this.scriptAsset = new s3assets.Asset(this, 'Script', {
      path: scriptPath,
    });

    this.logGroup = new LogGroup(this, 'LogGroup', {
      logGroupName: `/aws/glue/jobs/${jobName}`,
      retention: logRetention,
      removalPolicy: isProd ? RemovalPolicy.RETAIN : RemovalPolicy.DESTROY,
    });

    this.role = customRole || this.createExecutionRole(jobName, additionalPolicies);

    this.scriptAsset.grantRead(this.role);

    const mergedDefaultArguments: GlueDefaultArguments = {
      '--enable-metrics': enableMetrics ? 'true' : 'false',
      '--enable-continuous-cloudwatch-log': enableContinuousLogging ? 'true' : 'false',
      '--job-bookmark-option': enableBookmarks ? 'job-bookmark-enable' : 'job-bookmark-disable',
      '--job-language': 'python',
      ...defaultArguments,
    };

    if (extraPyFiles.length > 0) {
      mergedDefaultArguments['--extra-py-files'] = extraPyFiles.join(',');
    }

    if (extraJarsFiles.length > 0) {
      mergedDefaultArguments['--extra-jars'] = extraJarsFiles.join(',');
    }

    const jobCommand: glue.CfnJob.JobCommandProperty = {
      name: jobType,
      ...(isShell && { pythonVersion }),
      scriptLocation: this.scriptAsset.s3ObjectUrl,
    };

    const jobProps: glue.CfnJobProps = {
      name: jobName,
      description,
      role: this.role.roleArn,
      command: jobCommand,
      defaultArguments: mergedDefaultArguments,
      maxRetries,
      timeout,
      glueVersion,
      ...(connections && {
        connections: { connections: connections.connectionNames },
      }),
    };

    if (workerType && numberOfWorkers) {
      (jobProps as any).workerType = workerType;
      (jobProps as any).numberOfWorkers = numberOfWorkers;
    } else {
      (jobProps as any).maxCapacity = maxCapacity;
    }

    this.job = new glue.CfnJob(this, 'Job', jobProps);

    this.applyTags(tags);
  }

  /**
   * Creates an execution role for the Glue job
   */
  private createExecutionRole(jobName: string, additionalPolicies: iam.PolicyStatement[]): iam.Role {
    const role = new iam.Role(this, 'ExecutionRole', {
      roleName: `${jobName}-role`,
      assumedBy: new iam.ServicePrincipal('glue.amazonaws.com'),
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSGlueServiceRole'),
      ],
    });

    if (additionalPolicies.length > 0) {
      const customPolicy = new iam.Policy(this, 'CustomPolicy', {
        policyName: `${jobName}-custom-policy`,
        statements: additionalPolicies,
      });
      role.attachInlinePolicy(customPolicy);
    }

    return role;
  }

  /**
   * Adds an IAM policy statement to the job's role
   */
  public addToRolePolicy(statement: iam.PolicyStatement): void {
    this.role.addToPolicy(statement);
  }

  /**
   * Grants S3 read access to a specific bucket/prefix
   */
  public grantS3Read(bucketArn: string, objectsPrefix: string = '*'): void {
    this.role.addToPolicy(new iam.PolicyStatement({
      actions: ['s3:GetObject'],
      resources: [`${bucketArn}/${objectsPrefix}`],
    }));
  }

  /**
   * Grants S3 write access to a specific bucket/prefix
   */
  public grantS3Write(bucketArn: string, objectsPrefix: string = '*'): void {
    this.role.addToPolicy(new iam.PolicyStatement({
      actions: ['s3:PutObject', 's3:DeleteObject'],
      resources: [`${bucketArn}/${objectsPrefix}`],
    }));
  }

  /**
   * Grants DynamoDB read/write access to a table
   */
  public grantDynamoDbReadWrite(tableArn: string): void {
    this.role.addToPolicy(new iam.PolicyStatement({
      actions: [
        'dynamodb:GetItem',
        'dynamodb:PutItem',
        'dynamodb:UpdateItem',
        'dynamodb:BatchWriteItem',
        'dynamodb:BatchGetItem',
        'dynamodb:Query',
        'dynamodb:Scan',
      ],
      resources: [tableArn, `${tableArn}/index/*`],
    }));
  }

  /**
   * Grants DynamoDB write-only access to a table
   */
  public grantDynamoDbWrite(tableArn: string): void {
    this.role.addToPolicy(new iam.PolicyStatement({
      actions: ['dynamodb:PutItem', 'dynamodb:BatchWriteItem'],
      resources: [tableArn, `${tableArn}/index/*`],
    }));
  }

  /**
   * Applies tags to the resources
   */
  private applyTags(tags: { [key: string]: string }): void {
    Object.entries(tags).forEach(([key, value]) => {
      Tags.of(this).add(key, value);
    });
  }

}
