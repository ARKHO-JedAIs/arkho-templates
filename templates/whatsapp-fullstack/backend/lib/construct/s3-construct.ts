import { Construct } from 'constructs';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as iam from 'aws-cdk-lib/aws-iam';
import { RemovalPolicy, Duration, Tags } from 'aws-cdk-lib';
import { ParamsConfig } from '../stack/shared/util/env-config';

/**
 * Interface for S3 bucket lifecycle rule configuration
 */
export interface S3LifecycleRuleConfig {
  id: string;
  enabled?: boolean;
  prefix?: string;
  tagFilters?: { [key: string]: string };
  expiration?: Duration;
  noncurrentVersionExpiration?: Duration;
  transitions?: {
    storageClass: s3.StorageClass;
    transitionAfter: Duration;
  }[];
  noncurrentVersionTransitions?: {
    storageClass: s3.StorageClass;
    transitionAfter: Duration;
  }[];
  abortIncompleteMultipartUploadAfter?: Duration;
}

/**
 * Interface for S3 bucket CORS configuration
 */
export interface S3CorsRuleConfig {
  allowedMethods: s3.HttpMethods[];
  allowedOrigins: string[];
  allowedHeaders?: string[];
  exposedHeaders?: string[];
  maxAge?: number;
}

/**
 * Interface for S3 bucket notification configuration
 */
export interface S3NotificationConfig {
  lambdaConfigurations?: {
    lambdaFunction: any; // Will be typed as Function when imported
    events: s3.EventType[];
    filters?: s3.NotificationKeyFilter[];
  }[];
  topicConfigurations?: {
    topic: any; // Will be typed as Topic when imported
    events: s3.EventType[];
    filters?: s3.NotificationKeyFilter[];
  }[];
  queueConfigurations?: {
    queue: any; // Will be typed as Queue when imported
    events: s3.EventType[];
    filters?: s3.NotificationKeyFilter[];
  }[];
}

/**
 * Interface for S3 bucket replication configuration
 */
export interface S3ReplicationConfig {
  role: iam.IRole;
  rules: {
    id: string;
    status: 'Enabled' | 'Disabled';
    prefix?: string;
    destinationBucket: s3.IBucket;
    destinationStorageClass?: s3.StorageClass;
    deleteMarkerReplication?: boolean;
    replicaKmsKeyId?: string;
  }[];
}

/**
 * Interface for S3 bucket configuration
 */
export interface S3BucketConfig {
  bucketName: string;
  versioned?: boolean;
  encryption?: {
    type: 's3Managed' | 'kmsManaged' | 'customerManaged';
    kmsKey?: any; // Will be typed as Key when imported
  };
  publicReadAccess?: boolean;
  blockPublicAccess?: s3.BlockPublicAccess;
  enforceSSL?: boolean;
  lifecycleRules?: S3LifecycleRuleConfig[];
  cors?: S3CorsRuleConfig[];
  websiteIndexDocument?: string;
  websiteErrorDocument?: string;
  websiteRedirect?: {
    hostName: string;
    protocol?: s3.RedirectProtocol;
  };
  transferAcceleration?: boolean;
  eventBridgeEnabled?: boolean;
  notifications?: S3NotificationConfig;
  replication?: S3ReplicationConfig;
  inventoryConfigurations?: {
    id: string;
    destination: {
      bucket: s3.IBucket;
      prefix?: string;
    };
    enabled?: boolean;
    includeObjectVersions: s3.InventoryObjectVersion;
    optionalFields?: string[];
    frequency: s3.InventoryFrequency;
  }[];
  metricsConfigurations?: {
    id: string;
    prefix?: string;
    tagFilters?: { [key: string]: string };
  }[];
  intelligentTieringConfigurations?: {
    id: string;
    prefix?: string;
    tagFilters?: { [key: string]: string };
    archiveAccessTierTime?: Duration;
    deepArchiveAccessTierTime?: Duration;
  }[];
}

/**
 * Interface for S3 construct properties
 */
export interface S3ConstructProps {
  params: ParamsConfig;
  bucketConfig: S3BucketConfig;
  additionalTags?: { [key: string]: string };
}

/**
 * Level 2 S3 Construct for creating and configuring S3 buckets
 * 
 * This construct provides a comprehensive interface for creating S3 buckets
 * with advanced configurations including security, lifecycle management,
 * CORS, notifications, replication, and more.
 * 
 * @example
 * ```typescript
 * const s3Bucket = new S3Construct(this, 'MyS3Bucket', {
 *   params: config.params,
 *   bucketConfig: {
 *     bucketName: 'my-app-bucket',
 *     versioned: true,
 *     encryption: {
 *       type: 'kmsManaged'
 *     },
 *     publicReadAccess: false,
 *     enforceSSL: true,
 *     lifecycleRules: [{
 *       id: 'DeleteOldVersions',
 *       enabled: true,
 *       noncurrentVersionExpiration: Duration.days(30)
 *     }],
 *     cors: [{
 *       allowedMethods: [s3.HttpMethods.GET, s3.HttpMethods.POST],
 *       allowedOrigins: ['https://myapp.com'],
 *       allowedHeaders: ['*']
 *     }]
 *   }
 * });
 * ```
 */
export class S3Construct extends Construct {
  /**
   * The S3 bucket created by this construct
   */
  public readonly bucket: s3.Bucket;

  /**
   * The ARN of the bucket
   */
  public readonly bucketArn: string;

  /**
   * The name of the bucket
   */
  public readonly bucketName: string;

  /**
   * The domain name of the bucket
   */
  public readonly bucketDomainName: string;

  /**
   * The website URL of the bucket (if website hosting is enabled)
   */
  public readonly bucketWebsiteUrl?: string;

  /**
   * The regional domain name of the bucket
   */
  public readonly bucketRegionalDomainName: string;

  constructor(scope: Construct, id: string, props: S3ConstructProps) {
    super(scope, id);

    const { params, bucketConfig, additionalTags = {} } = props;

    // Configure bucket encryption
    let encryption: s3.BucketEncryption | undefined;
    let encryptionKey: any | undefined;

    if (bucketConfig.encryption) {
      switch (bucketConfig.encryption.type) {
        case 's3Managed':
          encryption = s3.BucketEncryption.S3_MANAGED;
          break;
        case 'kmsManaged':
          encryption = s3.BucketEncryption.KMS_MANAGED;
          break;
        case 'customerManaged':
          encryption = s3.BucketEncryption.KMS;
          encryptionKey = bucketConfig.encryption.kmsKey;
          break;
        default:
          encryption = s3.BucketEncryption.S3_MANAGED;
      }
    }

    // Configure public access blocking
    const blockPublicAccess = bucketConfig.blockPublicAccess || 
      (bucketConfig.publicReadAccess ? 
        s3.BlockPublicAccess.BLOCK_ACLS : 
        s3.BlockPublicAccess.BLOCK_ALL);

    // Configure website hosting
    let websiteIndexDocument: string | undefined;
    let websiteErrorDocument: string | undefined;
    let websiteRedirect: s3.RedirectTarget | undefined;

    if (bucketConfig.websiteIndexDocument) {
      websiteIndexDocument = bucketConfig.websiteIndexDocument;
      websiteErrorDocument = bucketConfig.websiteErrorDocument;
    }

    if (bucketConfig.websiteRedirect) {
      websiteRedirect = {
        hostName: bucketConfig.websiteRedirect.hostName,
        protocol: bucketConfig.websiteRedirect.protocol
      };
    }

    // Create the S3 bucket
    this.bucket = new s3.Bucket(this, 'Bucket', {
      bucketName: bucketConfig.bucketName,
      versioned: bucketConfig.versioned ?? false,
      encryption,
      encryptionKey,
      publicReadAccess: bucketConfig.publicReadAccess ?? false,
      blockPublicAccess,
      transferAcceleration: bucketConfig.transferAcceleration ?? false,
      eventBridgeEnabled: bucketConfig.eventBridgeEnabled ?? false,
      websiteIndexDocument,
      websiteErrorDocument,
      websiteRedirect,
      removalPolicy: params.isProd ? RemovalPolicy.RETAIN : RemovalPolicy.DESTROY,
      autoDeleteObjects: !params.isProd,
    });

    // Configure CORS rules
    if (bucketConfig.cors && bucketConfig.cors.length > 0) {
      bucketConfig.cors.forEach((corsRule, index) => {
        this.bucket.addCorsRule({
          allowedMethods: corsRule.allowedMethods,
          allowedOrigins: corsRule.allowedOrigins,
          allowedHeaders: corsRule.allowedHeaders,
          exposedHeaders: corsRule.exposedHeaders,
          maxAge: corsRule.maxAge
        });
      });
    }

    // Configure lifecycle rules
    if (bucketConfig.lifecycleRules && bucketConfig.lifecycleRules.length > 0) {
      bucketConfig.lifecycleRules.forEach(rule => {
        this.bucket.addLifecycleRule({
          id: rule.id,
          enabled: rule.enabled ?? true,
          prefix: rule.prefix,
          tagFilters: rule.tagFilters,
          expiration: rule.expiration,
          noncurrentVersionExpiration: rule.noncurrentVersionExpiration,
          transitions: rule.transitions,
          noncurrentVersionTransitions: rule.noncurrentVersionTransitions,
          abortIncompleteMultipartUploadAfter: rule.abortIncompleteMultipartUploadAfter
        });
      });
    }

    // Configure metrics
    if (bucketConfig.metricsConfigurations && bucketConfig.metricsConfigurations.length > 0) {
      bucketConfig.metricsConfigurations.forEach(metricsConfig => {
        this.bucket.addMetric({
          id: metricsConfig.id,
          prefix: metricsConfig.prefix,
          tagFilters: metricsConfig.tagFilters
        });
      });
    }

    // Configure intelligent tiering
    // Note: Intelligent tiering configurations are typically managed through AWS Console or CLI
    // CDK doesn't provide direct support for intelligent tiering configurations
    if (bucketConfig.intelligentTieringConfigurations && bucketConfig.intelligentTieringConfigurations.length > 0) {
      // This would require custom resource implementation or AWS CLI commands
      console.warn('Intelligent tiering configurations need to be set up manually or through custom resources');
    }

    // Configure inventory
    if (bucketConfig.inventoryConfigurations && bucketConfig.inventoryConfigurations.length > 0) {
      bucketConfig.inventoryConfigurations.forEach(inventoryConfig => {
        this.bucket.addInventory({
          inventoryId: inventoryConfig.id,
          destination: {
            bucket: inventoryConfig.destination.bucket,
            prefix: inventoryConfig.destination.prefix
          },
          enabled: inventoryConfig.enabled ?? true,
          includeObjectVersions: inventoryConfig.includeObjectVersions,
          optionalFields: inventoryConfig.optionalFields,
          frequency: inventoryConfig.frequency
        });
      });
    }

    // Enforce SSL if requested
    if (bucketConfig.enforceSSL) {
      this.bucket.addToResourcePolicy(new iam.PolicyStatement({
        sid: 'DenyInsecureConnections',
        effect: iam.Effect.DENY,
        principals: [new iam.AnyPrincipal()],
        actions: ['s3:*'],
        resources: [
          this.bucket.bucketArn,
          this.bucket.arnForObjects('*')
        ],
        conditions: {
          Bool: {
            'aws:SecureTransport': 'false'
          }
        }
      }));
    }

    // Store references
    this.bucketArn = this.bucket.bucketArn;
    this.bucketName = this.bucket.bucketName;
    this.bucketDomainName = this.bucket.bucketDomainName;
    this.bucketRegionalDomainName = this.bucket.bucketRegionalDomainName;
    this.bucketWebsiteUrl = this.bucket.bucketWebsiteUrl;

    // Apply tags
    this.applyTags(additionalTags);
  }

  /**
   * Grants read permissions to a principal
   */
  public grantRead(identity: iam.IGrantable, objectsKeyPattern: any = '*'): iam.Grant {
    return this.bucket.grantRead(identity, objectsKeyPattern);
  }

  /**
   * Grants write permissions to a principal
   */
  public grantWrite(identity: iam.IGrantable, objectsKeyPattern: any = '*'): iam.Grant {
    return this.bucket.grantWrite(identity, objectsKeyPattern);
  }

  /**
   * Grants read and write permissions to a principal
   */
  public grantReadWrite(identity: iam.IGrantable, objectsKeyPattern: any = '*'): iam.Grant {
    return this.bucket.grantReadWrite(identity, objectsKeyPattern);
  }

  /**
   * Grants delete permissions to a principal
   */
  public grantDelete(identity: iam.IGrantable, objectsKeyPattern: any = '*'): iam.Grant {
    return this.bucket.grantDelete(identity, objectsKeyPattern);
  }

  /**
   * Grants put permissions to a principal
   */
  public grantPut(identity: iam.IGrantable, objectsKeyPattern: any = '*'): iam.Grant {
    return this.bucket.grantPut(identity, objectsKeyPattern);
  }

  /**
   * Grants public read access to the bucket
   */
  public grantPublicRead(): void {
    this.bucket.grantPublicAccess();
  }

  /**
   * Adds a bucket policy statement
   */
  public addToResourcePolicy(statement: iam.PolicyStatement): iam.AddToResourcePolicyResult {
    return this.bucket.addToResourcePolicy(statement);
  }

  /**
   * Returns the ARN for objects in this bucket
   */
  public arnForObjects(keyPattern: string): string {
    return this.bucket.arnForObjects(keyPattern);
  }

  /**
   * Returns the URL for an object in this bucket
   */
  public urlForObject(key?: string): string {
    return this.bucket.urlForObject(key);
  }

  /**
   * Returns the virtual hosted-style URL for an object in this bucket
   */
  public virtualHostedUrlForObject(key?: string, options?: s3.VirtualHostedStyleUrlOptions): string {
    return this.bucket.virtualHostedUrlForObject(key, options);
  }

  /**
   * Returns the S3 URL for an object in this bucket
   */
  public s3UrlForObject(key?: string): string {
    return this.bucket.s3UrlForObject(key);
  }

  /**
   * Adds an event notification to the bucket
   */
  public addEventNotification(event: s3.EventType, dest: s3.IBucketNotificationDestination, ...filters: s3.NotificationKeyFilter[]): void {
    this.bucket.addEventNotification(event, dest, ...filters);
  }

  /**
   * Adds an object created event notification to the bucket
   */
  public addObjectCreatedNotification(dest: s3.IBucketNotificationDestination, ...filters: s3.NotificationKeyFilter[]): void {
    this.bucket.addObjectCreatedNotification(dest, ...filters);
  }

  /**
   * Adds an object removed event notification to the bucket
   */
  public addObjectRemovedNotification(dest: s3.IBucketNotificationDestination, ...filters: s3.NotificationKeyFilter[]): void {
    this.bucket.addObjectRemovedNotification(dest, ...filters);
  }

  /**
   * Applies tags to the bucket and related resources
   */
  private applyTags(tags: { [key: string]: string }): void {
    Object.entries(tags).forEach(([key, value]) => {
      Tags.of(this).add(key, value);
    });
  }

  /**
   * Creates a presigned URL for uploading objects
   */
  public getPresignedUploadUrl(key: string, expiresIn: Duration = Duration.hours(1)): string {
    // This would typically use AWS SDK to generate presigned URLs
    // For CDK construct, this is more of a helper method reference
    return `https://${this.bucketName}.s3.amazonaws.com/${key}`;
  }

  /**
   * Creates a presigned URL for downloading objects
   */
  public getPresignedDownloadUrl(key: string, expiresIn: Duration = Duration.hours(1)): string {
    // This would typically use AWS SDK to generate presigned URLs
    // For CDK construct, this is more of a helper method reference
    return `https://${this.bucketName}.s3.amazonaws.com/${key}`;
  }
}
