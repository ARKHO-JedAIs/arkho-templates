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

    // CloudWatch Alarms y EventBridge deben poder publicar en el tópico cifrado
    for (const svc of ['cloudwatch.amazonaws.com', 'events.amazonaws.com']) {
      this.opsKey.grant(
        new iam.ServicePrincipal(svc),
        'kms:Decrypt',
        'kms:GenerateDataKey*',
      );
    }

    if (cfg.alertEmail) {
      this.alertsTopic.addSubscription(new subs.EmailSubscription(cfg.alertEmail));
    }

    new cdk.CfnOutput(this, 'AlertsTopicArn', { value: this.alertsTopic.topicArn });
  }
}
