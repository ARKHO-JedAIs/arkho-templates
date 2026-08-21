import { Construct } from 'constructs';
import * as guardduty from 'aws-cdk-lib/aws-guardduty';
import { ParamsConfig } from '../stack/shared/util/env-config';

export interface GuardDutyConstructProps {
  params: ParamsConfig;
}

export class GuardDutyConstruct extends Construct {
  public readonly detector: guardduty.CfnDetector;
  public readonly detectorId: string;

  constructor(scope: Construct, id: string, props: GuardDutyConstructProps) {
    super(scope, id);

    this.detector = new guardduty.CfnDetector(this, 'Detector', {
      enable: true,
      findingPublishingFrequency: 'SIX_HOURS',
      features: [
        { name: 'S3_DATA_EVENTS', status: 'ENABLED' },
        { name: 'LAMBDA_NETWORK_LOGS', status: 'ENABLED' },
      ],
    });

    this.detectorId = this.detector.ref;
  }
}
