import * as cdk from 'aws-cdk-lib';
import { Template } from 'aws-cdk-lib/assertions';
import { catalogDb, getConfig } from '../lib/config/environments';
import { SecurityStack } from '../lib/stacks/security-stack';
import { StorageStack } from '../lib/stacks/storage-stack';
import { GovernanceStack } from '../lib/stacks/governance-stack';
import { ProcessingStack } from '../lib/stacks/processing-stack';

/**
 * El contrato más frágil del proyecto: los crawlers de ProcessingStack
 * referencian las bases de datos de GovernanceStack por NOMBRE (string), no por
 * Ref de CloudFormation. Si las dos fórmulas se separan, los crawlers corren
 * "con éxito" contra una base inexistente y no escriben nada.
 *
 * Estos tests fallan si alguien cambia una de las dos puntas.
 */
describe('contrato catálogo Glue: governance ↔ processing', () => {
  const app = new cdk.App();
  const cfg = getConfig('dev');
  const env = { account: '111111111111', region: cfg.region };

  const security = new SecurityStack(app, 'TestSecurity', { env, config: cfg });
  const storage = new StorageStack(app, 'TestStorage', {
    env, config: cfg, dataKey: security.dataKey,
  });
  const governance = new GovernanceStack(app, 'TestGovernance', {
    env,
    config: cfg,
    rawBucket: storage.rawBucket,
    cleanBucket: storage.cleanBucket,
    curatedBucket: storage.curatedBucket,
  });
  const processing = new ProcessingStack(app, 'TestProcessing', {
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

  const govTemplate = Template.fromStack(governance);
  const procTemplate = Template.fromStack(processing);

  const declaredDbs = Object.values(govTemplate.findResources('AWS::Glue::Database'))
    .map((r) => r.Properties.DatabaseInput.Name as string);
  const referencedDbs = Object.values(procTemplate.findResources('AWS::Glue::Crawler'))
    .map((r) => r.Properties.DatabaseName as string);

  test('governance crea una base por zona, con los nombres de catalogDb()', () => {
    expect(declaredDbs.sort()).toEqual(
      [catalogDb(cfg, 'raw'), catalogDb(cfg, 'clean'), catalogDb(cfg, 'curated')].sort(),
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
