import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as kms from 'aws-cdk-lib/aws-kms';
import * as sns from 'aws-cdk-lib/aws-sns';
import * as subs from 'aws-cdk-lib/aws-sns-subscriptions';
import { DatalakeConfig, prefix } from '../config/environments';

export interface SecurityStackProps extends cdk.StackProps {
  readonly config: DatalakeConfig;
}

/**
 * Fundaciones de seguridad: 2 CMKs (datos / operación) y tópico de alertas.
 * Decisión v2: 2 CMKs en lugar de 5 — una para datos del lake, otra para
 * secretos, colas y tópicos operacionales.
 */
export class SecurityStack extends cdk.Stack {
  public readonly dataKey: kms.Key;
  public readonly opsKey: kms.Key;
  public readonly alertsTopic: sns.Topic;

  constructor(scope: Construct, id: string, props: SecurityStackProps) {
    super(scope, id, props);
    const cfg = props.config;
    const p = prefix(cfg);

    this.dataKey = new kms.Key(this, 'DataKey', {
      alias: `alias/${p}-data`,
      description: 'CMK para datos del Data Lake de {{ client_name }} (S3, DynamoDB, Glue, Athena)',
      enableKeyRotation: true,
      removalPolicy: cfg.removalPolicy,
    });

    this.opsKey = new kms.Key(this, 'OpsKey', {
      alias: `alias/${p}-ops`,
      description: 'CMK operacional {{ client_name }} (Secrets Manager, SNS, SQS)',
      enableKeyRotation: true,
      removalPolicy: cfg.removalPolicy,
    });

    this.alertsTopic = new sns.Topic(this, 'AlertsTopic', {
      topicName: `${p}-alerts`,
      displayName: 'Alertas operacionales {{ client_name }} Data Lake',
      masterKey: this.opsKey,
      enforceSSL: true,
    });

    // CloudWatch Alarms debe poder publicar en el tópico cifrado.
    // `aws:SourceAccount` evita el problema del "confused deputy": limita el uso
    // de la key a recursos de esta misma cuenta.
    this.opsKey.addToResourcePolicy(new iam.PolicyStatement({
      principals: [new iam.ServicePrincipal('cloudwatch.amazonaws.com')],
      actions: ['kms:Decrypt', 'kms:GenerateDataKey*'],
      resources: ['*'],
      conditions: { StringEquals: { 'aws:SourceAccount': this.account } },
    }));

    // Los log groups de Glue y Step Functions van cifrados con la data key, así
    // que CloudWatch Logs necesita poder usarla. La condición de contexto de
    // cifrado la acota a log groups de esta cuenta y región.
    this.dataKey.addToResourcePolicy(new iam.PolicyStatement({
      sid: 'AllowCloudWatchLogsEncryption',
      principals: [new iam.ServicePrincipal(`logs.${cfg.region}.amazonaws.com`)],
      actions: [
        'kms:Encrypt*', 'kms:Decrypt*', 'kms:ReEncrypt*',
        'kms:GenerateDataKey*', 'kms:Describe*',
      ],
      resources: ['*'],
      conditions: {
        ArnLike: {
          'kms:EncryptionContext:aws:logs:arn':
            `arn:${this.partition}:logs:${cfg.region}:${this.account}:log-group:*`,
        },
      },
    }));

    // Lake Formation vende credenciales para leer las zonas cifradas del lake.
    // Su rol de servicio necesita estar en la KEY POLICY (no basta una identity
    // policy) o toda lectura vía LF/Athena falla con AccessDenied en KMS.
    this.dataKey.addToResourcePolicy(new iam.PolicyStatement({
      sid: 'AllowLakeFormationServiceRole',
      principals: [
        new iam.ArnPrincipal(
          `arn:${this.partition}:iam::${this.account}:role/aws-service-role/` +
            'lakeformation.amazonaws.com/AWSServiceRoleForLakeFormationDataAccess',
        ),
      ],
      actions: ['kms:Decrypt', 'kms:DescribeKey', 'kms:GenerateDataKey*'],
      resources: ['*'],
    }));

    if (cfg.alertEmail) {
      this.alertsTopic.addSubscription(new subs.EmailSubscription(cfg.alertEmail));
    }

    new cdk.CfnOutput(this, 'AlertsTopicArn', { value: this.alertsTopic.topicArn });
  }
}
