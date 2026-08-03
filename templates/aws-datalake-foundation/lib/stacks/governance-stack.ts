import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as glue from 'aws-cdk-lib/aws-glue';
import * as lakeformation from 'aws-cdk-lib/aws-lakeformation';
import * as s3 from 'aws-cdk-lib/aws-s3';
import {
  CatalogZone,
  DatalakeConfig,
  LF_TAG_DOMAINS,
  LF_TAG_SENSITIVITIES,
  catalogDb,
} from '../config/environments';

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
 *
 * Al registrar las zonas como data locations, el acceso de Glue/Athena pasa a
 * ser vendido por Lake Formation: los roles que leen datos necesitan
 * `lakeformation:GetDataAccess` (ver `ProcessingStack`) y el rol de servicio de
 * Lake Formation necesita permiso sobre la CMK (ver `SecurityStack`).
 */
export class GovernanceStack extends cdk.Stack {
  public readonly databases: Record<'raw' | 'clean' | 'curated', glue.CfnDatabase>;

  constructor(scope: Construct, id: string, props: GovernanceStackProps) {
    super(scope, id, props);
    const cfg = props.config;

    // --- Catálogo técnico: una base de datos por zona ---
    // El nombre viene de `catalogDb()`: los crawlers de ProcessingStack
    // referencian estas bases por nombre, así que la fórmula vive en un solo lugar.
    const mkDb = (zone: CatalogZone, description: string) =>
      new glue.CfnDatabase(this, `${zone.charAt(0).toUpperCase()}${zone.slice(1)}Db`, {
        catalogId: this.account,
        databaseInput: {
          name: catalogDb(cfg, zone),
          description,
        },
      });

    this.databases = {
      raw: mkDb('raw', 'Datos originales tal como llegan de las fuentes de ingesta'),
      clean: mkDb('clean', 'Datos validados y estandarizados'),
      curated: mkDb('curated', 'Datos en Iceberg/Parquet optimizados para consumo analítico'),
    };

    // --- Admin de Lake Formation (opcional, vía contexto) ---
    const lfAdminArn = this.node.tryGetContext('lfAdminArn') as string | undefined;
    // FGAC estricto: elimina el permiso por defecto "IAMAllowedPrincipals".
    // OJO: al activarlo, TODO principal necesita un grant explícito de Lake
    // Formation — incluidos los crawlers de este mismo proyecto, que dejarán de
    // poder crear tablas hasta que les otorgues CREATE_TABLE/ALTER sobre estas
    // bases (ver README, sección Lake Formation). Por eso es opt-in.
    const lfStrictMode = this.node.tryGetContext('lfStrictMode') === 'true';
    let settings: lakeformation.CfnDataLakeSettings | undefined;
    if (lfAdminArn) {
      settings = new lakeformation.CfnDataLakeSettings(this, 'DataLakeSettings', {
        admins: [{ dataLakePrincipalIdentifier: lfAdminArn }],
        ...(lfStrictMode
          ? { createDatabaseDefaultPermissions: [], createTableDefaultPermissions: [] }
          : {}),
      });
    }

    // --- LF-Tags: taxonomía de dominio y sensibilidad (parametrizada) ---
    const tagDominio = new lakeformation.CfnTag(this, 'LfTagDominio', {
      tagKey: 'dominio',
      tagValues: LF_TAG_DOMAINS,
    });
    const tagSensibilidad = new lakeformation.CfnTag(this, 'LfTagSensibilidad', {
      tagKey: 'sensibilidad',
      tagValues: LF_TAG_SENSITIVITIES,
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
