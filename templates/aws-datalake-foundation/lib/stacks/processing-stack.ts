import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as cloudwatch from 'aws-cdk-lib/aws-cloudwatch';
import * as cwActions from 'aws-cdk-lib/aws-cloudwatch-actions';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as events from 'aws-cdk-lib/aws-events';
import * as targets from 'aws-cdk-lib/aws-events-targets';
import * as glue from 'aws-cdk-lib/aws-glue';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as kms from 'aws-cdk-lib/aws-kms';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as s3assets from 'aws-cdk-lib/aws-s3-assets';
import * as sns from 'aws-cdk-lib/aws-sns';
import * as sfn from 'aws-cdk-lib/aws-stepfunctions';
import * as tasks from 'aws-cdk-lib/aws-stepfunctions-tasks';
import * as path from 'path';
import { DatalakeConfig, prefix } from '../config/environments';

export interface ProcessingStackProps extends cdk.StackProps {
  readonly config: DatalakeConfig;
  readonly rawBucket: s3.IBucket;
  readonly cleanBucket: s3.IBucket;
  readonly curatedBucket: s3.IBucket;
  readonly dataKey: kms.IKey;
  readonly opsKey: kms.IKey;
  readonly alertsTopic: sns.ITopic;
}

/**
 * Orquestación y ETL:
 * - Step Functions coordina el pipeline end-to-end (RUN_JOB síncrono,
 *   reintentos con backoff y notificación SNS en fallo).
 * - Glue ETL right-sized (decisión v2): G.1X con auto-scaling hasta
 *   `glueMaxWorkers`, bookmarks habilitados, cifrado SSE-KMS.
 * - DynamoDB externaliza parámetros y estado de los jobs.
 */
export class ProcessingStack extends cdk.Stack {
  public readonly stateMachine: sfn.StateMachine;

  constructor(scope: Construct, id: string, props: ProcessingStackProps) {
    super(scope, id, props);
    const cfg = props.config;
    const p = prefix(cfg);

    // Recursos re-importados: los grants se aplican solo a identity policies
    // de este stack (evita ciclos de dependencias entre stacks).
    const dataKey = kms.Key.fromKeyArn(this, 'DataKeyRef', props.dataKey.keyArn);
    const rawBucket = s3.Bucket.fromBucketAttributes(this, 'RawRef', {
      bucketArn: props.rawBucket.bucketArn, encryptionKey: dataKey });
    const cleanBucket = s3.Bucket.fromBucketAttributes(this, 'CleanRef', {
      bucketArn: props.cleanBucket.bucketArn, encryptionKey: dataKey });
    const curatedBucket = s3.Bucket.fromBucketAttributes(this, 'CuratedRef', {
      bucketArn: props.curatedBucket.bucketArn, encryptionKey: dataKey });
    const alertsTopic = sns.Topic.fromTopicArn(this, 'AlertsRef', props.alertsTopic.topicArn);

    // --- Tabla de configuración/estado de jobs ---
    const jobConfigTable = new dynamodb.Table(this, 'JobConfigTable', {
      tableName: `${p}-job-config`,
      partitionKey: { name: 'jobName', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'sk', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      encryption: dynamodb.TableEncryption.CUSTOMER_MANAGED,
      encryptionKey: dataKey,
      pointInTimeRecoverySpecification: { pointInTimeRecoveryEnabled: true },
      removalPolicy: cfg.removalPolicy,
    });

    // --- Rol de Glue (mínimo privilegio sobre buckets y tabla) ---
    const glueRole = new iam.Role(this, 'GlueJobRole', {
      assumedBy: new iam.ServicePrincipal('glue.amazonaws.com'),
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSGlueServiceRole'),
      ],
    });
    rawBucket.grantRead(glueRole);
    cleanBucket.grantReadWrite(glueRole);
    curatedBucket.grantReadWrite(glueRole);
    jobConfigTable.grantReadWriteData(glueRole);

    // --- Scripts ETL versionados como assets (se suben al bucket de bootstrap) ---
    const rawToCleanAsset = new s3assets.Asset(this, 'RawToCleanScript', {
      path: path.join(__dirname, '..', '..', 'glue', 'jobs', 'raw_to_clean.py'),
    });
    const cleanToCuratedAsset = new s3assets.Asset(this, 'CleanToCuratedScript', {
      path: path.join(__dirname, '..', '..', 'glue', 'jobs', 'clean_to_curated.py'),
    });
    rawToCleanAsset.grantRead(glueRole);
    cleanToCuratedAsset.grantRead(glueRole);

    // --- Cifrado de todo lo que escribe Glue ---
    const securityConfigName = `${p}-glue-sec`;
    new glue.CfnSecurityConfiguration(this, 'GlueSecurityConfig', {
      name: securityConfigName,
      encryptionConfiguration: {
        s3Encryptions: [
          { s3EncryptionMode: 'SSE-KMS', kmsKeyArn: dataKey.keyArn },
        ],
        jobBookmarksEncryption: {
          jobBookmarksEncryptionMode: 'CSE-KMS',
          kmsKeyArn: dataKey.keyArn,
        },
      },
    });

    const commonArgs: Record<string, string> = {
      '--enable-auto-scaling': 'true', // right-sizing v2: escala 2..max
      '--job-bookmark-option': 'job-bookmark-enable',
      '--enable-metrics': 'true',
      '--enable-continuous-cloudwatch-log': 'true',
      '--TempDir': `s3://${cleanBucket.bucketName}/glue-temp/`,
      '--config_table': jobConfigTable.tableName,
    };

    const rawToCleanJobName = `${p}-raw-to-clean`;
    new glue.CfnJob(this, 'RawToCleanJob', {
      name: rawToCleanJobName,
      role: glueRole.roleArn,
      glueVersion: '4.0',
      workerType: 'G.1X',
      numberOfWorkers: cfg.glueMaxWorkers,
      executionProperty: { maxConcurrentRuns: 1 },
      timeout: 60,
      maxRetries: 0, // los reintentos los maneja Step Functions
      securityConfiguration: securityConfigName,
      command: {
        name: 'glueetl',
        pythonVersion: '3',
        scriptLocation: rawToCleanAsset.s3ObjectUrl,
      },
      defaultArguments: {
        ...commonArgs,
        '--source_bucket': rawBucket.bucketName,
        '--target_bucket': cleanBucket.bucketName,
      },
    });

    const cleanToCuratedJobName = `${p}-clean-to-curated`;
    new glue.CfnJob(this, 'CleanToCuratedJob', {
      name: cleanToCuratedJobName,
      role: glueRole.roleArn,
      glueVersion: '4.0',
      workerType: 'G.1X',
      numberOfWorkers: cfg.glueMaxWorkers,
      executionProperty: { maxConcurrentRuns: 1 },
      timeout: 60,
      maxRetries: 0,
      securityConfiguration: securityConfigName,
      command: {
        name: 'glueetl',
        pythonVersion: '3',
        scriptLocation: cleanToCuratedAsset.s3ObjectUrl,
      },
      defaultArguments: {
        ...commonArgs,
        '--datalake-formats': 'iceberg', // decisión v2: Curated en Iceberg
        '--source_bucket': cleanBucket.bucketName,
        '--target_bucket': curatedBucket.bucketName,
      },
    });

    // --- Crawlers: actualizan el catálogo tras el pipeline ---
    for (const [zone, bucket] of [
      ['clean', cleanBucket],
      ['curated', curatedBucket],
    ] as const) {
      new glue.CfnCrawler(this, `${zone}Crawler`, {
        name: `${p}-${zone}-crawler`,
        role: glueRole.roleArn,
        databaseName: `{{ catalog_prefix }}_${cfg.envName}_${zone}`,
        targets: { s3Targets: [{ path: `s3://${bucket.bucketName}/` }] },
        schedule: { scheduleExpression: cfg.crawlerSchedule },
        schemaChangePolicy: {
          updateBehavior: 'UPDATE_IN_DATABASE',
          deleteBehavior: 'DEPRECATE_IN_DATABASE',
        },
      });
    }

    // --- Step Functions: pipeline con retry/backoff y alerta en fallo ---
    const notifyFailure = new tasks.SnsPublish(this, 'NotifyFailure', {
      topic: alertsTopic,
      subject: `[${cfg.envName}] Pipeline {{ client_name }} Data Lake FALLÓ`,
      message: sfn.TaskInput.fromJsonPathAt('$'),
    }).next(new sfn.Fail(this, 'PipelineFailed'));

    const runRawToClean = new tasks.GlueStartJobRun(this, 'RunRawToClean', {
      glueJobName: rawToCleanJobName,
      integrationPattern: sfn.IntegrationPattern.RUN_JOB,
      resultPath: sfn.JsonPath.DISCARD,
    });
    runRawToClean.addRetry({
      errors: ['States.ALL'],
      maxAttempts: 2,
      interval: cdk.Duration.minutes(2),
      backoffRate: 2,
    });
    runRawToClean.addCatch(notifyFailure, { resultPath: '$.error' });

    const runCleanToCurated = new tasks.GlueStartJobRun(this, 'RunCleanToCurated', {
      glueJobName: cleanToCuratedJobName,
      integrationPattern: sfn.IntegrationPattern.RUN_JOB,
      resultPath: sfn.JsonPath.DISCARD,
    });
    runCleanToCurated.addRetry({
      errors: ['States.ALL'],
      maxAttempts: 2,
      interval: cdk.Duration.minutes(2),
      backoffRate: 2,
    });
    runCleanToCurated.addCatch(notifyFailure, { resultPath: '$.error' });

    const definition = runRawToClean
      .next(runCleanToCurated)
      .next(new sfn.Succeed(this, 'PipelineSucceeded'));

    const sfnLogs = new logs.LogGroup(this, 'PipelineLogs', {
      retention: logs.RetentionDays.ONE_MONTH,
      removalPolicy: cfg.removalPolicy,
    });

    this.stateMachine = new sfn.StateMachine(this, 'PipelineStateMachine', {
      stateMachineName: `${p}-pipeline`,
      definitionBody: sfn.DefinitionBody.fromChainable(definition),
      tracingEnabled: true,
      logs: { destination: sfnLogs, level: sfn.LogLevel.ERROR },
      timeout: cdk.Duration.hours(4),
    });

    // El tópico está cifrado con la ops key: el rol de SFN necesita usarla
    this.stateMachine.addToRolePolicy(new iam.PolicyStatement({
      actions: ['kms:Decrypt', 'kms:GenerateDataKey*'],
      resources: [props.opsKey.keyArn],
    }));

    new events.Rule(this, 'PipelineSchedule', {
      description: 'Ejecución diaria del pipeline {{ client_name }} Data Lake',
      schedule: events.Schedule.expression(cfg.pipelineSchedule),
      targets: [new targets.SfnStateMachine(this.stateMachine)],
    });

    // --- Alarma: cualquier ejecución fallida notifica al equipo ---
    const failedAlarm = new cloudwatch.Alarm(this, 'PipelineFailedAlarm', {
      alarmName: `${p}-pipeline-failed`,
      metric: this.stateMachine.metricFailed({ period: cdk.Duration.hours(1) }),
      threshold: 1,
      evaluationPeriods: 1,
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
    });
    failedAlarm.addAlarmAction(new cwActions.SnsAction(alertsTopic));
  }
}
