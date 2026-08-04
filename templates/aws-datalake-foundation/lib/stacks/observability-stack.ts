import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as cloudtrail from 'aws-cdk-lib/aws-cloudtrail';
import * as cloudwatch from 'aws-cdk-lib/aws-cloudwatch';
import * as cwActions from 'aws-cdk-lib/aws-cloudwatch-actions';
import * as events from 'aws-cdk-lib/aws-events';
import * as targets from 'aws-cdk-lib/aws-events-targets';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as sfn from 'aws-cdk-lib/aws-stepfunctions';
import * as sns from 'aws-cdk-lib/aws-sns';
import { NagSuppressions } from 'cdk-nag';
import { DatalakeConfig, METRIC_NAMESPACE, logRetention, prefix } from '../config/environments';

export interface ObservabilityStackProps extends cdk.StackProps {
  readonly config: DatalakeConfig;
  readonly dataBuckets: s3.IBucket[];
  readonly stateMachine: sfn.IStateMachine;
  readonly alertsTopic: sns.ITopic;
  /** Object Lock (WORM) en el bucket del trail. IRREVERSIBLE. */
  readonly enableObjectLock: boolean;
}

/**
 * Auditoría y observabilidad operacional.
 *
 * CloudTrail con data events sobre las zonas del lake (quién accedió a qué objeto,
 * cuándo y desde dónde) más las alarmas que hacen que un problema se note.
 *
 * La alarma más importante es la de "el pipeline NO corrió": una alarma sobre
 * ejecuciones fallidas no dice nada si el scheduler se rompió o alguien deshabilitó
 * la regla — en ese caso no hay fallos, simplemente no pasa nada, y sin esta alarma
 * el silencio es indistinguible del éxito.
 *
 * Nota de costo: los data events S3 se cobran por evento (~USD 0.10 por 100k) y el
 * trail cubre las 4 zonas.
 */
export class ObservabilityStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: ObservabilityStackProps) {
    super(scope, id, props);
    const cfg = props.config;
    const p = prefix(cfg);
    const retention = logRetention(cfg);
    const alarmAction = new cwActions.SnsAction(props.alertsTopic);

    // ── CloudTrail ────────────────────────────────────────────────────────────
    // Bucket propio (en vez de dejar que CloudTrail lo genere) para poder ponerle
    // lifecycle y Object Lock: sin lifecycle los logs de auditoría crecen sin límite,
    // y sin Object Lock un principal con DeleteObjectVersion puede borrar la
    // evidencia que el trail existe para preservar.
    const lockRetentionYears = cfg.archiveRetentionYears > 0 ? cfg.archiveRetentionYears : 1;
    const trailBucket = new s3.Bucket(this, 'TrailBucket', {
      // CloudTrail exige SSE-S3 o una CMK con política específica para
      // `cloudtrail.amazonaws.com`; SSE-S3 es lo que AWS recomienda para logs de
      // auditoría y evita acoplar la data key.
      encryption: s3.BucketEncryption.S3_MANAGED,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      enforceSSL: true,
      versioned: true,
      // La regla de retención solo aplica donde no hay auto-borrado: con una regla
      // por defecto, el custom resource que vacía el bucket en `destroy` no podría
      // borrar los objetos bloqueados.
      ...(props.enableObjectLock
        ? {
            objectLockEnabled: true,
            ...(cfg.autoDeleteObjects
              ? {}
              : {
                  objectLockDefaultRetention: s3.ObjectLockRetention.governance(
                    cdk.Duration.days(lockRetentionYears * 365),
                  ),
                }),
          }
        : {}),
      lifecycleRules: [
        {
          transitions: [
            {
              storageClass: s3.StorageClass.GLACIER_INSTANT_RETRIEVAL,
              transitionAfter: cdk.Duration.days(90),
            },
          ],
          ...(cfg.archiveRetentionYears > 0
            ? { expiration: cdk.Duration.days(cfg.archiveRetentionYears * 365) }
            : {}),
          abortIncompleteMultipartUploadAfter: cdk.Duration.days(7),
        },
      ],
      removalPolicy: cfg.removalPolicy,
      autoDeleteObjects: cfg.autoDeleteObjects,
    });

    // El trail va a CloudWatch Logs además de S3: sin esa integración NO se puede
    // alarmar sobre el contenido del trail (los metric filters de abajo).
    const trailLogGroup = new logs.LogGroup(this, 'TrailLogs', {
      retention,
      removalPolicy: cfg.removalPolicy,
    });

    const trail = new cloudtrail.Trail(this, 'DataLakeTrail', {
      bucket: trailBucket,
      enableFileValidation: true,
      // Multi-región: una acción ejecutada en otra región contra recursos de este
      // lake quedaría sin registrar en un trail de una sola región.
      isMultiRegionTrail: true,
      includeGlobalServiceEvents: true,
      managementEvents: cloudtrail.ReadWriteType.ALL,
      cloudWatchLogGroup: trailLogGroup,
      sendToCloudWatchLogs: true,
      cloudWatchLogsRetention: retention,
    });

    trail.addS3EventSelector(
      props.dataBuckets.map((bucket) => ({ bucket })),
      { readWriteType: cloudtrail.ReadWriteType.ALL },
    );

    // ── Alarmas sobre el contenido del trail ──────────────────────────────────
    const mkLogAlarm = (
      id: string,
      metricName: string,
      pattern: logs.IFilterPattern,
      description: string,
    ) => {
      new logs.MetricFilter(this, `${id}Filter`, {
        logGroup: trailLogGroup,
        metricNamespace: METRIC_NAMESPACE,
        metricName,
        filterPattern: pattern,
        metricValue: '1',
        defaultValue: 0,
      });
      const alarm = new cloudwatch.Alarm(this, `${id}Alarm`, {
        alarmName: `${p}-${metricName}`,
        alarmDescription: description,
        metric: new cloudwatch.Metric({
          namespace: METRIC_NAMESPACE,
          metricName,
          statistic: 'Sum',
          period: cdk.Duration.minutes(5),
        }),
        threshold: 1,
        comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
        evaluationPeriods: 1,
        treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
      });
      alarm.addAlarmAction(alarmAction);
      return alarm;
    };

    mkLogAlarm(
      'UnauthorizedApi',
      'UnauthorizedApiCalls',
      logs.FilterPattern.literal(
        '{ ($.errorCode = "*UnauthorizedOperation") || ($.errorCode = "AccessDenied*") }',
      ),
      'Llamadas denegadas en la cuenta: puede ser un permiso faltante o un intento de acceso indebido.',
    );
    mkLogAlarm(
      'BucketPolicyChange',
      'DataLakePolicyChanges',
      logs.FilterPattern.literal(
        '{ ($.eventSource = "s3.amazonaws.com") && ' +
          '(($.eventName = "PutBucketPolicy") || ($.eventName = "DeleteBucketPolicy") || ' +
          '($.eventName = "PutBucketAcl") || ($.eventName = "PutEncryptionConfiguration")) }',
      ),
      'Cambio en la política o el cifrado de un bucket del lake.',
    );
    mkLogAlarm(
      'LakeFormationChange',
      'LakeFormationPermissionChanges',
      logs.FilterPattern.literal(
        '{ ($.eventSource = "lakeformation.amazonaws.com") && ' +
          '(($.eventName = "GrantPermissions") || ($.eventName = "RevokePermissions") || ' +
          '($.eventName = "PutDataLakeSettings")) }',
      ),
      'Cambio en los permisos de Lake Formation: el control de acceso a los datos se modificó.',
    );

    // ── El pipeline NO corrió ─────────────────────────────────────────────────
    // `treatMissingData: BREACHING` es el punto de toda la alarma: la ausencia de
    // datos ES la condición de falla. Con NOT_BREACHING (el default de las otras)
    // un scheduler roto no dispararía nada.
    const notRunAlarm = new cloudwatch.Alarm(this, 'PipelineDidNotRunAlarm', {
      alarmName: `${p}-pipeline-did-not-run`,
      alarmDescription:
        'El pipeline no registró ninguna ejecución en 24 h. Revisa la regla de ' +
        'EventBridge y el estado de la máquina de estados — no hay fallos porque ' +
        'no hubo intentos.',
      metric: props.stateMachine.metricStarted({
        period: cdk.Duration.days(1),
        statistic: 'Sum',
      }),
      threshold: 1,
      comparisonOperator: cloudwatch.ComparisonOperator.LESS_THAN_THRESHOLD,
      evaluationPeriods: 1,
      treatMissingData: cloudwatch.TreatMissingData.BREACHING,
    });
    notRunAlarm.addAlarmAction(alarmAction);

    // ── Fallos de Glue fuera del pipeline ─────────────────────────────────────
    // Por EventBridge y no por métrica: los jobs y crawlers pueden ejecutarse a mano
    // o por su propio cron, y en ese caso el catch del Step Functions no los ve.
    // Una métrica de Glue lleva JobRunId en las dimensiones, así que no se puede
    // alarmar por job de forma estable.
    new events.Rule(this, 'GlueJobFailureRule', {
      description: 'Fallo de un Glue Job del lake, venga de donde venga',
      eventPattern: {
        source: ['aws.glue'],
        detailType: ['Glue Job State Change'],
        detail: {
          state: ['FAILED', 'TIMEOUT', 'ERROR'],
          jobName: [{ prefix: `${p}-` }],
        },
      },
      targets: [new targets.SnsTopic(props.alertsTopic, {
        message: events.RuleTargetInput.fromText(
          `[${cfg.envName}] Glue Job ${events.EventField.fromPath('$.detail.jobName')} ` +
            `terminó en ${events.EventField.fromPath('$.detail.state')}: ` +
            `${events.EventField.fromPath('$.detail.message')}`,
        ),
      })],
    });

    new events.Rule(this, 'GlueCrawlerFailureRule', {
      description: 'Fallo de un Glue Crawler del lake',
      eventPattern: {
        source: ['aws.glue'],
        detailType: ['Glue Crawler State Change'],
        detail: {
          state: ['Failed'],
          crawlerName: [{ prefix: `${p}-` }],
        },
      },
      targets: [new targets.SnsTopic(props.alertsTopic, {
        message: events.RuleTargetInput.fromText(
          `[${cfg.envName}] Glue Crawler ${events.EventField.fromPath('$.detail.crawlerName')} ` +
            `falló: ${events.EventField.fromPath('$.detail.message')}`,
        ),
      })],
    });

    // ── Retención de los log groups que crea Glue: DELIBERADAMENTE fuera ──────
    // Glue escribe en `/aws-glue/jobs/output`, `/aws-glue/jobs/error` y
    // `/aws-glue/crawlers`, que crea el servicio en runtime y quedan SIN retención:
    // nunca expiran y se pagan para siempre.
    //
    // No se administran acá a propósito. Esos log groups son COMPARTIDOS A NIVEL DE
    // CUENTA entre todos los workloads Glue: si este stack les fijara retención,
    // estaría decidiendo sobre los logs de cualquier otro proyecto de la misma
    // cuenta — algo muy real con la estrategia de cuenta compartida. Es una tarea
    // operativa de cuenta, no de este data lake.
    //
    // El README lo deja como paso post-generación, con el comando exacto:
    //   aws logs put-retention-policy --log-group-name /aws-glue/jobs/output \
    //     --retention-in-days <N>
    //
    // Los log groups que este proyecto SÍ crea (Lambdas, Step Functions, trail, VPC
    // flow logs) llevan `retention` explícita desde `cfg.logRetentionDays`.

    // ── Dashboard ─────────────────────────────────────────────────────────────
    const dashboard = new cloudwatch.Dashboard(this, 'LakeDashboard', {
      dashboardName: `${p}-datalake`,
      defaultInterval: cdk.Duration.days(7),
    });

    const lakeMetric = (metricName: string, label: string) =>
      new cloudwatch.Metric({
        namespace: METRIC_NAMESPACE,
        metricName,
        statistic: 'Sum',
        period: cdk.Duration.hours(1),
        label,
        dimensionsMap: { Environment: cfg.envName, Source: 'ALL' },
      });

    dashboard.addWidgets(
      new cloudwatch.SingleValueWidget({
        title: 'Pipeline (últimos 7 días)',
        width: 24,
        metrics: [
          props.stateMachine.metricStarted({ statistic: 'Sum', label: 'Iniciadas' }),
          props.stateMachine.metricSucceeded({ statistic: 'Sum', label: 'Exitosas' }),
          props.stateMachine.metricFailed({ statistic: 'Sum', label: 'Fallidas' }),
          props.stateMachine.metricTimedOut({ statistic: 'Sum', label: 'Timeout' }),
        ],
      }),
    );
    dashboard.addWidgets(
      new cloudwatch.GraphWidget({
        title: 'Filas: Clean vs Cuarentena',
        width: 12,
        left: [lakeMetric('CleanRows', 'A Clean')],
        right: [lakeMetric('QuarantinedRows', 'En cuarentena')],
      }),
      new cloudwatch.GraphWidget({
        title: 'Duración del pipeline',
        width: 12,
        left: [props.stateMachine.metricTime({ statistic: 'Average', label: 'Promedio' })],
      }),
    );

    new cdk.CfnOutput(this, 'TrailBucketName', { value: trailBucket.bucketName });
    new cdk.CfnOutput(this, 'DashboardName', { value: dashboard.dashboardName });

    // ── cdk-nag: supresión con evidencia ────────────────────────────────────
    NagSuppressions.addResourceSuppressions(trailBucket, [
      {
        id: 'AwsSolutions-S1',
        reason:
          'Este ES el bucket de auditoría. Habilitarle server access logs exigiría un ' +
          'segundo bucket de logs que a su vez pediría lo mismo (recursión). El acceso ' +
          'al bucket queda registrado por los management events del propio trail, con ' +
          'validación de integridad y Object Lock activados.',
      },
    ]);
    // Nada más que suprimir en este stack: al dejar la retención de `/aws-glue/*`
    // como tarea de cuenta, desapareció el custom resource de `logs.LogRetention`
    // —y con él su Lambda, su rol y las dos supresiones que habría necesitado.
  }
}
