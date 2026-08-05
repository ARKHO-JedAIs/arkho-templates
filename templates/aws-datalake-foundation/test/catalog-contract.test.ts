import { Template } from 'aws-cdk-lib/assertions';
import { CATALOG_ZONES, DEFAULT_ENV, catalogDb } from '../lib/config/environments';
import { buildEnv } from './helpers';

/**
 * El contrato más frágil del proyecto: los crawlers de ProcessingStack
 * referencian las bases de datos de GovernanceStack por NOMBRE (string), no por
 * Ref de CloudFormation. Si las dos fórmulas se separan, los crawlers corren
 * "con éxito" contra una base inexistente y no escriben nada.
 *
 * Estos tests fallan si alguien cambia una de las dos puntas.
 */
describe('contrato catálogo Glue: governance ↔ processing', () => {
  const { cfg, governance, processing } = buildEnv('Cc', DEFAULT_ENV);

  const govTemplate = Template.fromStack(governance);
  const procTemplate = Template.fromStack(processing);

  const declaredDbs = Object.values(govTemplate.findResources('AWS::Glue::Database'))
    .map((r) => r.Properties.DatabaseInput.Name as string);
  const referencedDbs = Object.values(procTemplate.findResources('AWS::Glue::Crawler'))
    .map((r) => r.Properties.DatabaseName as string);

  test('governance crea una base por zona, con los nombres de catalogDb()', () => {
    // Derivado de CATALOG_ZONES: agregar una zona no debería obligar a editar este
    // test, pero sí debería fallar si governance deja de crear alguna.
    expect(declaredDbs.sort()).toEqual(
      CATALOG_ZONES.map((z) => catalogDb(cfg, z)).sort(),
    );
  });

  test('cada base referenciada por un crawler existe en governance', () => {
    expect(referencedDbs.length).toBeGreaterThan(0);
    for (const db of referencedDbs) {
      expect(declaredDbs).toContain(db);
    }
  });

  test('los crawlers usan la security configuration (logs cifrados)', () => {
    const crawlers = Object.values(procTemplate.findResources('AWS::Glue::Crawler'));
    for (const crawler of crawlers) {
      expect(crawler.Properties.CrawlerSecurityConfiguration).toBeDefined();
    }
  });
});
