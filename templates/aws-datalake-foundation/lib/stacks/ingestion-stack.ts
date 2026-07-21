import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as events from 'aws-cdk-lib/aws-events';
import * as targets from 'aws-cdk-lib/aws-events-targets';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as kms from 'aws-cdk-lib/aws-kms';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
import * as sns from 'aws-cdk-lib/aws-sns';
import * as sqs from 'aws-cdk-lib/aws-sqs';
import * as transfer from 'aws-cdk-lib/aws-transfer';
import * as path from 'path';
import { DatalakeConfig, prefix } from '../config/environments';

export interface IngestionStackProps extends cdk.StackProps {
  readonly config: DatalakeConfig;
  readonly rawBucket: s3.IBucket;
  readonly dataKey: kms.IKey;
  readonly opsKey: kms.IKey;
  readonly alertsTopic: sns.ITopic;
}

/**
 * Capa de ingesta:
 * - Lambdas (Node 20 / ARM64) que consumen las APIs de GA4 y Meta Ads y
 *   depositan NDJSON particionado en la Raw Zone.
 * - Credenciales en Secrets Manager (nunca en variables de entorno).
 * - Transfer Family SFTP *Connector* (pull, pago por GB) en lugar de un
 *   endpoint SFTP 24/7 — decisión v2, ahorra ~200 USD/mes.
 */
export class IngestionStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: IngestionStackProps) {
    super(scope, id, props);
    const cfg = props.config;
    const p = prefix(cfg);

    // Re-importamos keys y bucket para que los grants se apliquen SOLO a las
    // identity policies de este stack (evita ciclos de dependencias al no
    // modificar la key policy que vive en el stack de seguridad).
    const opsKey = kms.Key.fromKeyArn(this, 'OpsKeyRef', props.opsKey.keyArn);
    const dataKey = kms.Key.fromKeyArn(this, 'DataKeyRef', props.dataKey.keyArn);
    const rawBucket = s3.Bucket.fromBucketAttributes(this, 'RawBucketRef', {
      bucketArn: props.rawBucket.bucketArn,
      encryptionKey: dataKey,
    });

    // --- Secretos (cargar valores reales vía consola/CLI post-deploy) ---
    const ga4Secret = new secretsmanager.Secret(this, 'Ga4Secret', {
      secretName: `${p}/ga4-api`,
      description: 'Credenciales GA4 Data API (service account) — cargar valores reales',
      encryptionKey: opsKey,
    });
    const metaSecret = new secretsmanager.Secret(this, 'MetaSecret', {
      secretName: `${p}/meta-ads-api`,
      description: 'Token Meta Marketing API — cargar valores reales',
      encryptionKey: opsKey,
    });

    // --- DLQ compartida para invocaciones asíncronas fallidas ---
    const dlq = new sqs.Queue(this, 'IngestDlq', {
      queueName: `${p}-ingest-dlq`,
      encryptionMasterKey: opsKey,
      enforceSSL: true,
      retentionPeriod: cdk.Duration.days(14),
    });

    const mkIngestFn = (
      name: string,
      assetDir: string,
      secret: secretsmanager.ISecret,
      targetPrefix: string,
    ): lambda.Function => {
      const logGroup = new logs.LogGroup(this, `${name}Logs`, {
        retention: logs.RetentionDays.ONE_MONTH,
        removalPolicy: cfg.removalPolicy,
      });
      const fn = new lambda.Function(this, `${name}Fn`, {
        functionName: `${p}-${assetDir}`,
        runtime: lambda.Runtime.NODEJS_20_X,
        architecture: lambda.Architecture.ARM_64,
        handler: 'index.handler',
        code: lambda.Code.fromAsset(path.join(__dirname, '..', '..', 'lambda', assetDir)),
        memorySize: 512,
        timeout: cdk.Duration.minutes(10),
        tracing: lambda.Tracing.ACTIVE,
        deadLetterQueue: dlq,
        logGroup,
        environment: {
          RAW_BUCKET: rawBucket.bucketName,
          TARGET_PREFIX: targetPrefix,
          SECRET_ARN: secret.secretArn,
        },
      });
      // Mínimo privilegio: put solo bajo su prefijo, lectura solo de su secreto
      rawBucket.grantPut(fn, `${targetPrefix}*`);
      secret.grantRead(fn);

      new events.Rule(this, `${name}Schedule`, {
        description: `Ingesta diaria ${name} → Raw Zone`,
        schedule: events.Schedule.expression(cfg.ingestSchedule),
        targets: [new targets.LambdaFunction(fn, { retryAttempts: 2 })],
      });
      return fn;
    };

    mkIngestFn('Ga4Ingest', 'ga4-ingest', ga4Secret, 'ga4/');
    mkIngestFn('MetaAdsIngest', 'meta-ads-ingest', metaSecret, 'meta-ads/');

    // --- SFTP Connector (pull desde el SFTP del sistema de producto) ---
    if (cfg.sftp.enabled && cfg.sftp.url) {
      const sftpSecret = new secretsmanager.Secret(this, 'SftpSecret', {
        secretName: `${p}/sftp-origen`,
        description: 'Usuario/llave privada del SFTP origen — cargar valores reales',
        encryptionKey: opsKey,
      });

      const connectorRole = new iam.Role(this, 'SftpConnectorRole', {
        assumedBy: new iam.ServicePrincipal('transfer.amazonaws.com'),
        description: 'Rol del SFTP Connector: escribe en Raw Zone y lee el secreto',
      });
      rawBucket.grantReadWrite(connectorRole, 'sftp/*');
      sftpSecret.grantRead(connectorRole);

      new transfer.CfnConnector(this, 'SftpConnector', {
        accessRole: connectorRole.roleArn,
        url: cfg.sftp.url,
        sftpConfig: {
          userSecretId: sftpSecret.secretArn,
          trustedHostKeys: cfg.sftp.trustedHostKeys,
        },
      });
      // El pull se agenda con EventBridge Scheduler → StartFileTransfer
      // (definir rutas remotas exactas tras la Fase 0 GO/NO-GO).
    }
  }
}