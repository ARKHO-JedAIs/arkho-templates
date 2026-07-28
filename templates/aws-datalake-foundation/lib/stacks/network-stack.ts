import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as ec2 from 'aws-cdk-lib/aws-ec2';

export interface NetworkStackProps extends cdk.StackProps {
  readonly vpcCidr: string;
}

/**
 * Stack opcional de red: VPC con subnets privadas + endpoints para S3 y Glue.
 *
 * Beneficios:
 * - Los Glue Jobs corren dentro de la VPC sin tráfico hacia internet.
 * - El gateway endpoint de S3 elimina cargos NAT para tráfico S3 (alto volumen).
 * - El interface endpoint de Glue elimina cargos NAT para el plano de control.
 * - Las Lambdas de ingesta pueden unirse a la VPC para conectar a RDS/SFTP internos.
 *
 * Habilitar: `cdk deploy -c enableVpc=true` (o configurado en cdk.json).
 */
export class NetworkStack extends cdk.Stack {
  public readonly vpc: ec2.Vpc;

  constructor(scope: Construct, id: string, props: NetworkStackProps) {
    super(scope, id, props);

    this.vpc = new ec2.Vpc(this, 'DataLakeVpc', {
      ipAddresses: ec2.IpAddresses.cidr(props.vpcCidr),
      maxAzs: 2,
      natGateways: 1,
      subnetConfiguration: [
        {
          name: 'private',
          subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS,
          cidrMask: 24,
        },
        {
          name: 'public',
          subnetType: ec2.SubnetType.PUBLIC,
          cidrMask: 28,
        },
      ],
    });

    // Gateway endpoint: tráfico S3 no pasa por NAT (ahorro significativo en datalakes)
    this.vpc.addGatewayEndpoint('S3GatewayEndpoint', {
      service: ec2.GatewayVpcEndpointAwsService.S3,
    });

    // Interface endpoint: plano de control Glue sin internet
    this.vpc.addInterfaceEndpoint('GlueEndpoint', {
      service: ec2.InterfaceVpcEndpointAwsService.GLUE,
      privateDnsEnabled: true,
    });

    // Interface endpoint: Secrets Manager para Lambdas en VPC
    this.vpc.addInterfaceEndpoint('SecretsManagerEndpoint', {
      service: ec2.InterfaceVpcEndpointAwsService.SECRETS_MANAGER,
      privateDnsEnabled: true,
    });

    new cdk.CfnOutput(this, 'VpcId', {
      value: this.vpc.vpcId,
      description: 'VPC del datalake',
    });
    new cdk.CfnOutput(this, 'PrivateSubnetIds', {
      value: this.vpc.privateSubnets.map(s => s.subnetId).join(','),
      description: 'Subnets privadas para Glue Jobs y Lambdas',
    });
  }
}
