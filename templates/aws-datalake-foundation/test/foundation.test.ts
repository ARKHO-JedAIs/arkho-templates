import * as cdk from 'aws-cdk-lib';
import { Match, Template } from 'aws-cdk-lib/assertions';
import { CATALOG_ZONES, catalogDb, getConfig } from '../lib/config/environments';
import { buildEnv, buildStacks } from './helpers';

/**
 * Guardas de las capacidades que hacen la diferencia entre "un lake que despliega"
 * y "un lake fundacional": cuarentena, gobierno aplicado, alarmas que se notan,
 * mantenimiento de Iceberg y controles de cumplimiento.
 *
 * Cada test de acá corresponde a una brecha que existió y se cerró; si vuelve a
 * abrirse, el test la atrapa.
 */
describe('zona de cuarentena', () => {
  const { storage, processing } = buildEnv('Q', 'dev');
  const stoTemplate = Template.fromStack(storage);
  const procTemplate = Template.fromStack(processing);

  test('existe una quinta zona además de las 4 originales', () => {
    // 5 zonas + Athena results + access logs
    stoTemplate.resourceCountIs('AWS::S3::Bucket', 7);
    const names = Object.keys(stoTemplate.findResources('AWS::S3::Bucket'));
    expect(names.some((n) => n.startsWith('QuarantineZoneBucket'))).toBe(true);
  });

  test('el rol de Glue puede ESCRIBIR en cuarentena', () => {
    const actions = Object.values(procTemplate.findResources('AWS::IAM::Policy'))
      .flatMap((p) => p.Properties.PolicyDocument.Statement as any[])
      .flatMap((s) => [].concat(s.Action ?? []) as string[]);
    expect(actions.some((a) => /^s3:PutObject/.test(a))).toBe(true);
  });

  test('el job recibe el umbral del gate de calidad', () => {
    // El gate vive en el job y no en un Choice porque GlueStartJobRun con RUN_JOB
    // no devuelve la salida del job. Si el argumento desaparece, el job no arranca.
    const jobs = Object.values<any>(procTemplate.findResources('AWS::Glue::Job'));
    const rawToClean = jobs.find((j) =>
      j.Properties.DefaultArguments['--quarantine_bucket'] !== undefined);
    expect(rawToClean).toBeDefined();
    expect(rawToClean.Properties.DefaultArguments['--quarantine_gate_threshold']).toBeDefined();
  });

  test('hay alarma de volumen de cuarentena conectada a SNS', () => {
    const alarms = Object.values<any>(procTemplate.findResources('AWS::CloudWatch::Alarm'));
    const q = alarms.find((a) => a.Properties.MetricName === 'QuarantinedRows');
    expect(q).toBeDefined();
    expect(q.Properties.AlarmActions.length).toBeGreaterThan(0);
  });
});

describe('Iceberg: configuración y mantenimiento', () => {
  const { processing } = buildEnv('Ice', 'dev');
  const template = Template.fromStack(processing);
  const jobs = Object.values<any>(template.findResources('AWS::Glue::Job'));

  test('los jobs Iceberg reciben spark.sql.extensions por --conf', () => {
    // ESTE es el test que más importa de este archivo. `spark.sql.extensions` es
    // una conf ESTÁTICA de Spark: aplicarla con spark.conf.set() después de crear
    // la sesión no tiene efecto, así que MERGE INTO y los CALL system.* fallarían
    // en runtime mientras synth, tests y cdk-nag pasan en verde.
    const icebergJobs = jobs.filter(
      (j) => j.Properties.DefaultArguments['--datalake-formats'] === 'iceberg');
    expect(icebergJobs.length).toBeGreaterThanOrEqual(2); // curated + mantenimiento
    for (const job of icebergJobs) {
      // El valor lleva el nombre de un bucket de otro stack, así que CloudFormation
      // lo emite como Fn::Join y no como string plano: se serializa para inspeccionarlo.
      const conf = JSON.stringify(job.Properties.DefaultArguments['--conf']);
      expect(conf).toContain('spark.sql.extensions=');
      expect(conf).toContain('IcebergSparkSessionExtensions');
      expect(conf).toContain('spark.sql.catalog.glue_catalog=');
    }
  });

  test('existe el job de mantenimiento con su schedule', () => {
    const maintenance = jobs.find(
      (j) => j.Properties.DefaultArguments['--snapshot_retention_days'] !== undefined);
    expect(maintenance).toBeDefined();
    // Los bookmarks no aplican a un job que reescribe archivos existentes.
    expect(maintenance.Properties.DefaultArguments['--job-bookmark-option'])
      .toBe('job-bookmark-disable');
    // Se agenda con EventBridge Scheduler y su target universal, no con
    // events.Rule + AwsApi: ese último mete una Lambda intermedia solo para
    // invocar una API, con managed policy y wildcard de recurso.
    const schedules = Object.values<any>(
      template.findResources('AWS::Scheduler::Schedule'));
    expect(schedules).toHaveLength(1);
    expect(schedules[0].Properties.ScheduleExpression).toMatch(/^cron\(/);
    expect(JSON.stringify(schedules[0].Properties.Target.Arn))
      .toContain('aws-sdk:glue:startJobRun');
    // Cero Lambdas en processing: si vuelve a aparecer una, alguien reintrodujo un
    // target que necesita intermediario.
    template.resourceCountIs('AWS::Lambda::Function', 0);
  });
});

describe('sin capa de ingesta', () => {
  const { storage, processing, governance } = buildEnv('NoIng', 'dev');

  test('ningún stack crea Lambdas propias', () => {
    // La ingesta era el único origen de Lambdas. Si reaparece una acá, alguien
    // volvió a meter un productor concreto o un target que necesita intermediario.
    for (const stack of [storage, processing, governance]) {
      const fns = Object.entries<any>(
        Template.fromStack(stack).toJSON().Resources ?? {})
        .filter(([k, v]) => v.Type === 'AWS::Lambda::Function'
          && !k.startsWith('CustomS3AutoDeleteObjects'));
      expect(fns).toEqual([]);
    }
  });

  test('existe el rol de escritura de Raw, y es lo único que reemplaza la ingesta', () => {
    const t = Template.fromStack(storage);
    // Se excluye el rol del provider de autoDeleteObjects, que CDK crea solo en dev.
    const ours = Object.entries<any>(t.findResources('AWS::IAM::Role'))
      .filter(([k]) => !k.startsWith('CustomS3AutoDeleteObjects'));
    expect(ours).toHaveLength(1);
    expect(ours[0][1].Properties.RoleName).toMatch(/-ingest-writer$/);
    // Sin colas ni secretos: eran de la ingesta.
    t.resourceCountIs('AWS::SQS::Queue', 0);
    t.resourceCountIs('AWS::SecretsManager::Secret', 0);
  });
});

describe('crawlers', () => {
  const { cfg, processing } = buildEnv('Cr', 'dev');
  const crawlers = Object.values<any>(
    Template.fromStack(processing).findResources('AWS::Glue::Crawler'));

  test('hay un crawler por zona catalogada, incluida quarantine', () => {
    // Sin el de quarantine, los rechazos se escriben pero no se pueden consultar:
    // "revisá la cuarentena" significaría bajar Parquet de S3 a mano.
    const dbs = crawlers.map((c) => c.Properties.DatabaseName);
    expect(crawlers).toHaveLength(CATALOG_ZONES.length);
    for (const zone of CATALOG_ZONES) {
      expect(dbs).toContain(catalogDb(cfg, zone));
    }
  });

  test('ninguno usa Grouping: puede fusionar dos tablas en una del catálogo', () => {
    for (const c of crawlers) {
      expect(c.Properties.Configuration).not.toContain('CombineCompatibleSchemas');
    }
  });

  test('RecrawlPolicy solo en las zonas append-only', () => {
    // Fuerza updateBehavior/deleteBehavior a LOG, así que en una zona donde se
    // reescriben particiones dejaría el catálogo desactualizado para siempre.
    const byDb = Object.fromEntries(
      crawlers.map((c) => [c.Properties.DatabaseName, c.Properties.RecrawlPolicy]));
    expect(byDb[catalogDb(cfg, 'raw')]).toBeDefined();
    expect(byDb[catalogDb(cfg, 'clean')]).toBeDefined();
    expect(byDb[catalogDb(cfg, 'curated')]).toBeUndefined();
    expect(byDb[catalogDb(cfg, 'quarantine')]).toBeUndefined();
  });

  test('el crawler de curated usa IcebergTargets, no S3Targets', () => {
    // Un target S3 sobre la raíz del warehouse cataloga los directorios físicos
    // data/ y metadata/ como tablas basura.
    const curated = crawlers.find(
      (c) => c.Properties.DatabaseName === catalogDb(cfg, 'curated'));
    expect(curated.Properties.Targets.IcebergTargets).toBeDefined();
    expect(curated.Properties.Targets.S3Targets).toBeUndefined();
  });

  test('el crawler de clean excluye el scratch de Glue', () => {
    // --TempDir y --spark-event-logs-path apuntan al bucket de clean.
    const clean = crawlers.find(
      (c) => c.Properties.DatabaseName === catalogDb(cfg, 'clean'));
    const exclusions = clean.Properties.Targets.S3Targets[0].Exclusions;
    expect(exclusions).toEqual(expect.arrayContaining([
      expect.stringContaining('glue-temp'),
    ]));
  });
});

describe('gobierno aplicado, no solo declarado', () => {
  const { cfg, governance, processing } = buildEnv('Gv', 'dev');
  const govTemplate = Template.fromStack(governance);
  const procTemplate = Template.fromStack(processing);

  test('los LF-Tags están ASOCIADOS a las bases', () => {
    // Sin asociación los tags existen huérfanos y no se puede otorgar nada "por
    // LF-Tag" porque ningún recurso lleva tag.
    const assocs = Object.values<any>(
      govTemplate.findResources('AWS::LakeFormation::TagAssociation'));
    expect(assocs).toHaveLength(CATALOG_ZONES.length);
  });

  test('el rol de Glue tiene grants explícitos de Lake Formation', () => {
    // Con lfStrictMode activo (el default) se elimina IAMAllowedPrincipals. Sin
    // estos grants los crawlers de este mismo proyecto pierden CREATE_TABLE y el
    // deploy del segundo stack falla. Este test es la guarda de ese footgun.
    const grants = Object.values<any>(
      procTemplate.findResources('AWS::LakeFormation::PrincipalPermissions'));
    expect(grants.length).toBeGreaterThanOrEqual(CATALOG_ZONES.length);
    const dbGrants = grants.filter((g) => g.Properties.Resource.Database);
    for (const g of dbGrants) {
      expect(g.Properties.Permissions).toEqual(
        expect.arrayContaining(['CREATE_TABLE', 'ALTER']));
    }
  });

  test('existe un rol de analista y NO alcanza la clasificación más sensible', () => {
    // Sin este rol el WorkGroup de Athena no tenía ningún principal que lo usara.
    govTemplate.resourceCountIs('AWS::IAM::Role', 1);
    const grants = Object.values<any>(
      govTemplate.findResources('AWS::LakeFormation::PrincipalPermissions'));
    const byTag = grants.find((g) => g.Properties.Resource.LFTagPolicy);
    expect(byTag).toBeDefined();
    // El grant es por expresión de LF-Tag, así que una tabla nueva queda cubierta
    // sin tocar IaC — pero 'pii' nunca entra en los valores otorgados.
    const values = byTag.Properties.Resource.LFTagPolicy.Expression[0].TagValues;
    expect(values).not.toContain('pii');
    expect(byTag.Properties.Permissions).toEqual(expect.arrayContaining(['SELECT']));
  });

  test('las 4 zonas quedan registradas en Lake Formation, incluida Archive', () => {
    govTemplate.resourceCountIs('AWS::LakeFormation::Resource', 4);
  });

  test('las claves de LF-Tag llevan sufijo de ambiente', () => {
    const tags = Object.values<any>(govTemplate.findResources('AWS::LakeFormation::Tag'));
    for (const tag of tags) {
      expect(tag.Properties.TagKey).toMatch(new RegExp(`_${cfg.envName}$`));
    }
  });
});

describe('observabilidad operacional', () => {
  const { observability } = buildEnv('Ob', 'dev');
  const template = Template.fromStack(observability);

  test('hay alarma de "el pipeline NO corrió" con treatMissingData BREACHING', () => {
    // La guarda más importante del archivo. Con NOT_BREACHING, un scheduler roto o
    // una regla deshabilitada son indistinguibles del éxito: no hay fallos porque
    // no hubo intentos. Si alguien "arregla" esto volviéndolo notBreaching, falla.
    const alarms = Object.values<any>(template.findResources('AWS::CloudWatch::Alarm'));
    const notRun = alarms.find((a) => a.Properties.MetricName === 'ExecutionsStarted');
    expect(notRun).toBeDefined();
    expect(notRun.Properties.TreatMissingData).toBe('breaching');
    expect(notRun.Properties.ComparisonOperator).toBe('LessThanThreshold');
    expect(notRun.Properties.AlarmActions.length).toBeGreaterThan(0);
  });

  test('los fallos de Glue avisan aunque ocurran fuera del pipeline', () => {
    // Por EventBridge y no por métrica: un job o crawler ejecutado a mano o por su
    // propio cron no pasa por el catch del Step Functions.
    const rules = Object.values<any>(template.findResources('AWS::Events::Rule'));
    const jobRule = rules.find((r) =>
      r.Properties.EventPattern?.['detail-type']?.includes('Glue Job State Change'));
    const crawlerRule = rules.find((r) =>
      r.Properties.EventPattern?.['detail-type']?.includes('Glue Crawler State Change'));
    expect(jobRule).toBeDefined();
    expect(crawlerRule).toBeDefined();
    expect(jobRule.Properties.EventPattern.detail.state).toEqual(
      expect.arrayContaining(['FAILED', 'TIMEOUT']));
  });

  test('hay alarmas sobre el contenido del trail', () => {
    // Requiere la integración con CloudWatch Logs: sin ella no se puede alarmar
    // sobre lo que registra CloudTrail.
    expect(Object.keys(template.findResources('AWS::Logs::MetricFilter')).length)
      .toBeGreaterThanOrEqual(3);
  });

  test('existe dashboard', () => {
    template.resourceCountIs('AWS::CloudWatch::Dashboard', 1);
  });

  test('todo log group que el proyecto crea tiene retención explícita', () => {
    // Los grupos /aws-glue/* quedan fuera a propósito: son compartidos a nivel de
    // cuenta y fijarles retención desde acá decidiría sobre logs de otros proyectos.
    // Está documentado como paso post-generación.
    const groups = Object.values<any>(template.findResources('AWS::Logs::LogGroup'));
    expect(groups.length).toBeGreaterThan(0);
    for (const g of groups) {
      expect(g.Properties.RetentionInDays).toBeDefined();
    }
  });
});

describe('controles de cumplimiento', () => {
  test('Object Lock habilitado en Archive y en el bucket del trail', () => {
    const { storage, observability } = buildEnv('Cp', 'prod');
    const sto = Template.fromStack(storage);
    const archive = Object.entries<any>(sto.findResources('AWS::S3::Bucket'))
      .find(([k]) => k.startsWith('ArchiveZoneBucket'))![1];
    expect(archive.Properties.ObjectLockEnabled).toBe(true);

    const trail = Object.values<any>(
      Template.fromStack(observability).findResources('AWS::S3::Bucket'))[0];
    expect(trail.Properties.ObjectLockEnabled).toBe(true);
  });

  test('la regla de retención por defecto SOLO donde no hay auto-borrado', () => {
    // Con una regla por defecto, el custom resource que vacía el bucket en destroy
    // no puede borrar objetos bloqueados y el `cdk destroy` de dev quedaría colgado.
    //
    // Las configs se construyen A MANO y no con getConfig(): la regla también depende
    // de archiveRetentionYears, que es un valor elegido en la generación. Un test
    // basado en el valor bakeado pasaría en unos proyectos y fallaría en otros.
    const base = getConfig('prod');
    const findArchive = (id: string, cfg: typeof base) => {
      const { storage } = buildStacks(id, cfg);
      return Object.entries<any>(Template.fromStack(storage).findResources('AWS::S3::Bucket'))
        .find(([k]) => k.startsWith('ArchiveZoneBucket'))![1];
    };

    // autoDelete true → Object Lock habilitado pero SIN regla de retención.
    // `removalPolicy: DESTROY` va junto: CDK rechaza autoDeleteObjects con RETAIN.
    const autoDelete = findArchive('OlAuto', {
      ...base,
      autoDeleteObjects: true,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      archiveRetentionYears: 7,
    });
    expect(autoDelete.Properties.ObjectLockEnabled).toBe(true);
    expect(autoDelete.Properties.ObjectLockConfiguration?.Rule).toBeUndefined();

    // autoDelete false + retención > 0 → regla en modo GOVERNANCE
    const retained = findArchive('OlRet', {
      ...base, autoDeleteObjects: false, archiveRetentionYears: 7,
    });
    expect(retained.Properties.ObjectLockConfiguration?.Rule?.DefaultRetention?.Mode)
      .toBe('GOVERNANCE');
    expect(retained.Properties.ObjectLockConfiguration.Rule.DefaultRetention.Days)
      .toBe(7 * 365);

    // retención 0 (= sin expiración) → sin regla: un lock más largo que la
    // expiración del lifecycle impediría a S3 borrar para siempre.
    const noExpiry = findArchive('OlNoExp', {
      ...base, autoDeleteObjects: false, archiveRetentionYears: 0,
    });
    expect(noExpiry.Properties.ObjectLockEnabled).toBe(true);
    expect(noExpiry.Properties.ObjectLockConfiguration?.Rule).toBeUndefined();
  });

  test('se puede desactivar Object Lock por si el cliente no lo quiere', () => {
    const { storage } = buildEnv('NoLock', 'prod', { enableObjectLock: false });
    const archive = Object.entries<any>(
      Template.fromStack(storage).findResources('AWS::S3::Bucket'))
      .find(([k]) => k.startsWith('ArchiveZoneBucket'))![1];
    expect(archive.Properties.ObjectLockEnabled).toBeUndefined();
  });

  test('el trail es multi-región y va a CloudWatch Logs', () => {
    const { observability } = buildEnv('Tr', 'dev');
    Template.fromStack(observability).hasResourceProperties('AWS::CloudTrail::Trail', {
      IsMultiRegionTrail: true,
      EnableLogFileValidation: true,
      CloudWatchLogsLogGroupArn: Match.anyValue(),
    });
  });

  test('el rol de Glue NO puede borrar de la Archive Zone', () => {
    // grantWrite incluiría s3:DeleteObject*, lo que contradice el propósito de una
    // zona de retención normativa.
    const { processing, storage } = buildEnv('Ar', 'prod');
    const archiveLogicalId = Object.keys(
      Template.fromStack(storage).findResources('AWS::S3::Bucket'))
      .find((k) => k.startsWith('ArchiveZoneBucket'))!;
    const statements = Object.values<any>(
      Template.fromStack(processing).findResources('AWS::IAM::Policy'))
      .flatMap((p) => p.Properties.PolicyDocument.Statement as any[]);

    for (const stmt of statements) {
      const actions: string[] = [].concat(stmt.Action ?? []);
      if (!actions.some((a) => /^s3:DeleteObject/.test(a))) continue;
      // Si algún statement borra objetos, no puede alcanzar el bucket de Archive.
      const serialized = JSON.stringify(stmt.Resource ?? []);
      expect(serialized).not.toContain(archiveLogicalId);
    }
  });
});

describe('retención de logs por ambiente', () => {
  test('prod nunca baja de un año', () => {
    // Por debajo de eso no se sostiene una auditoría, sin importar lo que se haya
    // respondido en la generación.
    expect(getConfig('prod').logRetentionDays).toBeGreaterThanOrEqual(365);
  });
});
