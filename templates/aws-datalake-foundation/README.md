# {{ client_name }} — AWS Data Lake Foundation (CDK v2, TypeScript)

Foundational AWS Data Lake as Infrastructure as Code. Serverless architecture:
5 S3 zones (Raw / Clean / Curated in Apache Iceberg / Archive in Glacier /
Quarantine), a generic Glue ETL skeleton orchestrated by Step Functions, enforced
governance with Lake Formation + Glue Data Catalog, KMS encryption end-to-end,
multi-region CloudTrail auditing, and optional VPC isolation.

> **El stack de ingesta es una puerta de entrada, no una implementación.** Entrega el
> rol de escritura de la Raw Zone y el secreto donde cargas las credenciales de la
> base origen — nada más. El productor lo traes tú, y es deliberado: la ingesta varía
> demasiado entre proyectos (API de terceros, SFTP, DMS, Kinesis, un job on-premise)
> para que una implementación concreta sirva de algo. Ver "Cómo entran los datos".

## Stacks

| Stack | Condición | Contenido |
|---|---|---|
| `network` | opcional (`enableVpc=true`) | VPC, subnets privadas, NAT Gateway, flow logs, gateway endpoint S3, interface endpoints Glue + Secrets Manager. **Building block: no se le asocia ningún recurso automáticamente** (ver más abajo) |
| `security` | siempre | 2 KMS CMKs (data / ops), SNS topic de alertas |
| `storage` | siempre | S3: Raw (lifecycle → Glacier IR a {{ raw_retention_days }}d), Clean, Curated, Archive (Glacier IR + Object Lock), **Quarantine**, Athena results, access logs. Retención configurable (0 = desactivada) |
| `governance` | siempre | Glue Databases por zona, LF-Tags **asociados a las bases**, registro Lake Formation de las 4 zonas de datos, **rol de analista con grant por LF-Tag** |
| `ingestion` | siempre | Rol de escritura de la Raw Zone (`PutObject`, sin borrado) + secreto para las credenciales de la base origen. **No implementa la ingesta** |
| `processing` | siempre | Glue Jobs Python (auto-scaling, SSE-KMS, bookmarks reales), **gate de calidad + cuarentena**, **mantenimiento Iceberg semanal** (bloque desacoplable), 4 Crawlers, DynamoDB config, Step Functions con reintentos + alarmas SNS |
| `consumption` | siempre | Athena WorkGroup (config forzada, bytes-scanned cutoff, resultados cifrados) |
| `observability` | siempre | CloudTrail multi-región con data events + salida a CloudWatch Logs, alarmas sobre el trail, **alarma de "el pipeline no corrió"**, alarmas de Glue por EventBridge, **dashboard** |

## Requisitos

- Node.js 20+, AWS CLI configurado
- Bootstrap por cada par cuenta/región en uso. Con una cuenta compartida basta uno:
  `npx cdk bootstrap aws://{{ aws_account_id }}/{{ aws_region }}`. Con una cuenta
  por ambiente, repítelo por cada `ACCOUNT` distinto de tus `config/*.env`.
- Para `governance`: el principal que despliega debe ser admin de Lake Formation
  (o pasar `-c lfAdminArn=arn:...`)

## Uso rápido

```bash
{{ package_manager }} install
{{ package_manager }} run build     # compila TypeScript
{{ package_manager }} test          # tests de infraestructura (jest + assertions)
{{ package_manager }} run synth      # genera CloudFormation del ambiente por defecto
{{ package_manager }} run nag        # valida con cdk-nag (AwsSolutions); debe salir en 0
{{ package_manager }} run nag:all    # lo mismo en TODOS tus ambientes
{{ package_manager }} run diff
{{ package_manager }} run deploy
```

Ninguno de esos scripts nombra un ambiente. `synth`, `diff`, `deploy` y `nag`
trabajan sobre el **ambiente por defecto**; para cualquier otro, pasa el contexto:

```bash
{{ package_manager }} run deploy -- -c env=prod
{{ package_manager }} run diff -- -c env=stg
```

Los `:all` (`synth:all`, `diff:all`, `nag:all`) recorren todos los ambientes del
proyecto vía `scripts/each-env.js`. Nada enumera ambientes a mano, así que esto
sirve igual con dos que con cuatro.

## Ambientes de este proyecto

Se eligieron en la generación: **{{ environments }}**.

**Un ambiente es un archivo.** Cada uno tiene su `config/<ambiente>.env` con todos
sus tunables operacionales, y `lib/config/environments.ts` descubre los ambientes
leyendo qué archivos existen en `config/`. No hay ninguna lista que mantener
sincronizada en otro lado.

```
config/
├── dev.env     ← existe ⇒ el ambiente dev existe
└── prod.env
```

El **ambiente por defecto** es el primero en orden canónico (`dev` → `qa` → `stg` →
`prod`, de menos a más endurecido), expuesto como `DEFAULT_ENV`. Es el que usan
`synth`/`diff`/`deploy` sin `-c env=`.

Los perfiles con los que se generan los archivos:

| Ambiente | REMOVAL_POLICY | AUTO_DELETE | TERMINATION_PROTECTION | GLUE_MAX_WORKERS | ATHENA_BYTES_CUTOFF_GIB | LOG_RETENTION_DAYS |
|---|---|---|---|---|---|---|
| `dev` | DESTROY | true | false | 3 | 5 | 30 |
| `qa` | RETAIN | false | false | 3 | 5 | 30 |
| `stg` | RETAIN | false | false | 3 | 5 | 30 |
| `prod` | RETAIN | false | true | 5 | 10 | 365 |

De acá en adelante son código: ninguno se vuelve a preguntar, y cambiar la retención
solo en `prod` es editar una línea de `config/prod.env`.

`deploy` lleva `--require-approval broadening` siempre: te pide confirmación cuando
un cambio amplía permisos, en cualquier ambiente.

### Estos archivos se versionan

`config/*.env` **va al repositorio**. No son un `.env` de secretos: son retenciones,
horarios y umbrales que el equipo necesita revisar en un PR, y sin ellos un `git
clone` no puede ni sintetizar. Las credenciales van a Secrets Manager (el secreto
`{{ project_slug }}-<ambiente>/source-db`) o a un `.env.local`, que sí está
gitignoreado junto con `.env` y `.env.*.local`.

### Se validan en cada synth

Todas las claves son obligatorias y tipadas. Un entero con decimales, un booleano
que no sea `true`/`false`, un cron sin envoltura `cron()`, una cuenta que no tenga 12
dígitos, una clave repetida o **una clave desconocida** cortan el `synth` nombrando
archivo, clave, valor leído y qué se esperaba.

Lo de la clave desconocida es deliberado y no paranoia: el caso real es un rename a
medias o un typo que deja la clave vieja en su lugar, y con eso el valor que acabas
de editar no tendría efecto mientras el archivo dice otra cosa.

También se rechaza `AUTO_DELETE_OBJECTS=true` junto a `REMOVAL_POLICY=RETAIN`: CDK no
acepta esa combinación, y atraparla acá señala el archivo en vez de un construct.

### Agregar o quitar un ambiente después

No hace falta regenerar el proyecto:

1. `cp config/prod.env config/qa.env` y ajusta lo que cambie — como mínimo `ACCOUNT`
   si va a otra cuenta (déjalo vacío para usar la del proyecto).
2. `npx cdk bootstrap aws://<cuenta>/<región>` si es un par nuevo.

Eso es todo: el ambiente ya existe para `synth`, `deploy`, `nag:all`, los tests y el
CI. Para quitarlo, borra su archivo.

Los nombres válidos son `dev`, `qa`, `stg` y `prod`. Un `config/uat.env` **falla** en
vez de ignorarse en silencio, para que un `prod.env.bak` no termine desplegando
infraestructura.

## Cuentas y credenciales

Este proyecto se generó con la estrategia **`{{ account_strategy }}`**:

- `shared` → todos los ambientes despliegan en la misma cuenta. Coexisten sin chocar
  porque todo nombre físico lleva el prefijo `{{ project_slug }}-<ambiente>` y las
  claves de LF-Tag van sufijadas por ambiente.
- `per_environment` → cada ambiente tiene su cuenta, en la clave `ACCOUNT` de su
  archivo de config. Un `ACCOUNT=` vacío cae en la cuenta por defecto del proyecto
  (`DEFAULT_ACCOUNT` en `lib/config/environments.ts`) — es el único valor que no vive
  en los `.env`, precisamente porque es el fallback de todos.

Los scripts de npm **no llevan `--profile` a propósito**: el perfil se elige por
variable de entorno, así el mismo script sirve para cualquier organización de
perfiles (incluido CI con roles OIDC, donde no hay perfiles).

```bash
AWS_PROFILE=<perfil-del-default> {{ package_manager }} run deploy
AWS_PROFILE=<perfil-de-prod>     {{ package_manager }} run deploy -- -c env=prod
```

Como la cuenta va fijada explícitamente en cada stack, el CDK CLI **aborta** si las
credenciales activas son de otra cuenta ("Need to perform AWS calls for account X,
but the current credentials are for Y"). Ese es el seguro contra desplegar prod con
el perfil de dev — no lo desactives dejando las cuentas agnósticas.

`synth`, `test` y `nag` **no necesitan credenciales**: no hay lookups de contexto
(`NetworkStack` fija sus AZs justamente por eso).

## Configuración

**Todo tunable operacional vive en `config/<ambiente>.env`.** No hay valores
compartidos por herencia: cada archivo declara sus 16 claves, así que ajustar uno
solo en `prod` es editar una línea de `config/prod.env`. `lib/config/environments.ts`
solo los lee y valida.

Estos son los que se sembraron con las respuestas de la generación:

- Región: **{{ aws_region }}** (se preguntó una vez, pero `REGION` es una clave **por
  ambiente**: puedes mover uno a otra región editando su archivo — recuerda hacer
  `cdk bootstrap` en el nuevo par cuenta/región)
- Transición Raw → Glacier IR: **{{ raw_retention_days }} días** (0 = sin transición, los datos quedan en S3 Standard)
- Retención Archive: **{{ archive_retention_years }} años** (0 = sin expiración, retención indefinida)
- Email de alertas: **{{ admin_email }}** (confirmar suscripción SNS post-deploy)

> Los valores de retención son editables por ambiente en `config/<ambiente>.env`
> (`RAW_TRANSITION_DAYS` / `ARCHIVE_RETENTION_YEARS`); ponlos en `0` para desactivar
> la transición a Glacier o la expiración, respectivamente.

- LF-Tag `dominio_<ambiente>`: **{{ lf_tag_domains }}**
- LF-Tag `sensibilidad_<ambiente>`: **{{ lf_tag_sensitivities }}**
- Tag `Owner`: **{{ tag_owner }}** · Tags extra: **{{ extra_tags }}**
- Pipeline: `{{ pipeline_schedule }}` · Crawlers: `{{ crawler_schedule }}` (ambos en UTC)

> Los crons de EventBridge son **siempre UTC**, no la zona local. Y el crawler
> debe partir después de que el pipeline termine: si tus Glue Jobs se acercan al
> timeout de 60 min, aleja `crawlerSchedule` — un crawler que corre a mitad de
> escritura puede inferir el esquema de datos parciales.

Nombres de recursos: prefijo `{{ project_slug }}-<env>`.
Bases de datos Glue: `{{ catalog_prefix }}_<env>_<zona>` para `raw`, `clean`,
`curated` y `quarantine`. La fórmula vive en `catalogDb()` de `environments.ts`: la
usan tanto las bases como los crawlers, así que no pueden divergir.

## Etiquetado (tags)

Toda la lógica vive en `lib/config/tags.ts`, el **único** archivo que llama a
`cdk.Tags.of(...)`. Se aplica a nivel de app, así que alcanza todos los stacks.

| Clave | Valor | Origen |
|---|---|---|
| `Project` | `{{ project_slug }}` | parámetro `project_slug` |
| `Client` | nombre del cliente | `client_name`, saneado (ver abajo) |
| `Environment` | el ambiente en despliegue | `cfg.envName` |
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
- El provider de `autoDeleteObjects` (solo en ambientes con `removalPolicy: DESTROY`,
  típicamente `dev`): CDK lo crea fuera del árbol
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

## Cómo entran los datos (la ingesta la traes tú)

El stack `ingestion` **no** implementa ingesta: son tres recursos que entregan el
permiso, las credenciales y el contrato.

**El rol.** `{{ project_slug }}-<env>-ingest-writer`, cuyo ARN queda en el output
`IngestWriterRoleArn`. Tu proceso lo asume y puede hacer `PutObject` en la Raw Zone,
usar la CMK y leer el secreto — **nada más**: no tiene permiso de borrado, porque un
productor no debería poder eliminar lo que ya aterrizó.

Por defecto lo asume la cuenta root; acótalo al principal real con
`-c ingestPrincipalArn=arn:aws:iam::<cuenta>:role/<tu-proceso>`.

**El secreto.** `{{ project_slug }}-<env>/source-db`, cifrado con la ops key y con la
forma que AWS usa por convención para credenciales de base de datos, así que DMS, las
Glue connections y los SDK la reconocen sin traducción:

```json
{ "engine": "", "host": "", "port": "", "dbname": "", "username": "", "password": "..." }
```

Se crea con esa plantilla y una contraseña aleatoria de relleno. Carga los valores
reales post-deploy:

```bash
aws secretsmanager put-secret-value \
  --secret-id {{ project_slug }}-<env>/source-db \
  --secret-string '{"engine":"postgres","host":"...","port":"5432","dbname":"...","username":"...","password":"..."}'
```

Sigue el `removalPolicy` del ambiente: en los que retienen, un `cdk destroy` **no** se
lleva las credenciales. No se rota automáticamente — Secrets Manager necesitaría una Lambda
de rotación específica del motor y con acceso de red al origen, y rotar a ciegas
rompería la conexión; la renovación es del dueño de esa base.

**El layout.** El ETL espera:

```
s3://<raw-bucket>/<fuente>/dt=YYYY-MM-DD/<archivo>
```

`<fuente>` es lo que registras como `raw_prefix` en la tabla de configuración, y `dt=`
es la partición. Formatos soportados sin tocar código: JSON/NDJSON, CSV y Parquet.

Cualquier cosa que hable S3 sirve como productor: un job propio, DMS, Kinesis Data
Firehose, AppFlow, Transfer Family, o un script en un servidor. Si necesitas alcanzar
una red privada, habilita el stack `network` (ver Red).

> El pipeline corre por cron (`pipelineSchedule`), no por evento. Si quieres
> dispararlo cuando llega un objeto, habilita EventBridge en el bucket Raw y apunta
> una regla a la máquina de estados — son dos líneas y queda a tu criterio, porque
> depende de si tu ingesta deja un archivo o cientos.

## El pipeline de datos: qué ya funciona y qué te toca escribir

La **mecánica de plataforma está completa y funcionando**. Lo único que falta es la
lógica de tu negocio, en dos funciones marcadas:

| Ya resuelto | Te toca |
|---|---|
| Lectura incremental con bookmarks reales (`transformation_ctx`), agrupación de archivos chicos | `transform(df, source)` en `glue/jobs/raw_to_clean.py` |
| Gate de calidad con `EvaluateDataQuality`, ruteo de rechazos a cuarentena con su causa | `build_model(sources, table)` en `glue/jobs/clean_to_curated.py` |
| Escritura Parquet+Snappy particionada, idempotente (partición dinámica, no `append`) | Las reglas DQDL por fuente (hay un ruleset base si no defines) |
| DDL Iceberg con propiedades explícitas y `MERGE INTO` por clave de negocio | — |
| Compactación, expiración de snapshots y limpieza de huérfanos semanal | — |

### Configuración de fuentes y tablas (DynamoDB)

Los jobs leen qué procesar desde la tabla `{{ project_slug }}-<env>-job-config`. Sin
items activos **no fallan**: loguean y terminan. Para empezar:

```bash
# Una fuente de la Raw Zone
aws dynamodb put-item --table-name {{ project_slug }}-<env>-job-config --item '{
  "jobName": {"S": "raw_to_clean"}, "sk": {"S": "source#ventas"},
  "enabled": {"BOOL": true}, "raw_prefix": {"S": "ventas/"}, "format": {"S": "json"},
  "partition_keys": {"L": [{"S": "dt"}]},
  "not_null": {"L": [{"S": "fecha"}]}
}'

# Una tabla analítica en Curated (merge_keys es obligatorio)
aws dynamodb put-item --table-name {{ project_slug }}-<env>-job-config --item '{
  "jobName": {"S": "clean_to_curated"}, "sk": {"S": "table#ventas_diarias"},
  "enabled": {"BOOL": true}, "source_tables": {"L": [{"S": "ventas"}]},
  "merge_keys": {"L": [{"S": "venta_id"}]}, "partition_by": {"S": "days(dt)"}
}'
```

## Calidad de datos y zona de cuarentena

Cada fuente pasa por un ruleset DQDL antes de escribirse en Clean. Las filas que
fallan van a `s3://<quarantine>/<fuente>/` con la causa en `_quarantine_reason`, en
vez de propagarse en silencio o reventar el job — que eran las dos únicas opciones
posibles antes de que existiera la zona.

El **gate de pipeline** vive dentro del job, no en un estado del Step Functions: por
encima de el umbral `quarantineAlarmThreshold` filas rechazadas el job falla, la
alarma SNS se dispara y `clean_to_curated` **no corre**, así que los datos malos no
llegan a Curated. Está en el job y no en un `Choice` porque `GlueStartJobRun` con
`RUN_JOB` no devuelve la salida del job: la máquina de estados no puede leer esos
contadores, el job sí.

La retención de los rechazos se ajusta con `QUARANTINE_RETENTION_DAYS` en `config/<ambiente>.env`.

## Iceberg: propiedades y mantenimiento

Las tablas de Curated se crean con `format-version=2`, `write.target-file-size-bytes`,
compresión Snappy, `write.distribution-mode=hash` y limpieza de metadata. El
particionado es oculto (`days(dt)` por defecto, configurable por tabla).

> Las confs de Iceberg —incluida `spark.sql.extensions`— llegan por `--conf` en la
> definición del job y **no** por `spark.conf.set` en el script. No es estilo:
> `spark.sql.extensions` es una conf **estática** de la sesión, así que aplicarla
> después de crear el SparkContext no tiene efecto y `MERGE INTO` junto con los
> `CALL system.*` fallarían en runtime mientras synth, tests y cdk-nag pasan en verde.

**Mantenimiento semanal** (domingo 03:00 UTC): compactación, `rewrite_manifests`,
`expire_snapshots` con la ventana de `icebergSnapshotRetentionDays` de
time-travel, y `remove_orphan_files`. Sin esto una tabla Iceberg se degrada de forma
garantizada: archivos chicos acumulados y metadata creciendo sin límite.

El job **descubre** las tablas en runtime en vez de recibir una lista, así que
funciona con cero configuración y se adapta a medida que aparecen. `CfnTableOptimizer`
—el mecanismo gestionado de AWS— no sirve acá porque exige el nombre de la tabla en
tiempo de síntesis y este template no crea tablas. Cuando tus tablas sean estables,
migrar a `CfnTableOptimizer` es el upgrade natural: lo gestiona AWS y te ahorra el job.

## Integración continua

`.github/workflows/ci.yml` corre en cada PR: `build`, `test` y `nag:all` sin
credenciales AWS (no hay lookups de contexto). El `cdk diff` de todos tus ambientes es
opcional y requiere configurar en el repo de GitHub:

| Variable de repo | Valor |
|---|---|
| `AWS_DEPLOY_ROLE_ARN` | el ARN de tu rol OIDC de despliegue |
| `AWS_REGION` | `{{ aws_region }}` |

Van por `vars` de GitHub y no por token de generación a propósito: son configuración
de despliegue, y el rol OIDC normalmente no existe todavía cuando se genera el proyecto.

## Red (VPC) — building block deliberado

Con `enableVpc=true` se despliega la VPC **pero ningún recurso queda asociado a
ella**: los Glue Jobs y un eventual DMS o proceso de ingesta siguen corriendo
fuera. Es intencional — se crea por adelantado porque habilitarla después obliga a
recrear recursos, y se conecta cuando aparece la necesidad concreta de alcanzar una
red privada (un RDS interno, un origen on-premise).

Para conectar recursos, usando los outputs del stack `network`:

| Recurso | Cómo asociarlo |
|---|---|
| Glue Jobs | Crear un `glue.CfnConnection` tipo `NETWORK` con una subnet privada + security group y referenciarlo en `connections` del `CfnJob` |
| Lambdas | Pasar `vpc` + `vpcSubnets: { subnetType: PRIVATE_WITH_EGRESS }` al `lambda.Function` |
| DMS | Usar `PrivateSubnetIds` para el replication subnet group |

Costo mientras esté habilitada: ~USD 32/mes de NAT Gateway + ~USD 14/mes de los
interface endpoints. Si no hay caso de uso a la vista, deja `enableVpc=false`.

## Lake Formation

Las 4 zonas de datos quedan registradas como data locations, así que el acceso de
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

`-c lfAdminArn=arn:...` registra el admin vía IaC.

**FGAC estricto viene ACTIVADO por defecto**: se elimina el permiso
`IAMAllowedPrincipals`, que es lo que convierte a Lake Formation en un control real
en vez de decorativo. Eso es viable porque los grants necesarios ya existen en el
template: el rol de Glue recibe `DESCRIBE`/`CREATE_TABLE`/`ALTER`/`DROP` sobre las
bases (en `ProcessingStack`), y el rol de analista un grant **por LF-Tag**. Antes era
opt-in precisamente porque sin esos grants los crawlers del propio proyecto se
quedaban sin poder crear tablas.

Para volver atrás: `-c lfStrictMode=false`.

### Rol de analista

Se crea `{{ project_slug }}-<env>-analyst`, asumible por
el principal de `-c analystPrincipalArn` (vacío = cuenta root, acótalo). Puede usar el
WorkGroup de Athena, leer el catálogo y sus propios resultados — pero el acceso a los
DATOS lo da Lake Formation, no IAM: un grant por expresión de LF-Tag que excluye la
clasificación más sensible. Como es una expresión sobre tags y no una lista de tablas,
una tabla nueva queda cubierta sin tocar IaC.

Las bases quedan etiquetadas con `dominio_<env>` y `sensibilidad_<env>` por defecto:
Raw y Clean con la clasificación **más restrictiva** (en Raw todavía no se sabe qué
contiene, así que se asume lo peor) y Curated con la más abierta. Refina a nivel de
tabla y columna desde SageMaker Studio o con más `CfnTagAssociation`.

## Post-generación

1. Confirmar la suscripción SNS enviada a **{{ admin_email }}**.
2. **Cargar las credenciales de la base origen** en el secreto
   `{{ project_slug }}-<env>/source-db` (ver "Cómo entran los datos"). Se crea con una
   contraseña aleatoria de relleno.
3. **Conectar tu ingesta**: hacer que asuma el rol `IngestWriterRoleArn` y escriba con
   el layout documentado. Acotar el trust con `-c ingestPrincipalArn=...`.
3. **Cargar las fuentes y tablas en DynamoDB** e implementar `transform()` y
   `build_model()` (ver "El pipeline de datos"). Hasta que haya items activos los
   jobs corren y terminan sin hacer nada, lo cual es intencional.
4. Reemplazar la taxonomía placeholder de LF-Tags por la del cliente
   (`lf_tag_domains` / `lf_tag_sensitivities` en `environments.ts`) y refinarla a
   nivel de tabla y columna. **El orden de sensibilidad es semántico**: el primer
   valor es el más restrictivo y es el que el rol de analista NO puede ver.
5. Acotar el trust del rol de analista si dejaste `-c analystPrincipalArn` vacío.
6. Enganchar el proceso de archivado a la Archive Zone: el rol de Glue ya tiene
   permiso de escritura (solo `PutObject`, **no** borrado), pero **ningún job escribe
   ahí por defecto** — define tú qué se archiva y cuándo.
7. Si `enableVpc=true`: asociar los recursos a la VPC (ver la sección Red).
8. Activar los tags en Billing → Cost allocation tags (ver Etiquetado). Sin esto
   Cost Explorer no puede agrupar por ellos.
9. Configurar `AWS_DEPLOY_ROLE_ARN` y `AWS_REGION` en el repo de GitHub si quieres
   el `cdk diff` de CI (ver "Integración continua").
10. **Fijar retención a los log groups de Glue**, que el servicio crea en runtime y
    quedan sin expiración. Deliberadamente no se administran desde este stack: son
    compartidos a nivel de cuenta entre todos los workloads Glue, así que fijarlos
    desde acá decidiría sobre los logs de otros proyectos. Es una tarea de cuenta:
    ```bash
    for g in /aws-glue/jobs/output /aws-glue/jobs/error /aws-glue/crawlers; do
      aws logs put-retention-policy --log-group-name $g --retention-in-days 30
    done
    ```

## Notas de mantención

- **`npm run nag` debe salir en 0.** Las supresiones de cdk-nag viven junto al
  código que las justifica y cada una lleva su `reason`. Si agregas permisos,
  acótalos en vez de ampliar una supresión. `npm run nag:all` corre todos tus
  ambientes — úsalo antes de un release, porque `nag` solo cubre el ambiente
  por defecto.
- **Runtime de Lambda:** está fijado al más reciente que conoce `aws-cdk-lib`.
  Cuando `AwsSolutions-L1` avise que quedó atrás, súbelo y prueba las Lambdas —
  es la regla funcionando, no un falso positivo.
- **Los scripts Glue no tienen test automatizado.** El pipeline de verificación no
  corre Python, así que `validate()` y `split_by_validation()` se revisan por
  inspección. Si los modificas, presta atención a la polaridad: PASA = **cero**
  checks fallidos, no "cumplió alguno".

## Prácticas aplicadas

Config tipada por ambiente con cuenta AWS por ambiente; sin nombres físicos de
buckets (evita colisiones); mínimo privilegio (grants por prefijo y recurso, sin
managed policies amplias); SSL forzado y BlockPublicAccess en todos los buckets;
bucket keys para reducir costo KMS; gate de calidad con cuarentena; cargas
idempotentes (partición dinámica y `MERGE INTO`, no `append`); mantenimiento
automático de Iceberg; FGAC de Lake Formation efectivo, no declarativo; Object Lock
en las zonas de retención; Step Functions con backoff exponencial; alarmas que cubren
también la ausencia de ejecuciones; CloudTrail multi-región con validación de
integridad y alarmas sobre su contenido; etiquetado transversal para asignación de
costos; cdk-nag (AWS Solutions) como gate real en todos los ambientes del proyecto;
tests de infraestructura.

**Cifrado con CMK** en S3 (las 5 zonas + resultados de Athena), DynamoDB, SNS, SQS,
Secrets Manager, Glue (datos, bookmarks y logs) y los log groups del proyecto. Dos
excepciones deliberadas, ambas SSE-S3 y comentadas en el código: el bucket de access
logs y el del trail — S3 solo admite SSE-S3 como destino de server access logs, y para
CloudTrail es lo que AWS recomienda para no acoplar la data key a la auditoría.

**El stack de ingesta no trae productores**: ni Lambdas de proveedores ni conectores,
solo el rol de escritura y el secreto de la base origen. Las alarmas que sí trae el
template cubren el pipeline, la cuarentena, los jobs y crawlers de Glue, y el
contenido del trail.

## Migración desde una versión anterior del template

Si regeneras un proyecto **ya desplegado**, estos cambios no son retrocompatibles.

**Primero, los ambientes se eligen y su config se mudó a archivos.** El parámetro
`environment` (el ambiente por defecto) **desapareció**: ahora se pregunta
`environments`, el conjunto que tendrá el proyecto, y el default se deriva del primero
en orden canónico. Y **todos los tunables salieron de `lib/config/environments.ts` a
`config/<ambiente>.env`**; ese archivo pasó a ser el cargador que los lee y valida.
Con eso:

- **Se fueron los 12 scripts por ambiente.** `npm run deploy:prod` pasa a
  `npm run deploy -- -c env=prod`. Si los tenías en runbooks o en tu propio CI, hay
  que actualizarlos. Los `:all` ahora pasan por `scripts/each-env.js`.
- Se fue la clave `env` del context de `cdk.json`, y no hay reemplazo: los ambientes
  se descubren leyendo `config/*.env`.
- La matriz de 4 ambientes del workflow de CI se reemplaza por un job secuencial que
  corre `diff:all`. Con una cuenta por ambiente, ese job asume un solo rol OIDC: si
  necesitas diff en varias cuentas, divídelo en un job por cuenta.
- `ENVIRONMENTS` pasa de `Record<EnvName, …>` a `Partial<Record<EnvName, …>>`. Código
  propio que hacía `ENVIRONMENTS.qa.region` deja de compilar: usa `getConfig('qa')`.
- Si habías editado valores en `environments.ts` (retenciones, crons, umbrales,
  workers), **hay que trasladarlos** a los `config/*.env` del proyecto regenerado. Es
  la única parte que no es mecánica: la equivalencia es clave por clave
  (`rawTransitionDays` → `RAW_TRANSITION_DAYS`, etc.), salvo
  `athenaBytesCutoff`, que ahora se declara en GiB (`ATHENA_BYTES_CUTOFF_GIB`) en vez
  de bytes.
- `aws_account_id` cambió de significado: era la cuenta de `dev`, ahora es la
  compartida y el fallback de cualquier `ACCOUNT=` vacío.

Nada de esto mueve un recurso desplegado: son parámetros, scripts, tipos y de dónde
se leen los valores. Con los mismos valores, la plantilla sintetizada es la misma.

**Segundo, la ingesta:** el stack `ingestion` se reduce a un rol y un secreto. Un
proyecto desplegado pierde las Lambdas de GA4 y Meta Ads, el SFTP Connector, la DLQ y
sus alarmas. Los secretos viejos (`/ga4-api`, `/meta-ads-api`, `/sftp-origen`) tienen
`RemovalPolicy.RETAIN`, así que quedan huérfanos y hay que borrarlos a mano. Si
dependías de esas Lambdas, guárdalas antes de regenerar: no están en el template nuevo.

**Tercero, parámetros que se movieron:** `quarantine_retention_days`,
`quarantine_alarm_threshold`, `iceberg_snapshot_retention_days` y
`log_retention_days` ya no se preguntan — se editan en `config/<ambiente>.env`.
`analyst_principal_arn` pasó a `-c analystPrincipalArn`. Si automatizabas `generate`
con esos flags, deja de funcionar.

**Cuarto, los defaults de LF-Tag cambiaron y su orden es semántico.** Si tu lake
usaba `pii,interno,publico`, mantén el más restrictivo primero.

**Quinto**, `CatalogZone` gana `quarantine`: una base Glue y un crawler nuevos.

**Sexto**, los crawlers de Curated y Quarantine pierden `RecrawlPolicy`, y todos
pierden `Grouping`. El primer crawl posterior recorre todo y puede **separar** tablas
que se habían fusionado por `CombineCompatibleSchemas`.

Y de la versión anterior:

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
4. **Object Lock es IRREVERSIBLE** y solo se puede habilitar al CREAR el bucket. Un
   proyecto ya desplegado necesita un bucket nuevo y migrar los objetos; CloudFormation
   no puede activarlo sobre el existente. Si prefieres postergarlo, genera con
   `enable_object_lock=false`.
5. **`lfStrictMode` pasa a `true` por defecto.** Un lake existente cuyos permisos se
   apoyaban en `IAMAllowedPrincipals` deja de funcionar hasta que los principals
   tengan grants explícitos de Lake Formation. Despliega con `-c lfStrictMode=false`
   primero, otorga los grants, y recién entonces activa el modo estricto.
6. **La Archive Zone pierde permiso de borrado** (`grantWrite` → `grantPut`). Si algún
   proceso tuyo borraba objetos ahí con el rol de Glue, dejará de poder.

Para proyectos nuevos nada de esto aplica.
