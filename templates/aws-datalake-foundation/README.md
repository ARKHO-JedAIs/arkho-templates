# {{ client_name }} — AWS Data Lake Foundation (CDK v2, TypeScript)

Foundational AWS Data Lake as Infrastructure as Code. Serverless architecture:
4 S3 zones (Raw / Clean / Curated in Apache Iceberg / Archive in Glacier),
Glue ETL orchestrated by Step Functions, native governance with Lake Formation +
Glue Data Catalog, KMS encryption end-to-end, CloudTrail auditing for compliance,
and optional VPC isolation.

## Stacks

| Stack | Condición | Contenido |
|---|---|---|
| `network` | opcional (`enableVpc=true`) | VPC, subnets privadas, NAT Gateway, flow logs, gateway endpoint S3, interface endpoints Glue + Secrets Manager. **Building block: no se le asocia ningún recurso automáticamente** (ver más abajo) |
| `security` | siempre | 2 KMS CMKs (data / ops), SNS topic de alertas |
| `storage` | siempre | S3: Raw (lifecycle → Glacier IR a {{ raw_retention_days }}d), Clean, Curated, Archive (Glacier IR, expira a {{ archive_retention_years }} años), Athena results, access logs. Retención configurable (0 = desactivada) |
| `governance` | siempre | Glue Databases por zona, LF-Tags (dominio, sensibilidad), registro Lake Formation |
| `ingestion` | opcional (`enableIngestionLambdas=true`) | Lambdas (Node 24, ARM64), Secrets Manager, DLQ + alarmas SNS, schedules EventBridge, SFTP Connector opcional |
| `processing` | siempre | Glue Jobs Python (auto-scaling, SSE-KMS, bookmarks), Crawlers, DynamoDB config, Step Functions con reintentos + alarma SNS |
| `consumption` | siempre | Athena WorkGroup (config forzada, bytes-scanned cutoff, resultados cifrados) |
| `observability` | siempre | CloudTrail con data events sobre las 4 zonas + bucket de logs con lifecycle |

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
{{ package_manager }} run synth:{{ environment }}   # genera CloudFormation
{{ package_manager }} run nag          # valida con cdk-nag (AwsSolutions); debe salir en 0
{{ package_manager }} run diff:{{ environment }}
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
parámetros claves ya fueron bakeados en la generación (aplicados a los 3 ambientes):

- Región: **{{ aws_region }}**
- Transición Raw → Glacier IR: **{{ raw_retention_days }} días** (0 = sin transición, los datos quedan en S3 Standard)
- Retención Archive: **{{ archive_retention_years }} años** (0 = sin expiración, retención indefinida)
- Email de alertas: **{{ admin_email }}** (confirmar suscripción SNS post-deploy)

> Los valores de retención son editables por ambiente en `environments.ts`
> (`rawTransitionDays` / `archiveRetentionYears`); ponlos en `0` para desactivar
> la transición a Glacier o la expiración, respectivamente.

- LF-Tag `dominio`: **{{ lf_tag_domains }}**
- LF-Tag `sensibilidad`: **{{ lf_tag_sensitivities }}**
- Ingesta: `{{ ingest_schedule }}` · Pipeline: `{{ pipeline_schedule }}` · Crawlers: `{{ crawler_schedule }}` (todos en UTC)

> Los crons de EventBridge son **siempre UTC**, no la zona local. Y el crawler
> debe partir después de que el pipeline termine: si tus Glue Jobs se acercan al
> timeout de 60 min, aleja `crawlerSchedule` — un crawler que corre a mitad de
> escritura puede inferir el esquema de datos parciales.

Nombres de recursos: prefijo `{{ project_slug }}-<env>`.
Bases de datos Glue: `{{ catalog_prefix }}_<env>_<zona>` (fórmula única en
`catalogDb()` de `environments.ts`: la usan tanto las bases como los crawlers).

## Red (VPC) — building block deliberado

Con `enableVpc=true` se despliega la VPC **pero ningún recurso queda asociado a
ella**: los Glue Jobs, las Lambdas y un eventual DMS siguen corriendo fuera. Es
intencional — se crea por adelantado porque habilitarla después obliga a recrear
recursos, y se conecta cuando aparece la necesidad concreta (ingesta desde una
red cerrada, RDS privado, SFTP interno).

Para conectar recursos, usando los outputs del stack `network`:

| Recurso | Cómo asociarlo |
|---|---|
| Glue Jobs | Crear un `glue.CfnConnection` tipo `NETWORK` con una subnet privada + security group y referenciarlo en `connections` del `CfnJob` |
| Lambdas | Pasar `vpc` + `vpcSubnets: { subnetType: PRIVATE_WITH_EGRESS }` al `lambda.Function` |
| DMS | Usar `PrivateSubnetIds` para el replication subnet group |

Costo mientras esté habilitada: ~USD 32/mes de NAT Gateway + ~USD 14/mes de los
interface endpoints. Si no hay caso de uso a la vista, deja `enableVpc=false`.

## Lake Formation

Las 3 zonas quedan registradas como data locations, así que el acceso de
Glue/Athena pasa a ser vendido por Lake Formation. Ya viene resuelto:

- el rol de Glue tiene `lakeformation:GetDataAccess`;
- la CMK de datos permite al rol de servicio de Lake Formation descifrar
  (sin eso, toda lectura falla con `AccessDenied` en KMS).

`-c lfAdminArn=arn:...` registra el admin vía IaC. **`-c lfStrictMode=true`** es
lo que elimina el permiso por defecto `IAMAllowedPrincipals` para tener FGAC
real: al activarlo, todo principal necesita grant explícito — **incluidos los
crawlers de este proyecto**, que dejarán de poder crear tablas hasta que les
otorgues `CREATE_TABLE`/`ALTER` sobre las bases. Por eso es opt-in y no el
comportamiento por defecto.

## Post-generación

1. Confirmar la suscripción SNS enviada a **{{ admin_email }}**.
2. Cargar valores reales en Secrets Manager:
   - `{{ project_slug }}-<env>/ga4-api`
   - `{{ project_slug }}-<env>/meta-ads-api`
   - `{{ project_slug }}-<env>/sftp-origen` (si aplica)
3. Habilitar el SFTP Connector en `environments.ts` con `url` **y**
   `trustedHostKeys` (`ssh-keyscan <host>`). Falta cualquiera de las dos y el
   synth falla con un mensaje explícito.
4. Completar la lógica TODO en las Lambdas (`lambda/`) y scripts Glue (`glue/jobs/`).
5. Otorgar permisos FGAC (LF-Tags → roles analistas) desde SageMaker Studio o
   con `CfnPrincipalPermissions`.
6. Enganchar el proceso de archivado a la Archive Zone: el rol de Glue ya tiene
   permiso de escritura, pero **ningún job escribe ahí por defecto** — define tú
   qué se archiva y cuándo.
7. Si `enableVpc=true`: asociar los recursos a la VPC (ver la sección Red).

## Notas de mantención

- **`npm run nag` debe salir en 0.** Las supresiones de cdk-nag viven junto al
  código que las justifica y cada una lleva su `reason`. Si agregas permisos,
  acótalos en vez de ampliar una supresión.
- **Runtime de Lambda:** está fijado al más reciente que conoce `aws-cdk-lib`.
  Cuando `AwsSolutions-L1` avise que quedó atrás, súbelo y prueba las Lambdas —
  es la regla funcionando, no un falso positivo.
- **Rotación de secretos:** las credenciales de APIs externas (GA4, Meta, SFTP)
  no se rotan automáticamente; la renovación es manual y está suprimida en
  cdk-nag con esa evidencia.

## Prácticas aplicadas

Config tipada por ambiente; sin nombres físicos de buckets (evita colisiones);
cifrado E2E KMS con CMK en S3/DynamoDB/SNS/SQS/Secrets/Glue; mínimo privilegio
(grants por prefijo y recurso); SSL forzado y BlockPublicAccess en todos los
buckets; bucket keys para reducir costo KMS; DLQs y reintentos; Step Functions
con backoff exponencial; CloudTrail con validación de integridad; cdk-nag
(AWS Solutions); tests CDK assertions.
