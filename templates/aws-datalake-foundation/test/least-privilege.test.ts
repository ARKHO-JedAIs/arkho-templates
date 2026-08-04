import { Template } from 'aws-cdk-lib/assertions';
import { buildEnv } from './helpers';

/**
 * Guardas de mínimo privilegio. Los grants de IAM son fáciles de ampliar por
 * accidente en un refactor y el efecto no se nota hasta una auditoría.
 */
describe('mínimo privilegio en roles', () => {
  const { processing, storage, governance } = buildEnv('Lp', 'dev');

  const procTemplate = Template.fromStack(processing);
  const stoTemplate = Template.fromStack(storage);
  const govTemplate = Template.fromStack(governance);

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

  test('el rol de escritura de Raw puede PONER objetos pero NO borrarlos', () => {
    // Es el único camino de entrada al lake ahora que no hay stack de ingesta. Un
    // productor no tiene por qué poder borrar lo que ya aterrizó, así que se usa
    // `grantPut` y no `grantWrite` — que incluiría `s3:DeleteObject*`.
    const actions = allStatements(stoTemplate)
      .flatMap((s) => [].concat(s.Action ?? []) as string[]);
    expect(actions.some((a) => /^s3:PutObject/.test(a))).toBe(true);
    expect(actions.filter((a) => /^s3:Delete/.test(a))).toHaveLength(0);
  });

  test('el rol de analista no tiene permisos de escritura sobre las zonas', () => {
    // El acceso a datos lo otorga Lake Formation, no IAM. Si acá apareciera un
    // PutObject sobre una zona, el rol de consumo dejaría de ser de solo lectura.
    const zoneWrites = allStatements(govTemplate)
      .flatMap((s) => [].concat(s.Action ?? []) as string[])
      .filter((a) => /^s3:(Put|Delete)Object/.test(a));
    // El único write permitido es sobre el prefijo results/ de Athena.
    const resources = JSON.stringify(
      allStatements(govTemplate)
        .filter((s) => [].concat(s.Action ?? []).some((a: string) => /^s3:PutObject/.test(a)))
        .map((s) => s.Resource),
    );
    if (zoneWrites.length > 0) expect(resources).toContain('results/');
  });

  test('los log groups van cifrados con CMK', () => {
    const groups = Object.values(procTemplate.findResources('AWS::Logs::LogGroup'));
    expect(groups.length).toBeGreaterThan(0);
    for (const g of groups) {
      expect(g.Properties.KmsKeyId).toBeDefined();
    }
  });
});
