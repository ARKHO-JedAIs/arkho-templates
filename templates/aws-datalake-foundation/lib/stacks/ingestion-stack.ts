import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as kms from 'aws-cdk-lib/aws-kms';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
import { NagSuppressions } from 'cdk-nag';
import { DatalakeConfig, prefix } from '../config/environments';

export interface IngestionStackProps extends cdk.StackProps {
  readonly config: DatalakeConfig;
  readonly rawBucket: s3.IBucket;
  readonly dataKey: kms.IKey;
  readonly opsKey: kms.IKey;
}

/**
 * Puerta de entrada al data lake.
 *
 * Este stack NO implementa la ingesta: solo entrega los dos elementos que sí son
 * fundacionales y que todo proceso de ingesta necesita, sea cual sea.
 *
 *   1. El ROL que tu proceso asume para escribir en la Raw Zone.
 *   2. El SECRETO donde cargas las credenciales de la base de datos origen.
 *
 * El productor en sí lo traes tú, y a propósito: la ingesta varía demasiado entre
 * proyectos (una API de terceros, SFTP, DMS, Kinesis, un job on-premise) para que una
 * implementación concreta sirva — sería código que borras. Lo que no varía es que
 * alguien necesita permiso de escritura y un lugar seguro para las credenciales.
 *
 * Layout que espera el ETL:
 *
 *     s3://<raw>/<fuente>/dt=YYYY-MM-DD/<archivo>
 *
 * `<fuente>` es lo que registras como `raw_prefix` en la tabla de configuración de
 * jobs, y `dt=` es la partición. Formatos soportados sin tocar código: JSON/NDJSON,
 * CSV y Parquet.
 */
export class IngestionStack extends cdk.Stack {
  /** Rol que asume el proceso de ingesta. */
  public readonly writerRole: iam.Role;
  /** Secreto con las credenciales de la base de datos origen. */
  public readonly sourceDbSecret: secretsmanager.Secret;

  constructor(scope: Construct, id: string, props: IngestionStackProps) {
    super(scope, id, props);
    const cfg = props.config;
    const p = prefix(cfg);

    // Re-importados para que los grants se apliquen solo a las identity policies de
    // este stack: modificar la key policy (que vive en SecurityStack) crearía un
    // ciclo de dependencias entre stacks.
    const dataKey = kms.Key.fromKeyArn(this, 'DataKeyRef', props.dataKey.keyArn);
    const opsKey = kms.Key.fromKeyArn(this, 'OpsKeyRef', props.opsKey.keyArn);
    const rawBucket = s3.Bucket.fromBucketAttributes(this, 'RawRef', {
      bucketArn: props.rawBucket.bucketArn,
      encryptionKey: dataKey,
    });

    // --- Credenciales de la base de datos origen ---
    // Se crea vacío con la forma esperada y una contraseña aleatoria de relleno:
    // carga los valores reales post-deploy. Las claves son las que AWS usa por
    // convención para credenciales de base de datos, así que DMS, Glue connections y
    // los SDK las reconocen sin traducción.
    //
    // Cifrado con la ops key (secretos, colas y tópicos), no con la data key.
    this.sourceDbSecret = new secretsmanager.Secret(this, 'SourceDbSecret', {
      secretName: `${p}/source-db`,
      description:
        'Credenciales de la base de datos origen de la ingesta — cargar valores reales',
      encryptionKey: opsKey,
      // Sigue al ambiente: en prod un `destroy` no se lleva las credenciales.
      removalPolicy: cfg.removalPolicy,
      generateSecretString: {
        secretStringTemplate: JSON.stringify({
          engine: '',
          host: '',
          port: '',
          dbname: '',
          username: '',
        }),
        generateStringKey: 'password',
      },
    });

    // --- Rol de escritura de la Raw Zone ---
    // Único camino de entrada al lake. Por defecto lo asume la cuenta root; acótalo
    // al principal real con `-c ingestPrincipalArn=arn:aws:iam::<cuenta>:role/<x>`.
    const ingestPrincipalArn = (
      this.node.tryGetContext('ingestPrincipalArn') as string | undefined
    )?.trim();
    this.writerRole = new iam.Role(this, 'IngestWriterRole', {
      roleName: `${p}-ingest-writer`,
      assumedBy: ingestPrincipalArn
        ? new iam.ArnPrincipal(ingestPrincipalArn)
        : new iam.AccountRootPrincipal(),
      description:
        'Rol que asume el proceso de ingesta: escribe en la Raw Zone y lee el secreto',
    });

    // `grantPut` y NO `grantWrite`: este último incluye `s3:DeleteObject*`, y un
    // productor no tiene por qué poder borrar lo que ya aterrizó en el lake.
    rawBucket.grantPut(this.writerRole);
    dataKey.grantEncrypt(this.writerRole);
    this.sourceDbSecret.grantRead(this.writerRole);

    new cdk.CfnOutput(this, 'IngestWriterRoleArn', {
      value: this.writerRole.roleArn,
      description: 'Rol a asumir por el proceso de ingesta',
    });
    new cdk.CfnOutput(this, 'SourceDbSecretArn', {
      value: this.sourceDbSecret.secretArn,
      description: 'Secreto donde cargar las credenciales de la base origen',
    });

    // ── cdk-nag: supresiones con evidencia ──────────────────────────────────
    NagSuppressions.addResourceSuppressions(this.sourceDbSecret, [
      {
        id: 'AwsSolutions-SMG4',
        reason:
          'Credenciales de una base de datos que el template no administra. Secrets ' +
          'Manager no puede rotarlas sin una Lambda de rotación específica del motor y ' +
          'con acceso de red al origen; rotarlas a ciegas rompería la conexión. La ' +
          'renovación es un procedimiento del dueño de esa base.',
      },
    ]);

    NagSuppressions.addResourceSuppressions(
      this.writerRole,
      [
        {
          id: 'AwsSolutions-IAM5',
          reason:
            'Wildcards de los grants de CDK sobre la Raw Zone y la data key: el objeto ' +
            'concreto que escribe la ingesta no se conoce en síntesis. El rol NO tiene ' +
            'ninguna acción de borrado.',
          appliesTo: [
            'Action::s3:Abort*',
            'Action::kms:ReEncrypt*', 'Action::kms:GenerateDataKey*',
            { regex: '/^Resource::.*RawZoneBucket.*\\.Arn>\\/\\*$/g' },
          ],
        },
      ],
      true,
    );
  }
}
