import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as glue from 'aws-cdk-lib/aws-glue';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as kms from 'aws-cdk-lib/aws-kms';
import * as lakeformation from 'aws-cdk-lib/aws-lakeformation';
import * as s3 from 'aws-cdk-lib/aws-s3';
import { NagSuppressions } from 'cdk-nag';
import {
  ANALYST_PRINCIPAL_ARN,
  CATALOG_ZONES,
  CatalogZone,
  DatalakeConfig,
  LF_TAG_DOMAINS,
  LF_TAG_SENSITIVITIES,
  catalogDb,
  prefix,
} from '../config/environments';

export interface GovernanceStackProps extends cdk.StackProps {
  readonly config: DatalakeConfig;
  readonly rawBucket: s3.IBucket;
  readonly cleanBucket: s3.IBucket;
  readonly curatedBucket: s3.IBucket;
  readonly archiveBucket: s3.IBucket;
  readonly athenaResultsBucket: s3.IBucket;
  readonly dataKey: kms.IKey;
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
  public readonly analystRole: iam.Role;

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
    // FGAC estricto: elimina el permiso por defecto "IAMAllowedPrincipals", que es
    // lo que convierte a Lake Formation en un control real en vez de decorativo.
    //
    // Viene ACTIVADO por defecto porque los grants que lo hacen viable ya existen:
    // el rol de Glue recibe sus permisos en ProcessingStack y el rol de analista más
    // abajo. Antes era opt-in justamente porque sin esos grants los crawlers del
    // propio proyecto se quedaban sin poder crear tablas.
    //
    // `-c lfStrictMode=false` desactiva el modo estricto si necesitas volver atrás.
    const lfStrictMode = this.node.tryGetContext('lfStrictMode') !== 'false';
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
    // Las claves van SUFIJADAS con el ambiente porque los LF-Tags son singletons
    // por cuenta+región, no por stack: con claves fijas, desplegar un segundo
    // ambiente en la misma cuenta falla con AlreadyExistsException a mitad del
    // deploy. El sufijo también aísla los grants FGAC — un grant de dev no puede
    // alcanzar datos de prod.
    const tagDominio = new lakeformation.CfnTag(this, 'LfTagDominio', {
      tagKey: `dominio_${cfg.envName}`,
      tagValues: LF_TAG_DOMAINS,
    });
    const tagSensibilidad = new lakeformation.CfnTag(this, 'LfTagSensibilidad', {
      tagKey: `sensibilidad_${cfg.envName}`,
      tagValues: LF_TAG_SENSITIVITIES,
    });
    if (settings) {
      tagDominio.addDependency(settings);
      tagSensibilidad.addDependency(settings);
    }

    // --- Registro de las zonas S3 como data locations de Lake Formation ---
    // Incluye Archive: sin registrarla, Lake Formation no puede gobernar el acceso a
    // los datos que se retienen por normativa, que es justo donde más importa.
    const buckets: [string, s3.IBucket][] = [
      ['Raw', props.rawBucket],
      ['Clean', props.cleanBucket],
      ['Curated', props.curatedBucket],
      ['Archive', props.archiveBucket],
    ];
    for (const [name, bucket] of buckets) {
      new lakeformation.CfnResource(this, `Register${name}Location`, {
        resourceArn: bucket.bucketArn,
        useServiceLinkedRole: true,
      });
    }

    // --- Asociación de LF-Tags a las bases ---
    // Los tags existían pero no estaban asociados a nada, así que la taxonomía era
    // una cáscara vacía: no se podía otorgar nada "por LF-Tag" porque ningún recurso
    // llevaba tag. Cada base queda etiquetada con su dominio y su sensibilidad por
    // defecto; el cliente refina a nivel de tabla y columna después.
    const domainDefault = LF_TAG_DOMAINS[0];
    // La zona menos procesada recibe la clasificación MÁS restrictiva: en Raw
    // todavía no se sabe qué contiene, así que se asume lo peor.
    const sensitivityStrict = LF_TAG_SENSITIVITIES[0];
    const sensitivityByZone: Record<CatalogZone, string> = {
      raw: sensitivityStrict,
      clean: sensitivityStrict,
      curated: LF_TAG_SENSITIVITIES[LF_TAG_SENSITIVITIES.length - 1],
    };

    for (const zone of CATALOG_ZONES) {
      const assoc = new lakeformation.CfnTagAssociation(this, `LfTagAssoc${zone}`, {
        resource: {
          database: { catalogId: this.account, name: catalogDb(cfg, zone) },
        },
        lfTags: [
          {
            catalogId: this.account,
            tagKey: tagDominio.tagKey,
            tagValues: [domainDefault],
          },
          {
            catalogId: this.account,
            tagKey: tagSensibilidad.tagKey,
            tagValues: [sensitivityByZone[zone]],
          },
        ],
      });
      // La asociación necesita que existan el tag y la base.
      assoc.addDependency(tagDominio);
      assoc.addDependency(tagSensibilidad);
      assoc.addDependency(this.databases[zone]);
    }

    // --- Rol de analista ---
    // Sin esto el WorkGroup de Athena no tenía ningún principal que pudiera usarlo.
    // Con `lfStrictMode` activo, este rol solo ve lo que Lake Formation le otorga.
    const trustPrincipal = ANALYST_PRINCIPAL_ARN
      ? new iam.ArnPrincipal(ANALYST_PRINCIPAL_ARN)
      : new iam.AccountRootPrincipal();
    this.analystRole = new iam.Role(this, 'AnalystRole', {
      roleName: `${prefix(cfg)}-analyst`,
      assumedBy: trustPrincipal,
      description:
        'Rol de consulta analítica: Athena + Lake Formation sobre datos no sensibles',
    });

    // Athena y el catálogo. El acceso a los DATOS no lo da IAM sino Lake Formation
    // (el grant por LF-Tag más abajo), así que estos permisos solos no alcanzan para
    // leer nada — que es exactamente el punto de FGAC.
    this.analystRole.addToPolicy(new iam.PolicyStatement({
      sid: 'AthenaQueryExecution',
      actions: [
        'athena:StartQueryExecution', 'athena:GetQueryExecution',
        'athena:GetQueryResults', 'athena:GetQueryResultsStream',
        'athena:StopQueryExecution', 'athena:GetWorkGroup',
        'athena:ListQueryExecutions', 'athena:BatchGetQueryExecution',
      ],
      resources: [
        `arn:${this.partition}:athena:${cfg.region}:${this.account}:workgroup/${prefix(cfg)}-analytics`,
      ],
    }));
    this.analystRole.addToPolicy(new iam.PolicyStatement({
      sid: 'GlueCatalogRead',
      actions: [
        'glue:GetDatabase', 'glue:GetDatabases', 'glue:GetTable', 'glue:GetTables',
        'glue:GetPartition', 'glue:GetPartitions', 'glue:BatchGetPartition',
      ],
      resources: [
        `arn:${this.partition}:glue:${cfg.region}:${this.account}:catalog`,
        ...CATALOG_ZONES.flatMap((zone) => [
          `arn:${this.partition}:glue:${cfg.region}:${this.account}:database/${catalogDb(cfg, zone)}`,
          `arn:${this.partition}:glue:${cfg.region}:${this.account}:table/${catalogDb(cfg, zone)}/*`,
        ]),
      ],
    }));
    this.analystRole.addToPolicy(new iam.PolicyStatement({
      sid: 'LakeFormationVendedCredentials',
      actions: ['lakeformation:GetDataAccess'],
      resources: ['*'], // la acción no admite recursos acotados
    }));
    // Resultados de las queries: leer los propios y escribir los nuevos.
    props.athenaResultsBucket.grantReadWrite(this.analystRole, 'results/*');
    props.dataKey.grantEncryptDecrypt(this.analystRole);

    // El grant que de verdad da acceso a datos: por LF-Tag, excluyendo la
    // clasificación más sensible. Es una expresión sobre tags, no una lista de
    // tablas, así que una tabla nueva queda cubierta sin tocar IaC.
    const nonSensitive = LF_TAG_SENSITIVITIES.filter((v) => v !== sensitivityStrict);
    if (nonSensitive.length > 0) {
      new lakeformation.CfnPrincipalPermissions(this, 'LfGrantAnalystNonSensitive', {
        principal: { dataLakePrincipalIdentifier: this.analystRole.roleArn },
        resource: {
          lfTagPolicy: {
            catalogId: this.account,
            resourceType: 'TABLE',
            expression: [
              { tagKey: tagSensibilidad.tagKey, tagValues: nonSensitive },
            ],
          },
        },
        permissions: ['SELECT', 'DESCRIBE'],
        permissionsWithGrantOption: [],
      });
    }

    new cdk.CfnOutput(this, 'AnalystRoleArn', { value: this.analystRole.roleArn });

    NagSuppressions.addResourceSuppressions(
      this.analystRole,
      [
        {
          id: 'AwsSolutions-IAM5',
          reason:
            'lakeformation:GetDataAccess no admite ARN de recurso. El resto son wildcards ' +
            'acotados al catálogo de este lake y al prefijo results/ del bucket de Athena; ' +
            'las tablas las crea el ETL en runtime y no se pueden enumerar en síntesis.',
          appliesTo: [
            'Resource::*',
            'Action::kms:ReEncrypt*', 'Action::kms:GenerateDataKey*',
            'Action::s3:GetObject*', 'Action::s3:GetBucket*', 'Action::s3:List*',
            'Action::s3:DeleteObject*', 'Action::s3:Abort*',
            { regex: '/^Resource::arn:.*:glue:.*:table\\/.*$/g' },
            { regex: '/^Resource::.*Bucket.*\\.Arn>\\/results\\/\\*$/g' },
          ],
        },
      ],
      true,
    );
  }
}
