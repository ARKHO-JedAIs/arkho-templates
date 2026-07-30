# {{ client_name }} — AWS Data Lake Foundation (CDK v2, TypeScript)

Foundational AWS Data Lake as Infrastructure as Code. Serverless architecture:
4 S3 zones (Raw / Clean / Curated in Apache Iceberg / Archive in Glacier),
Glue ETL orchestrated by Step Functions, native governance with Lake Formation +
Glue Data Catalog, KMS encryption end-to-end, CloudTrail auditing for compliance,
and optional VPC isolation.

## Stacks

| Stack | Condición | Contenido |
|---|---|---|
| `network` | opcional (`enableVpc=true`) | VPC, subnets privadas, NAT Gateway, gateway endpoint S3, interface endpoints Glue + Secrets Manager |
| `security` | siempre | 2 KMS CMKs (data / ops), SNS topic de alertas |
| `storage` | siempre | S3: Raw (lifecycle → Glacier IR a {{ raw_retention_days }}d), Clean, Curated, Archive (Glacier IR, expira a {{ archive_retention_years }} años), Athena results, access logs |
| `governance` | siempre | Glue Databases por zona, LF-Tags (dominio, sensibilidad), registro Lake Formation |
| `ingestion` | opcional (`enableIngestionLambdas=true`) | Lambdas (Node 20, ARM64), Secrets Manager, DLQ, schedules EventBridge, SFTP Connector opcional |
| `processing` | siempre | Glue Jobs Python (auto-scaling, SSE-KMS, bookmarks), Crawlers, DynamoDB config, Step Functions con reintentos + alarma SNS |
| `consumption` | siempre | Athena WorkGroup (config forzada, bytes-scanned cutoff, resultados cifrados) |
| `observability` | siempre | CloudTrail con data events sobre las 4 zonas (cumplimiento normativo) |

## Requisitos

- Node.js 20+, AWS CLI configurado
- Bootstrap de cuenta/región: `npx cdk bootstrap aws://{{ aws_account_id }}/{{ aws_region }}`
- Para `governance`: el principal que despliega debe ser admin de Lake Formation
  (o pasar `-c lfAdminArn=arn:...`)

## Uso rápido

```bash
{{ package_manager }} install
{{ package_manager }} run build        # compila TypeScript
{{ package_manager }} test             # tests de infraestructura (jest + assertions)
{{ package_manager }} run synth:{{ environment }}  # genera CloudFormation
{{ package_manager }} run nag          # valida con cdk-nag (AwsSolutions)
{{ package_manager }} run deploy:{{ environment }}
```

## Ambientes disponibles

| Ambiente | RemovalPolicy | Terminación protegida | Workers Glue | Athena cutoff |
|---|---|---|---|---|
| `dev` | DESTROY | No | 3 | 5 GiB |
| `staging` | RETAIN | No | 3 | 5 GiB |
| `prod` | RETAIN | Sí | 5 | 10 GiB |

Sobreescribir en despliegue: `cdk deploy -c env=prod`

## Configuración

El archivo `lib/config/environments.ts` centraliza la config por ambiente. Los
parámetros claves ya fueron bakeados en la generación:

- Región: **{{ aws_region }}**
- Transición Raw → Glacier IR: **{{ raw_retention_days }} días**
- Retención Archive: **{{ archive_retention_years }} años**
- Email de alertas: **{{ admin_email }}** (confirmar suscripción SNS post-deploy)

Nombres de recursos: prefijo `{{ project_slug }}-<env>`.
Bases de datos Glue: `{{ catalog_prefix }}_<env>_<zona>`.

## Post-generación

1. Confirmar la suscripción SNS enviada a **{{ admin_email }}**.
2. Cargar valores reales en Secrets Manager:
   - `{{ project_slug }}-<env>/ga4-api`
   - `{{ project_slug }}-<env>/meta-ads-api`
   - `{{ project_slug }}-<env>/sftp-origen` (si aplica)
3. Habilitar SFTP Connector en `environments.ts` tras validar la Fase 0 GO/NO-GO.
4. Completar la lógica TODO en las Lambdas (`lambda/`) y scripts Glue (`glue/jobs/`).
5. Otorgar permisos FGAC (LF-Tags → roles analistas) desde SageMaker Studio o
   con `CfnPrincipalPermissions`.
6. Si `enableVpc=true`: asociar Glue Jobs a la VPC usando los IDs de subnet
   exportados por el stack `network`.

## Prácticas aplicadas

Config tipada por ambiente; sin nombres físicos de buckets (evita colisiones);
cifrado E2E KMS con CMK en S3/DynamoDB/SNS/SQS/Secrets/Glue; mínimo privilegio
(grants por prefijo y recurso); SSL forzado y BlockPublicAccess en todos los
buckets; bucket keys para reducir costo KMS; DLQs y reintentos; Step Functions
con backoff exponencial; CloudTrail con validación de integridad; cdk-nag
(AWS Solutions); tests CDK assertions.
