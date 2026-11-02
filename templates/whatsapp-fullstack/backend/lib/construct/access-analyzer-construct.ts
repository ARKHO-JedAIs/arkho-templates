import { Construct } from 'constructs';
import * as accessanalyzer from 'aws-cdk-lib/aws-accessanalyzer';
import { ParamsConfig } from '../stack/shared/util/env-config';

export interface AccessAnalyzerConstructProps {
  params: ParamsConfig;
}

export class AccessAnalyzerConstruct extends Construct {
  public readonly analyzer: accessanalyzer.CfnAnalyzer;

  constructor(scope: Construct, id: string, props: AccessAnalyzerConstructProps) {
    super(scope, id);

    const { params } = props;

    this.analyzer = new accessanalyzer.CfnAnalyzer(this, 'Analyzer', {
      analyzerName: `${params.projectName}-${params.envName}-access-analyzer`,
      type: 'ACCOUNT',
    });
  }
}
