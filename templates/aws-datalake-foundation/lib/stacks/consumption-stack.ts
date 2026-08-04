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
 * Capa de consumo: workgroup de Athena con configuración forzada, resultados
 * cifrados y corte de bytes escaneados (control de costos).
 *
 * Athena es el único motor que trae el template porque consulta directamente el
 * mismo S3 + Glue Data Catalog, sin infraestructura que provisionar ni migración.
 * Si más adelante necesitas BI o un warehouse, ambos operan sobre este catálogo:
 * QuickSight se suscribe por cuenta y apunta a este workgroup, y Redshift
 * Serverless o Spectrum leen las mismas tablas.
 *
 * El principal que puede usar el workgroup es el rol de analista de
 * `GovernanceStack`; el acceso a los DATOS lo otorga Lake Formation, no IAM.
 */
export class ConsumptionStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: ConsumptionStackProps) {
    super(scope, id, props);
    const cfg = props.config;
    const p = prefix(cfg);

    new athena.CfnWorkGroup(this, 'AnalyticsWorkGroup', {
      name: `${p}-analytics`,
      description: 'Workgroup analítico {{ client_name }} Data Lake',
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
