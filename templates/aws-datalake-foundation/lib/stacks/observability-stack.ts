import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as cloudtrail from 'aws-cdk-lib/aws-cloudtrail';
import * as s3 from 'aws-cdk-lib/aws-s3';
import { DatalakeConfig } from '../config/environments';

export interface ObservabilityStackProps extends cdk.StackProps {
  readonly config: DatalakeConfig;
  readonly dataBuckets: s3.IBucket[];
}

/**
 * Auditoría para cumplimiento (normativa chilena de datos personales /
 * sector financiero): CloudTrail con data events sobre las zonas del lake
 * — quién accedió a qué objeto, cuándo y desde dónde (decisión v2: la
 * propuesta original solo cubría management events).
 *
 * Nota de costo: los data events S3 se cobran por evento (~USD 0.10 por
 * 100k). Con la volumetría del cliente el costo estimado es de pocos USD/mes.
 */
export class ObservabilityStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: ObservabilityStackProps) {
    super(scope, id, props);

    const trail = new cloudtrail.Trail(this, 'DataLakeTrail', {
      enableFileValidation: true,
      managementEvents: cloudtrail.ReadWriteType.ALL,
    });

    trail.addS3EventSelector(
      props.dataBuckets.map((bucket) => ({ bucket })),
      { readWriteType: cloudtrail.ReadWriteType.ALL },
    );
  }
}
