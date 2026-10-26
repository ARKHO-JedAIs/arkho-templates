import { Duration, Tags, RemovalPolicy } from 'aws-cdk-lib';
import { Function, Runtime, Code, Architecture, Tracing, LoggingFormat, ILayerVersion } from 'aws-cdk-lib/aws-lambda';
import { Role, Policy, PolicyStatement, ServicePrincipal, IPrincipal, ManagedPolicy } from 'aws-cdk-lib/aws-iam';
import { LogGroup, RetentionDays } from 'aws-cdk-lib/aws-logs';
import { Topic } from 'aws-cdk-lib/aws-sns';
import { LambdaSubscription, SqsSubscription } from 'aws-cdk-lib/aws-sns-subscriptions';
import { Rule, Schedule } from 'aws-cdk-lib/aws-events';
import { LambdaFunction } from 'aws-cdk-lib/aws-events-targets';
import { Queue, IQueue } from 'aws-cdk-lib/aws-sqs';
import { IVpc, ISecurityGroup, SubnetSelection } from 'aws-cdk-lib/aws-ec2';
import { Construct } from 'constructs';

/**
 * Configuration properties for the Lambda construct
 */
export interface LambdaConstructProps {
  /**
   * The name of the Lambda function
   */
  functionName: string;

  /**
   * A description of the function
   */
  description?: string;

  /**
   * The runtime for the function (default: PYTHON_3_12)
   */
  runtime?: Runtime;

  /**
   * The source code of the function
   */
  code: Code;

  /**
   * The function handler (e.g., 'index.handler')
   */
  handler: string;

  /**
   * The function timeout in seconds (default: 30 seconds)
   */
  timeout?: Duration;

  /**
   * The amount of memory in MB (default: 128 MB)
   */
  memorySize?: number;

  /**
   * The instruction set architecture (default: X86_64)
   */
  architecture?: Architecture;

  /**
   * Environment variables for the function
   */
  environment?: { [key: string]: string };

  /**
   * Lambda layers to add to the function
   */
  layers?: ILayerVersion[];

  /**
   * VPC configuration for the function
   */
  vpc?: {
    vpc: IVpc;
    subnets?: SubnetSelection;
    securityGroups?: ISecurityGroup[];
  };

  /**
   * Logging configuration
   */
  logging?: {
    logRetention?: RetentionDays;
    loggingFormat?: LoggingFormat;
    removalPolicy?: RemovalPolicy;
  };

  /**
   * Tracing configuration
   */
  tracing?: Tracing;

  /**
   * Dead Letter Queue configuration
   */
  deadLetterQueue?: {
    enabled: boolean;
    queue?: IQueue;
    topic?: Topic;
  };

  /**
   * Reserved concurrent executions limit
   */
  reservedConcurrentExecutions?: number;

  /**
   * Additional IAM policy statements
   */
  additionalPolicies?: PolicyStatement[];

  /**
   * Custom IAM role (optional)
   */
  customRole?: Role;

  /**
   * Event trigger configurations
   */
  triggers?: {
    schedule?: {
      expression: string;
      enabled?: boolean;
      input?: any;
    };
    sns?: Topic[];
    sqs?: IQueue[];
  };

  /**
   * Additional tags to apply to resources
   */
  tags?: { [key: string]: string };
}

/**
 * Generic L2 construct for Lambda functions
 * 
 * This construct provides a simplified interface for creating Lambda functions
 * with common configurations and best practices included.
 * 
 * @example
 * ```typescript
 * const lambdaFunction = new LambdaConstruct(this, 'MyLambda', {
 *   functionName: 'my-function',
 *   description: 'My Lambda function',
 *   code: Code.fromAsset('lambda/my-function'),
 *   handler: 'index.handler',
 *   runtime: Runtime.PYTHON_3_12,
 *   timeout: Duration.minutes(5),
 *   memorySize: 256,
 *   environment: {
 *     TABLE_NAME: dynamoTable.tableName
 *   },
 *   additionalPolicies: [
 *     new PolicyStatement({
 *       effect: Effect.ALLOW,
 *       actions: ['dynamodb:GetItem', 'dynamodb:PutItem'],
 *       resources: [dynamoTable.tableArn]
 *     })
 *   ],
 *   triggers: {
 *     schedule: {
 *       expression: 'rate(5 minutes)',
 *       enabled: true
 *     }
 *   }
 * });
 * ```
 */
export class LambdaConstruct extends Construct {
  /**
   * The Lambda function created by this construct
   */
  public readonly function: Function;

  /**
   * The IAM role of the function
   */
  public readonly role: Role;

  /**
   * The CloudWatch log group for the function
   */
  public readonly logGroup: LogGroup;

  constructor(scope: Construct, id: string, props: LambdaConstructProps) {
    super(scope, id);

    // Default configuration
    const {
      functionName,
      description = '',
      runtime = Runtime.PYTHON_3_12,
      code,
      handler,
      timeout = Duration.seconds(30),
      memorySize = 128,
      architecture = Architecture.X86_64,
      environment = {},
      layers = [],
      vpc,
      logging = {},
      tracing = Tracing.DISABLED,
      deadLetterQueue,
      reservedConcurrentExecutions,
      additionalPolicies = [],
      customRole,
      triggers = {},
      tags = {}
    } = props;

    // Create log group
    this.logGroup = new LogGroup(this, 'LogGroup', {
      logGroupName: `/aws/lambda/${functionName}`,
      retention: logging.logRetention || RetentionDays.ONE_MONTH,
      removalPolicy: logging.removalPolicy || RemovalPolicy.DESTROY,
    });

    // Create or use IAM role
    this.role = customRole || this.createExecutionRole(functionName, additionalPolicies);

    // Configure Dead Letter Queue if enabled
    let deadLetterQueueConfig;
    if (deadLetterQueue?.enabled) {
      if (deadLetterQueue.queue) {
        deadLetterQueueConfig = deadLetterQueue.queue;
      } else if (deadLetterQueue.topic) {
        // Create an SQS queue for DLQ from SNS topic
        deadLetterQueueConfig = this.createDeadLetterQueue(deadLetterQueue.topic);
      } else {
        deadLetterQueueConfig = this.createDeadLetterQueue();
      }
    }

    // Create Lambda function
    this.function = new Function(this, 'Function', {
      functionName,
      description,
      runtime,
      code,
      handler,
      timeout,
      memorySize,
      architecture,
      environment,
      layers,
      role: this.role,
      tracing,
      logGroup: this.logGroup,
      loggingFormat: logging.loggingFormat || LoggingFormat.TEXT,
      deadLetterQueue: deadLetterQueueConfig,
      reservedConcurrentExecutions,
      // VPC configuration if provided
      ...(vpc && {
        vpc: vpc.vpc,
        vpcSubnets: vpc.subnets,
        securityGroups: vpc.securityGroups
      })
    });

    // Configure triggers
    this.setupTriggers(triggers);

    // Apply tags
    this.applyTags(tags);
  }

  /**
   * Creates an execution role for the Lambda function
   */
  private createExecutionRole(functionName: string, additionalPolicies: PolicyStatement[]): Role {
    const role = new Role(this, 'ExecutionRole', {
      roleName: `${functionName}-role`,
      assumedBy: new ServicePrincipal('lambda.amazonaws.com'),
      managedPolicies: [
        ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSLambdaBasicExecutionRole')
      ]
    });

    // Add additional policies
    if (additionalPolicies.length > 0) {
      const customPolicy = new Policy(this, 'CustomPolicy', {
        policyName: `${functionName}-custom-policy`,
        statements: additionalPolicies
      });
      role.attachInlinePolicy(customPolicy);
    }

    return role;
  }

  /**
   * Creates an SQS queue for Dead Letter Queue
   */
  private createDeadLetterQueue(topic?: Topic): Queue {
    const queue = new Queue(this, 'DeadLetterQueue', {
      queueName: `${this.node.id}-dlq`
    });

    // If a topic is provided, subscribe the queue to it
    if (topic) {
      topic.addSubscription(new SqsSubscription(queue));
    }

    return queue;
  }

  /**
   * Configures triggers for the Lambda function
   */
  private setupTriggers(triggers: LambdaConstructProps['triggers']) {
    // Schedule trigger (EventBridge)
    if (triggers?.schedule) {
      const rule = new Rule(this, 'ScheduleRule', {
        schedule: Schedule.expression(triggers.schedule.expression),
        enabled: triggers.schedule.enabled !== false
      });

      rule.addTarget(new LambdaFunction(this.function, {
        event: triggers.schedule.input
      }));
    }

    // SNS triggers
    if (triggers?.sns) {
      triggers.sns.forEach((topic, index) => {
        topic.addSubscription(new LambdaSubscription(this.function));

        // Grant permission for the topic to invoke the function
        this.function.addPermission(`SnsInvokePermission${index}`, {
          principal: new ServicePrincipal('sns.amazonaws.com'),
          sourceArn: topic.topicArn
        });
      });
    }

    // SQS triggers (if needed in the future)
    if (triggers?.sqs) {
      // Implement SQS triggers here
      triggers.sqs.forEach((queue, index) => {
        // Add SQS event source mapping
        // this.function.addEventSourceMapping(`SqsEventSource${index}`, {
        //   eventSourceArn: queue.queueArn
        // });
      });
    }
  }

  /**
   * Applies tags to the resources
   */
  private applyTags(tags: { [key: string]: string }) {
    Object.entries(tags).forEach(([key, value]) => {
      Tags.of(this).add(key, value);
    });
  }

  /**
   * Adds an additional IAM policy statement to the function's role
   */
  public addToRolePolicy(statement: PolicyStatement): void {
    this.role.addToPolicy(statement);
  }

  /**
   * Grants invoke permissions for a service to call this function
   */
  public grantInvoke(principal: IPrincipal, sourceArn?: string): void {
    this.function.addPermission('InvokePermission', {
      principal,
      sourceArn
    });
  }

  /**
   * Gets the ARN of the function
   */
  public get functionArn(): string {
    return this.function.functionArn;
  }

  /**
   * Gets the name of the function
   */
  public get functionName(): string {
    return this.function.functionName;
  }

}
