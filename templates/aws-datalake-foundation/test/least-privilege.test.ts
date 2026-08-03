import * as cdk from 'aws-cdk-lib';
import { Template } from 'aws-cdk-lib/assertions';
import { getConfig } from '../lib/config/environments';
import { SecurityStack } from '../lib/stacks/security-stack';
import { StorageStack } from '../lib/stacks/storage-stack';
import { ProcessingStack } from '../lib/stacks/processing-stack';
import { IngestionStack } from '../lib/stacks/ingestion-stack';

/**
 * Guardas de mínimo privilegio. Los grants de IAM son fáciles de ampliar por
 * accidente en un refactor y el efecto no se nota hasta una auditoría.
 */
describe('mínimo privilegio en roles', () => {
  const app = new cdk.App();
  const cfg = getConfig('dev');
  const env = { account: cfg.account, region: cfg.region };

  const security = new SecurityStack(app, 'Sec', { env, config: cfg });
  const storage = new StorageStack(app, 'Sto', { env, config: cfg, dataKey: security.dataKey });
  const processing = new ProcessingStack(app, 'Proc', {
    env,
    config: cfg,
    rawBucket: storage.rawBucket,
    cleanBucket: storage.cleanBucket,
    curatedBucket: storage.curatedBucket,
    archiveBucket: storage.archiveBucket,
    dataKey: security.dataKey,
    opsKey: security.opsKey,
    alertsTopic: security.alertsTopic,
  });
  const ingestion = new IngestionStack(app, 'Ing', {
    env,
    config: cfg,
    rawBucket: storage.rawBucket,
    dataKey: security.dataKey,
    opsKey: security.opsKey,
    alertsTopic: security.alertsTopic,
  });

  const procTemplate = Template.fromStack(processing);
  const ingTemplate = Template.fromStack(ingestion);

  const allStatements = (t: Template) =>
    Object.values(t.findResources('AWS::IAM::Policy'))
      .flatMap((p) => p.Properties.PolicyDocument.Statement as any[]);

  test('el rol de Glue NO usa la managed policy AWSGlueServiceRole (glue:* sobre *)', () => {
    const roles = Object.values(procTemplate.findResources('AWS::IAM::Role'));
    const managed = roles.flatMap((r) => r.Properties.ManagedPolicyArns ?? []);
    const serialized = JSON.stringify(managed);
    expect(serialized).not.toContain('AWSGlueServiceRole');
  });

  test('ninguna policy de processing otorga glue:* ni un Action wildcard puro', () => {
    for (const stmt of allStatements(procTemplate)) {
      const actions: string[] = [].concat(stmt.Action ?? []);
      expect(actions).not.toContain('*');
      expect(actions).not.toContain('glue:*');
    }
  });

  test('lakeformation:GetDataAccess está otorgado (sin esto Glue no puede leer las zonas)', () => {
    const actions = allStatements(procTemplate)
      .flatMap((s) => [].concat(s.Action ?? []) as string[]);
    expect(actions).toContain('lakeformation:GetDataAccess');
  });

  test('las Lambdas de ingesta NO pueden borrar objetos de la Raw Zone', () => {
    const actions = allStatements(ingTemplate)
      .flatMap((s) => [].concat(s.Action ?? []) as string[]);
    expect(actions.filter((a) => /^s3:Delete/.test(a))).toHaveLength(0);
  });

  test('la ingesta tiene DLQ y alarmas conectadas al tópico de alertas', () => {
    ingTemplate.resourceCountIs('AWS::SQS::Queue', 1);
    // 2 alarmas de error (una por Lambda) + 1 de profundidad de DLQ
    ingTemplate.resourceCountIs('AWS::CloudWatch::Alarm', 3);
    const alarms = Object.values(ingTemplate.findResources('AWS::CloudWatch::Alarm'));
    for (const alarm of alarms) {
      expect(alarm.Properties.AlarmActions).toBeDefined();
      expect(alarm.Properties.AlarmActions.length).toBeGreaterThan(0);
    }
  });

  test('los log groups van cifrados con CMK', () => {
    for (const t of [procTemplate, ingTemplate]) {
      const groups = Object.values(t.findResources('AWS::Logs::LogGroup'));
      expect(groups.length).toBeGreaterThan(0);
      for (const g of groups) {
        expect(g.Properties.KmsKeyId).toBeDefined();
      }
    }
  });
});
