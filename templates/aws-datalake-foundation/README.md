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
- Bootstrap por cada par cuenta/región en uso. Con una cuenta compartida basta uno:
  `npx cdk bootstrap aws://{{ aws_account_id }}/{{ aws_region }}`. Con una cuenta
  por ambiente, repítelo por cada `account` distinto de `lib/config/environments.ts`
  (hasta 4).
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

| Ambiente | RemovalPolicy | autoDelete | Terminación protegida | Workers Glue | Athena cutoff | Aprobación en deploy |
|---|---|---|---|---|---|---|
| `dev` | DESTROY | Sí | No | 3 | 5 GiB | — |
| `qa` | RETAIN | No | No | 3 | 5 GiB | — |
| `stg` | RETAIN | No | No | 3 | 5 GiB | broadening |
| `prod` | RETAIN | No | Sí | 5 | 10 GiB | broadening |

Sobreescribir en despliegue: `cdk deploy -c env=prod`

La **cuenta AWS de cada ambiente** vive en el campo `account` de
`lib/config/environments.ts` — fuente única de verdad de dónde despliega cada uno.

## Cuentas y credenciales

Este proyecto se generó con la estrategia **`{{ account_strategy }}`**:

- `shared` → los 4 ambientes despliegan en la misma cuenta. Coexisten sin chocar
  porque todo nombre físico lleva el prefijo `{{ project_slug }}-<ambiente>` y las
  claves de LF-Tag van sufijadas por ambiente.
- `per_environment` → cada ambiente tiene su cuenta. `dev` usa la cuenta
  respondida en la generación; los otros la suya. Un ambiente cuyo ID quedó vacío
  cae en la de `dev`.

Los scripts de npm **no llevan `--profile` a propósito**: el perfil se elige por
variable de entorno, así el mismo script sirve para cualquier organización de
perfiles (incluido CI con roles OIDC, donde no hay perfiles).

```bash
AWS_PROFILE=<perfil-dev>  {{ package_manager }} run deploy:dev
AWS_PROFILE=<perfil-qa>   {{ package_manager }} run deploy:qa
AWS_PROFILE=<perfil-stg>  {{ package_manager }} run deploy:stg
AWS_PROFILE=<perfil-prod> {{ package_manager }} run deploy:prod
```

Como la cuenta va fijada explícitamente en cada stack, el CDK CLI **aborta** si las
credenciales activas son de otra cuenta ("Need to perform AWS calls for account X,
but the current credentials are for Y"). Ese es el seguro contra desplegar prod con
el perfil de dev — no lo desactives dejando las cuentas agnósticas.

`synth`, `test` y `nag` **no necesitan credenciales**: no hay lookups de contexto
(`NetworkStack` fija sus AZs justamente por eso).

## Configuración

El archivo `lib/config/environments.ts` centraliza la config por ambiente. Los
parámetros claves ya fueron bakeados en la generación (aplicados a los 4 ambientes):

- Región: **{{ aws_region }}** (se preguntó una vez, pero `region` es un campo **por
  ambiente**: puedes mover uno a otra región editando su entrada — recuerda hacer
  `cdk bootstrap` en el nuevo par cuenta/región)
- Transición Raw → Glacier IR: **{{ raw_retention_days }} días** (0 = sin transición, los datos quedan en S3 Standard)
- Retención Archive: **{{ archive_retention_years }} años** (0 = sin expiración, retención indefinida)
- Email de alertas: **{{ admin_email }}** (confirmar suscripción SNS post-deploy)

> Los valores de retención son editables por ambiente en `environments.ts`
> (`rawTransitionDays` / `archiveRetentionYears`); ponlos en `0` para desactivar
> la transición a Glacier o la expiración, respectivamente.

- LF-Tag `dominio_<ambiente>`: **{{ lf_tag_domains }}**
- LF-Tag `sensibilidad_<ambiente>`: **{{ lf_tag_sensitivities }}**
- Tag `Owner`: **{{ tag_owner }}** · Tags extra: **{{ extra_tags }}**
- Ingesta: `{{ ingest_schedule }}` · Pipeline: `{{ pipeline_schedule }}` · Crawlers: `{{ crawler_schedule }}` (todos en UTC)

> Los crons de EventBridge son **siempre UTC**, no la zona local. Y el crawler
> debe partir después de que el pipeline termine: si tus Glue Jobs se acercan al
> timeout de 60 min, aleja `crawlerSchedule` — un crawler que corre a mitad de
> escritura puede inferir el esquema de datos parciales.

Nombres de recursos: prefijo `{{ project_slug }}-<env>`.
Bases de datos Glue: `{{ catalog_prefix }}_<env>_<zona>` (fórmula única en
`catalogDb()` de `environments.ts`: la usan tanto las bases como los crawlers).

## Etiquetado (tags)

Toda la lógica vive en `lib/config/tags.ts`, el **único** archivo que llama a
`cdk.Tags.of(...)`. Se aplica a nivel de app, así que alcanza todos los stacks.

| Clave | Valor | Origen |
|---|---|---|
| `Project` | `{{ project_slug }}` | parámetro `project_slug` |
| `Client` | nombre del cliente | `client_name`, saneado (ver abajo) |
| `Environment` | `dev` \| `qa` \| `stg` \| `prod` | ambiente en despliegue |
| `ManagedBy` | `cdk` | fijo |
| `Owner` | `{{ tag_owner }}` | parámetro `tag_owner` |

Los **tags extra** se declaran como CSV `clave=valor` (parámetro `extra_tags`) y se
aplican junto al set base. Reglas que valida el código en cada `synth`, no solo en
la generación: máximo 128 caracteres de clave y 256 de valor, sin prefijo `aws:`
(reservado por AWS), sin claves duplicadas, sin colisionar con una clave del set
base, y máximo 50 tags por recurso contando el set base. Cualquier violación **falla
el synth** con un mensaje que empieza en `extra_tags:` — deliberadamente, porque un
`cost-center` perdido en silencio es invisible hasta que finanzas nota un mes de
gasto sin asignar.

> El valor de `Client` pasa por `sanitizeTagValue()`: `client_name` admite `&`, `#`
> y paréntesis porque también se usa en prosa y descripciones, pero AWS los rechaza
> en valores de tag. Los acentos **sí** se preservan (AWS los acepta). Por eso el
> tag `Client` puede diferir del nombre para mostrar.

### Qué NO se etiqueta, y por qué

No es una omisión: estos tipos **no tienen propiedad `Tags`** en su schema de
CloudFormation, así que ni un `tags:` explícito ni un aspecto pueden agregarla.

- `AWS::Glue::Database` y `AWS::Glue::SecurityConfiguration` — Glue no expone
  tagging para bases del catálogo.
- Todo `AWS::LakeFormation::*`.
- Políticas y accesorios: `IAM::Policy`, `S3::BucketPolicy`, `SQS::QueuePolicy`,
  `SNS::Subscription`, `KMS::Alias`, `Lambda::Permission`.
- El provider de `autoDeleteObjects` (solo en `dev`): CDK lo crea fuera del árbol
  de constructs, así que el aspecto de tagging no lo alcanza.

Todos son recursos de metadata o de política, **de costo cero**, así que la
asignación de costos no se ve afectada. La lista vive en `UNTAGGABLE_TYPES` y
`test/tagging.test.ts` la verifica: si agregas un recurso de un tipo nuevo sin tags,
el test falla hasta que lo clasifiques — la brecha no puede crecer en silencio.

> Nada de esto tiene que ver con los **LF-Tags** de Lake Formation, que son
> gobierno del catálogo de datos, no etiquetas de recursos. Ver la sección
> Lake Formation.

### Activación en facturación

Los tags existen pero Cost Explorer **no puede agrupar por ellos** hasta que los
actives en Billing → Cost allocation tags (desde la cuenta pagadora; tarda hasta
24 h en aparecer). Sin ese paso, todo el propósito FinOps del etiquetado queda sin
efecto.

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

Las claves de LF-Tag van **sufijadas con el ambiente** (`dominio_dev`,
`sensibilidad_prod`, …). No es cosmético: los LF-Tags son singletons por
cuenta+región, no por stack, así que con claves fijas el segundo ambiente
desplegado en una misma cuenta fallaría con `AlreadyExistsException` a mitad del
deploy. El sufijo también aísla los grants — un grant de `dev` no puede alcanzar
datos de `prod`. **Tus `CfnPrincipalPermissions` y los grants hechos desde
SageMaker Studio deben usar la clave con sufijo.**

> Si dos ambientes comparten cuenta y usas `-c lfAdminArn`, ambos gestionan el
> singleton `CfnDataLakeSettings` de la cuenta: último escritor gana, y destruir un
> stack puede dejar sin admin de Lake Formation al otro.

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
8. Activar los tags en Billing → Cost allocation tags (ver Etiquetado). Sin esto
   Cost Explorer no puede agrupar por ellos.

## Notas de mantención

- **`npm run nag` debe salir en 0.** Las supresiones de cdk-nag viven junto al
  código que las justifica y cada una lleva su `reason`. Si agregas permisos,
  acótalos en vez de ampliar una supresión. `npm run nag:all` corre los 4
  ambientes — úsalo antes de un release, porque `nag` solo cubre el ambiente
  por defecto.
- **Runtime de Lambda:** está fijado al más reciente que conoce `aws-cdk-lib`.
  Cuando `AwsSolutions-L1` avise que quedó atrás, súbelo y prueba las Lambdas —
  es la regla funcionando, no un falso positivo.
- **Rotación de secretos:** las credenciales de APIs externas (GA4, Meta, SFTP)
  no se rotan automáticamente; la renovación es manual y está suprimida en
  cdk-nag con esa evidencia.

## Prácticas aplicadas

Config tipada por ambiente con cuenta AWS por ambiente; sin nombres físicos de
buckets (evita colisiones); cifrado E2E KMS con CMK en
S3/DynamoDB/SNS/SQS/Secrets/Glue/Logs; mínimo privilegio (grants por prefijo y
recurso, sin managed policies amplias); SSL forzado y BlockPublicAccess en todos
los buckets; bucket keys para reducir costo KMS; DLQs, alarmas y reintentos; Step
Functions con backoff exponencial; CloudTrail con validación de integridad;
etiquetado transversal para asignación de costos; cdk-nag (AWS Solutions) como
gate real; tests CDK assertions.

## Migración desde una versión anterior del template

Si regeneras un proyecto **ya desplegado**, tres cambios no son retrocompatibles:

1. **`staging` → `stg`** y se agrega `qa`. Cambian los nombres de stack
   (`proj-staging-*` → `proj-stg-*`) y de las bases Glue
   (`cat_staging_raw` → `cat_stg_raw`), así que CloudFormation **recrearía** esos
   recursos. Con `RemovalPolicy.RETAIN` los datos quedan, pero los stacks viejos
   hay que retirarlos a mano.
2. **Claves de tag en español → inglés** (`proyecto`→`Project`, `cliente`→`Client`,
   `ambiente`→`Environment`, `gestionado-por`→`ManagedBy`, `owner`→`Owner`).
   CloudFormation elimina las viejas y agrega las nuevas: hay que **reactivar** los
   cost allocation tags (hasta 24 h) y el histórico de Cost Explorer queda con las
   claves antiguas. Revisa también políticas IAM/SCP con
   `aws:ResourceTag/proyecto`, reglas de AWS Config y selecciones de Backup.
3. **Claves de LF-Tag sufijadas** (`dominio` → `dominio_<ambiente>`). Hay que
   actualizar los `CfnPrincipalPermissions` y los grants hechos desde SageMaker
   Studio.

Para proyectos nuevos nada de esto aplica.
