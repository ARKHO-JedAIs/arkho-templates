import { Construct } from 'constructs';
import * as sns from 'aws-cdk-lib/aws-sns';
import * as subscriptions from 'aws-cdk-lib/aws-sns-subscriptions';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as kms from 'aws-cdk-lib/aws-kms';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as sqs from 'aws-cdk-lib/aws-sqs';
import { Tags } from 'aws-cdk-lib';
import { ParamsConfig } from '../stack/shared/util/env-config';

/**
 * Interface for SNS delivery status logging configuration
 */
export interface SnsLoggingConfig {
  protocol: sns.LoggingProtocol;
  successFeedbackRole?: iam.IRole;
  failureFeedbackRole?: iam.IRole;
  successFeedbackSampleRate?: number;
}

/**
 * Interface for a raw SNS subscription configuration
 */
export interface SnsSubscriptionConfig {
  id: string;
  protocol: sns.SubscriptionProtocol;
  endpoint: string;
  rawMessageDelivery?: boolean;
  filterPolicy?: { [attribute: string]: sns.SubscriptionFilter };
  filterPolicyWithMessageBody?: { [attribute: string]: sns.FilterOrPolicy };
  deadLetterQueue?: sqs.IQueue;
  region?: string;
  subscriptionRoleArn?: string;
  deliveryPolicy?: sns.DeliveryPolicy;
}

/**
 * Interface for SNS topic configuration
 */
export interface SnsTopicConfig {
  topicName: string;
  displayName?: string;
  fifo?: boolean;
  contentBasedDeduplication?: boolean;
  fifoThroughputScope?: sns.FifoThroughputScope;
  messageRetentionPeriodInDays?: number;
  masterKey?: kms.IKey;
  enforceSSL?: boolean;
  signatureVersion?: string;
  tracingConfig?: sns.TracingConfig;
  loggingConfigs?: SnsLoggingConfig[];
  subscriptions?: SnsSubscriptionConfig[];
}

/**
 * Interface for SNS construct properties
 */
export interface SnsConstructProps {
  params: ParamsConfig;
  topicConfig: SnsTopicConfig;
  additionalTags?: { [key: string]: string };
}

/**
 * Level 2 SNS Construct for creating and configuring SNS topics
 *
 * This construct provides a single interface for creating standard and FIFO
 * topics with encryption, transit encryption enforcement, delivery status
 * logging, active tracing, and subscriptions.
 *
 * @example
 * ```typescript
 * const snsTopic = new SnsConstruct(this, 'MySnsTopic', {
 *   params: config.params,
 *   topicConfig: {
 *     topicName: 'my-app-events',
 *     displayName: 'My App Events',
 *     enforceSSL: true,
 *     tracingConfig: sns.TracingConfig.ACTIVE,
 *     subscriptions: [{
 *       id: 'OpsEmail',
 *       protocol: sns.SubscriptionProtocol.EMAIL,
 *       endpoint: 'ops@example.com'
 *     }]
 *   }
 * });
 * ```
 */
export class SnsConstruct extends Construct {
  /**
   * The SNS topic created by this construct
   */
  public readonly topic: sns.Topic;

  /**
   * The ARN of the topic
   */
  public readonly topicArn: string;

  /**
   * The name of the topic
   */
  public readonly topicName: string;

  constructor(scope: Construct, id: string, props: SnsConstructProps) {
    super(scope, id);

    const { params, topicConfig, additionalTags = {} } = props;

    this.validateTopicConfig(topicConfig);

    // Configure delivery status logging
    const loggingConfigs: sns.LoggingConfig[] | undefined = topicConfig.loggingConfigs?.map(
      (loggingConfig) => ({
        protocol: loggingConfig.protocol,
        successFeedbackRole: loggingConfig.successFeedbackRole,
        failureFeedbackRole: loggingConfig.failureFeedbackRole,
        successFeedbackSampleRate: loggingConfig.successFeedbackSampleRate,
      })
    );

    // Create the SNS topic
    this.topic = new sns.Topic(this, 'Topic', {
      topicName: topicConfig.topicName,
      displayName: topicConfig.displayName,
      fifo: topicConfig.fifo ?? false,
      contentBasedDeduplication: topicConfig.contentBasedDeduplication,
      fifoThroughputScope: topicConfig.fifoThroughputScope,
      messageRetentionPeriodInDays: topicConfig.messageRetentionPeriodInDays,
      masterKey: topicConfig.masterKey,
      enforceSSL: topicConfig.enforceSSL ?? params.isProd,
      signatureVersion: topicConfig.signatureVersion,
      tracingConfig: topicConfig.tracingConfig,
      loggingConfigs,
    });

    // Configure subscriptions
    topicConfig.subscriptions?.forEach((subscriptionConfig) => {
      new sns.Subscription(this, subscriptionConfig.id, {
        topic: this.topic,
        protocol: subscriptionConfig.protocol,
        endpoint: subscriptionConfig.endpoint,
        rawMessageDelivery: subscriptionConfig.rawMessageDelivery,
        filterPolicy: subscriptionConfig.filterPolicy,
        filterPolicyWithMessageBody: subscriptionConfig.filterPolicyWithMessageBody,
        deadLetterQueue: subscriptionConfig.deadLetterQueue,
        region: subscriptionConfig.region,
        subscriptionRoleArn: subscriptionConfig.subscriptionRoleArn,
        deliveryPolicy: subscriptionConfig.deliveryPolicy,
      });
    });

    // Store references
    this.topicArn = this.topic.topicArn;
    this.topicName = this.topic.topicName;

    // Apply tags
    this.applyTags(additionalTags);
  }

  /**
   * Grants publish permissions to a principal
   */
  public grantPublish(identity: iam.IGrantable): iam.Grant {
    return this.topic.grantPublish(identity);
  }

  /**
   * Grants subscribe permissions to a principal
   */
  public grantSubscribe(identity: iam.IGrantable): iam.Grant {
    return this.topic.grantSubscribe(identity);
  }

  /**
   * Adds a topic policy statement
   */
  public addToResourcePolicy(statement: iam.PolicyStatement): iam.AddToResourcePolicyResult {
    return this.topic.addToResourcePolicy(statement);
  }

  /**
   * Adds a subscription to the topic
   */
  public addSubscription(subscription: sns.ITopicSubscription): sns.Subscription {
    return this.topic.addSubscription(subscription);
  }

  /**
   * Subscribes a Lambda function to the topic
   */
  public addLambdaSubscription(
    fn: lambda.IFunction,
    props?: subscriptions.LambdaSubscriptionProps
  ): sns.Subscription {
    return this.topic.addSubscription(new subscriptions.LambdaSubscription(fn, props));
  }

  /**
   * Subscribes an SQS queue to the topic
   */
  public addSqsSubscription(
    queue: sqs.IQueue,
    props?: subscriptions.SqsSubscriptionProps
  ): sns.Subscription {
    return this.topic.addSubscription(new subscriptions.SqsSubscription(queue, props));
  }

  /**
   * Subscribes an email address to the topic
   */
  public addEmailSubscription(
    email: string,
    props?: subscriptions.EmailSubscriptionProps
  ): sns.Subscription {
    return this.topic.addSubscription(new subscriptions.EmailSubscription(email, props));
  }

  /**
   * Subscribes an HTTP/HTTPS endpoint to the topic
   */
  public addUrlSubscription(
    url: string,
    props?: subscriptions.UrlSubscriptionProps
  ): sns.Subscription {
    return this.topic.addSubscription(new subscriptions.UrlSubscription(url, props));
  }

  /**
   * Validates the topic configuration before the topic is created
   */
  private validateTopicConfig(topicConfig: SnsTopicConfig): void {
    const isFifo = topicConfig.fifo ?? false;
    const hasFifoSuffix = topicConfig.topicName.endsWith('.fifo');

    // CloudFormation rejects the stack at deploy time when the suffix and the
    // fifo flag disagree, so fail at synth instead.
    if (isFifo && !hasFifoSuffix) {
      throw new Error(
        `SNS topic '${topicConfig.topicName}' is a FIFO topic and its name must end with '.fifo'`
      );
    }

    if (!isFifo && hasFifoSuffix) {
      throw new Error(
        `SNS topic '${topicConfig.topicName}' ends with '.fifo' but 'fifo' is not enabled`
      );
    }

    if (!isFifo && topicConfig.contentBasedDeduplication) {
      throw new Error(
        `SNS topic '${topicConfig.topicName}': 'contentBasedDeduplication' requires a FIFO topic`
      );
    }

    if (!isFifo && topicConfig.fifoThroughputScope) {
      throw new Error(
        `SNS topic '${topicConfig.topicName}': 'fifoThroughputScope' requires a FIFO topic`
      );
    }

    if (!isFifo && topicConfig.messageRetentionPeriodInDays !== undefined) {
      throw new Error(
        `SNS topic '${topicConfig.topicName}': 'messageRetentionPeriodInDays' requires a FIFO topic`
      );
    }
  }

  /**
   * Applies tags to the topic and related resources
   */
  private applyTags(tags: { [key: string]: string }): void {
    Object.entries(tags).forEach(([key, value]) => {
      Tags.of(this).add(key, value);
    });
  }
}
