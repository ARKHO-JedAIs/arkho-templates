import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as glue from 'aws-cdk-lib/aws-glue';
import * as lakeformation from 'aws-cdk-lib/aws-lakeformation';
import * as s3 from 'aws-cdk-lib/aws-s3';
import { DatalakeConfig } from '../config/environments';

export interface GovernanceStackProps extends cdk.StackProps {
  readonly config: DatalakeConfig;
  readonly rawBucket: s3.IBucket;
  readonly cleanBucket: s3.IBucket;
  readonly curatedBucket: s3.IBucket;
}

/**
 * Gobierno de datos: Glue Data Catalog (fuente única de verdad),
 * LF-Tags por dominio y sensibilidad, y registro de las zonas S3
 * en Lake Formation.
 *
 * NOTA OPERACIONAL: el principal que despliega debe ser administrador de
 * Lake Formation. Opcionalmente pasa `-c lfAdminArn=arn:aws:iam::...:role/...`
 * para registrar el admin vía IaC. Los permisos FGAC (grants por LF-Tag a
 * roles de analistas) se gestionan luego desde SageMaker Unified Studio o
 * con CfnPrincipalPermissions adicionales.
 */
export class GovernanceStack extends cdk.Stack {
  public readonly databases: Record<'raw' | 'clean' | 'curated', glue.CfnDatabase>;

  constructor(scope: Construct, id: string, props: GovernanceStackProps) {
    super(scope, id, props);
    const cfg = props.config;

    // --- Catálogo técnico: una base de datos por zona ---
    const mkDb = (zone: string, description: string) =>
      new glue.CfnDatabase(this, `${zone}Db`, {
        catalogId: this.account,
        databaseInput: {
          name: `{{ catalog_prefix }}_${cfg.envName}_${zone.toLowerCase()}`,
          description,
        },
      });

    this.databases = {
      raw: mkDb('Raw', 'Datos originales tal como llegan de las fuentes (SFTP, GA4, Meta)'),
      clean: mkDb('Clean', 'Datos validados y estandarizados'),
      curated: mkDb('Curated', 'Datos en Iceberg/Parquet optimizados para consumo analítico'),
    };

    // --- Admin de Lake Formation (opcional, vía contexto) ---
    const lfAdminArn = this.node.tryGetContext('lfAdminArn') as string | undefined;
    let settings: lakeformation.CfnDataLakeSettings | undefined;
    if (lfAdminArn) {
      settings = new lakeformation.CfnDataLakeSettings(this, 'DataLakeSettings', {
        admins: [{ dataLakePrincipalIdentifier: lfAdminArn }],
        // Elimina los permisos "IAMAllowedPrincipals" por defecto: FGAC real
        createDatabaseDefaultPermissions: [],
        createTableDefaultPermissions: [],
      });
    }

    // --- LF-Tags: taxonomía de dominio y sensibilidad (normativa chilena) ---
    const tagDominio = new lakeformation.CfnTag(this, 'LfTagDominio', {
      tagKey: 'dominio',
      tagValues: ['marketing', 'operaciones', 'finanzas'],
    });
    const tagSensibilidad = new lakeformation.CfnTag(this, 'LfTagSensibilidad', {
      tagKey: 'sensibilidad',
      tagValues: ['pii', 'interno', 'publico'],
    });
    if (settings) {
      tagDominio.addDependency(settings);
      tagSensibilidad.addDependency(settings);
    }

    // --- Registro de las zonas S3 como data locations de Lake Formation ---
    const buckets: [string, s3.IBucket][] = [
      ['Raw', props.rawBucket],
      ['Clean', props.cleanBucket],
      ['Curated', props.curatedBucket],
    ];
    for (const [name, bucket] of buckets) {
      new lakeformation.CfnResource(this, `Register${name}Location`, {
        resourceArn: bucket.bucketArn,
        useServiceLinkedRole: true,
      });
    }
  }
}
