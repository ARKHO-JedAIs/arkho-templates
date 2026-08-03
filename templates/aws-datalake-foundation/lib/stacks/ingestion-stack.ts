import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as cloudwatch from 'aws-cdk-lib/aws-cloudwatch';
import * as cwActions from 'aws-cdk-lib/aws-cloudwatch-actions';
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
import { NagSuppressions } from 'cdk-nag';
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

    const alertsTopic = sns.Topic.fromTopicArn(this, 'AlertsRef', props.alertsTopic.topicArn);

    // --- Secretos (cargar valores reales vía consola/CLI post-deploy) ---
    // `removalPolicy` sigue al ambiente: en prod (RETAIN) un `destroy` no se
    // lleva las credenciales del cliente.
    const ga4Secret = new secretsmanager.Secret(this, 'Ga4Secret', {
      secretName: `${p}/ga4-api`,
      description: 'Credenciales GA4 Data API (service account) — cargar valores reales',
      encryptionKey: opsKey,
      removalPolicy: cfg.removalPolicy,
    });
    const metaSecret = new secretsmanager.Secret(this, 'MetaSecret', {
      secretName: `${p}/meta-ads-api`,
      description: 'Token Meta Marketing API — cargar valores reales',
      encryptionKey: opsKey,
      removalPolicy: cfg.removalPolicy,
    });

    // --- DLQ compartida para invocaciones asíncronas fallidas ---
    const dlq = new sqs.Queue(this, 'IngestDlq', {
      queueName: `${p}-ingest-dlq`,
      encryptionMasterKey: opsKey,
      enforceSSL: true,
      retentionPeriod: cdk.Duration.days(14),
      removalPolicy: cfg.removalPolicy,
    });

    // Los mensajes de la DLQ se borran a los 14 días: si nadie mira, la pérdida
    // de datos es silenciosa. Cualquier mensaje visible dispara alerta.
    const dlqAlarm = new cloudwatch.Alarm(this, 'IngestDlqAlarm', {
      alarmName: `${p}-ingest-dlq-not-empty`,
      alarmDescription:
        'Hay payloads de ingesta fallidos en la DLQ. Revisar antes de que expiren (14 días).',
      metric: dlq.metricApproximateNumberOfMessagesVisible({
        period: cdk.Duration.minutes(5),
      }),
      threshold: 1,
      comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
      evaluationPeriods: 1,
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
    });
    dlqAlarm.addAlarmAction(new cwActions.SnsAction(alertsTopic));

    const mkIngestFn = (
      name: string,
      assetDir: string,
      secret: secretsmanager.ISecret,
      targetPrefix: string,
    ): lambda.Function => {
      const logGroup = new logs.LogGroup(this, `${name}Logs`, {
        retention: logs.RetentionDays.ONE_MONTH,
        removalPolicy: cfg.removalPolicy,
        encryptionKey: dataKey,
      });
      const fn = new lambda.Function(this, `${name}Fn`, {
        functionName: `${p}-${assetDir}`,
        // Runtime más reciente disponible en aws-cdk-lib. cdk-nag (AwsSolutions-L1)
        // avisa si queda atrás: cuando eso pase, sube la versión y prueba las
        // Lambdas — es la regla funcionando, no un falso positivo que suprimir.
        runtime: lambda.Runtime.NODEJS_24_X,
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

      // Errores de la función: sin esto, una ingesta que falla todos los días
      // no avisa a nadie y el pipeline corre sobre datos Raw obsoletos.
      const errorAlarm = new cloudwatch.Alarm(this, `${name}ErrorAlarm`, {
        alarmName: `${p}-${assetDir}-errors`,
        alarmDescription: `La ingesta ${name} está fallando.`,
        metric: fn.metricErrors({ period: cdk.Duration.hours(1) }),
        threshold: 1,
        comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
        evaluationPeriods: 1,
        treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
      });
      errorAlarm.addAlarmAction(new cwActions.SnsAction(alertsTopic));

      NagSuppressions.addResourceSuppressions(
        fn,
        [
          {
            id: 'AwsSolutions-IAM4',
            reason:
              'AWSLambdaBasicExecutionRole es la policy administrada por AWS que CDK adjunta ' +
              'por defecto; solo permite escribir en el log group de la propia función.',
            appliesTo: [
              'Policy::arn:<AWS::Partition>:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole',
            ],
          },
          {
            id: 'AwsSolutions-IAM5',
            reason:
              'X-Ray no admite ARN de recurso. El resto son wildcards de los grants de CDK, ' +
              `acotados al prefijo ${targetPrefix} de la Raw Zone y a la data key.`,
            appliesTo: [
              'Resource::*', 'Action::s3:Abort*',
              'Action::kms:ReEncrypt*', 'Action::kms:GenerateDataKey*',
              { regex: '/^Resource::<.*ZoneBucket.*\\.Arn>\\/.*\\*$/g' },
            ],
          },
        ],
        true,
      );

      // El target de EventBridge también necesita DLQ: si la invocación misma
      // falla (throttling, permisos), el evento se perdería sin dejar rastro.
      new events.Rule(this, `${name}Schedule`, {
        description: `Ingesta diaria ${name} → Raw Zone`,
        schedule: events.Schedule.expression(cfg.ingestSchedule),
        targets: [new targets.LambdaFunction(fn, {
          retryAttempts: 2,
          deadLetterQueue: dlq,
        })],
      });
      return fn;
    };

    mkIngestFn('Ga4Ingest', 'ga4-ingest', ga4Secret, 'ga4/');
    mkIngestFn('MetaAdsIngest', 'meta-ads-ingest', metaSecret, 'meta-ads/');

    // --- SFTP Connector (pull desde el SFTP origen) ---
    if (cfg.sftp.enabled) {
      // `trustedHostKeys` es obligatorio para AWS::Transfer::Connector. Sin este
      // chequeo el synth pasa y el error recién aparece en el deploy.
      if (!cfg.sftp.url || !cfg.sftp.trustedHostKeys?.length) {
        throw new Error(
          `sftp.enabled=true en el ambiente '${cfg.envName}' requiere 'url' y ` +
            "'trustedHostKeys' en lib/config/environments.ts " +
            '(obtén las host keys con `ssh-keyscan <host>`).',
        );
      }
      const sftpSecret = new secretsmanager.Secret(this, 'SftpSecret', {
        secretName: `${p}/sftp-origen`,
        description: 'Usuario/llave privada del SFTP origen — cargar valores reales',
        encryptionKey: opsKey,
        removalPolicy: cfg.removalPolicy,
      });

      const connectorRole = new iam.Role(this, 'SftpConnectorRole', {
        assumedBy: new iam.ServicePrincipal('transfer.amazonaws.com'),
        description: 'Rol del SFTP Connector: escribe en Raw Zone y lee el secreto',
      });
      // El connector solo hace pull: escribe lo que baja y lee para reconciliar.
      // `grantReadWrite` incluiría s3:DeleteObject* sobre la Raw Zone.
      rawBucket.grantPut(connectorRole, 'sftp/*');
      rawBucket.grantRead(connectorRole, 'sftp/*');
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
      // (definir las rutas remotas exactas al integrar el origen).

      NagSuppressions.addResourceSuppressions(
        connectorRole,
        [
          {
            id: 'AwsSolutions-IAM5',
            reason:
              'El connector escribe bajo el prefijo sftp/ de la Raw Zone; el nombre de cada ' +
              'archivo lo define el origen y no se conoce en síntesis.',
            appliesTo: [
              'Action::s3:GetObject*', 'Action::s3:GetBucket*', 'Action::s3:List*',
              'Action::s3:Abort*', 'Action::kms:ReEncrypt*', 'Action::kms:GenerateDataKey*',
            ],
          },
        ],
        true,
      );

      NagSuppressions.addResourceSuppressions(sftpSecret, [
        {
          id: 'AwsSolutions-SMG4',
          reason:
            'Credencial de un SFTP de terceros: la rotación la coordina el proveedor del ' +
            'origen, no Secrets Manager. Rotarla automáticamente rompería la conexión.',
        },
      ]);
    }

    // ── cdk-nag: supresiones con evidencia ──────────────────────────────────
    for (const secret of [ga4Secret, metaSecret]) {
      NagSuppressions.addResourceSuppressions(secret, [
        {
          id: 'AwsSolutions-SMG4',
          reason:
            'Credenciales de APIs externas (GA4 service account, token de Meta Marketing). ' +
            'Secrets Manager no puede rotarlas sin una Lambda de rotación específica del ' +
            'proveedor; la renovación es un procedimiento manual documentado en el README.',
        },
      ]);
    }
  }
}