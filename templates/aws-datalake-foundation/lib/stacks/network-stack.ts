import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as logs from 'aws-cdk-lib/aws-logs';

export interface NetworkStackProps extends cdk.StackProps {
  readonly vpcCidr: string;
  /** Política de retención del log group de flow logs (sigue al ambiente). */
  readonly removalPolicy: cdk.RemovalPolicy;
}

/**
 * Stack opcional de red: VPC con subnets privadas + endpoints para S3, Glue y
 * Secrets Manager.
 *
 * IMPORTANTE — esto es un BUILDING BLOCK, no una VPC ya conectada. Se despliega
 * por adelantado porque habilitarla después obliga a recrear recursos, pero
 * ningún recurso se le asocia automáticamente: los Glue Jobs, las Lambdas y un
 * eventual DMS siguen corriendo fuera de la VPC hasta que el equipo de
 * desarrollo los asocie explícitamente. Eso es intencional — se activa cuando
 * aparece la necesidad concreta (ingesta desde una red cerrada, RDS privado,
 * SFTP interno).
 *
 * Para conectar recursos más adelante, usando los outputs de este stack:
 * - Glue Jobs: crear un `glue.CfnConnection` tipo NETWORK con una subnet privada
 *   y su security group, y referenciarlo en `connections` del `CfnJob`.
 * - Lambdas: pasar `vpc` + `vpcSubnets` (SubnetType.PRIVATE_WITH_EGRESS) al
 *   construct `lambda.Function` en `IngestionStack`.
 * - DMS: usar `PrivateSubnetIds` para el replication subnet group.
 *
 * Costo mientras esté habilitada: 1 NAT Gateway (~USD 32/mes) + 2 interface
 * endpoints (~USD 14/mes). Si no hay un caso de uso a la vista, deja
 * `enableVpc=false`.
 *
 * Habilitar: `cdk deploy -c enableVpc=true` (o configurado en cdk.json).
 */
export class NetworkStack extends cdk.Stack {
  public readonly vpc: ec2.Vpc;

  /**
   * AZs fijas en lugar de resueltas por lookup. `ec2.Vpc` con `maxAzs` consulta
   * las AZs de la cuenta, lo que exige credenciales AWS incluso para un
   * `cdk synth` — rompe el synth en CI y en máquinas sin credenciales. Las dos
   * primeras AZs son deterministas y suficientes para este stack.
   */
  get availabilityZones(): string[] {
    return [`${this.region}a`, `${this.region}b`];
  }

  constructor(scope: Construct, id: string, props: NetworkStackProps) {
    super(scope, id, props);

    this.vpc = new ec2.Vpc(this, 'DataLakeVpc', {
      ipAddresses: ec2.IpAddresses.cidr(props.vpcCidr),
      availabilityZones: this.availabilityZones,
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

    // Flow logs: sin esto no hay forma de auditar qué salió de la red privada,
    // que es justamente el motivo por el que se habilita la VPC.
    this.vpc.addFlowLog('FlowLog', {
      destination: ec2.FlowLogDestination.toCloudWatchLogs(
        new logs.LogGroup(this, 'VpcFlowLogs', {
          retention: logs.RetentionDays.ONE_MONTH,
          removalPolicy: props.removalPolicy,
        }),
      ),
      trafficType: ec2.FlowLogTrafficType.ALL,
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
