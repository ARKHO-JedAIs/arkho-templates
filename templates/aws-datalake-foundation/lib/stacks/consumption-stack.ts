import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as athena from 'aws-cdk-lib/aws-athena';
import * as kms from 'aws-cdk-lib/aws-kms';
import * as s3 from 'aws-cdk-lib/aws-s3';
import { DatalakeConfig, prefix } from '../config/environments';

export interface ConsumptionStackProps extends cdk.StackProps {
  readonly config: DatalakeConfig;
  readonly athenaResultsBucket: s3.IBucket;
  readonly dataKey: kms.IKey;
}

/**
 * Capa de consumo Fase 1: workgroup de Athena con configuración forzada,
 * resultados cifrados y corte de bytes escaneados (control de costos).
 *
 * QuickSight se habilita manualmente (suscripción por cuenta) apuntando a
 * este workgroup. Redshift Serverless queda para Fase 2 — sin migración,
 * opera sobre el mismo S3 + Glue Data Catalog.
 */
export class ConsumptionStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: ConsumptionStackProps) {
    super(scope, id, props);
    const cfg = props.config;
    const p = prefix(cfg);

    new athena.CfnWorkGroup(this, 'AnalyticsWorkGroup', {
      name: `${p}-analytics`,
      description: 'Workgroup analítico {{ client_name }} Data Lake (marketing y operaciones)',
      recursiveDeleteOption: cfg.autoDeleteObjects,
      workGroupConfiguration: {
        enforceWorkGroupConfiguration: true,
        publishCloudWatchMetricsEnabled: true,
        bytesScannedCutoffPerQuery: cfg.athenaBytesCutoff,
        engineVersion: { selectedEngineVersion: 'AUTO' },
        resultConfiguration: {
          outputLocation: `s3://${props.athenaResultsBucket.bucketName}/results/`,
          encryptionConfiguration: {
            encryptionOption: 'SSE_KMS',
            kmsKey: props.dataKey.keyArn,
          },
        },
      },
    });
  }
}
