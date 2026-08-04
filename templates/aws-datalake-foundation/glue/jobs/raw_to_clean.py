"""Job Glue: Raw Zone -> Clean Zone.

Mecanica de plataforma COMPLETA: lee las fuentes activas desde DynamoDB, aplica un
gate de calidad, rutea los registros rechazados a la Quarantine Zone y escribe en
Clean particionado y en Parquet.

Lo UNICO que falta implementar es la transformacion propia del negocio: la funcion
`transform()` mas abajo. Todo lo demas ya funciona.

Contrato de la tabla de configuracion (DynamoDB, --config_table):

    jobName = "raw_to_clean"
    sk      = "source#<nombre>"
    enabled         (bool)   procesar o no esta fuente
    raw_prefix      (str)    prefijo en la Raw Zone, ej "ventas/"  (default "<nombre>/")
    format          (str)    json | csv | parquet                  (default json)
    partition_keys  (list)   columnas de particion                 (default ["dt"])
    not_null        (list)   columnas que deben existir y estar poblada (opcional)
    dedup_keys      (list)   clave de negocio para detectar duplicados  (opcional)

Sin items activos el job no falla: loguea y termina.
"""
import sys
import json
import logging
from datetime import datetime, timezone

import boto3
from awsglue.context import GlueContext
from awsglue.job import Job
from awsglue.utils import getResolvedOptions
from pyspark.context import SparkContext
from pyspark.sql import Window
from pyspark.sql import functions as F

logging.basicConfig(
    level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s", stream=sys.stdout
)
log = logging.getLogger("raw_to_clean")

args = getResolvedOptions(
    sys.argv,
    [
        "JOB_NAME",
        "source_bucket",
        "target_bucket",
        "quarantine_bucket",
        "config_table",
        "clean_database",
        "metric_namespace",
        "env_name",
        "quarantine_gate_threshold",
    ],
)
GATE_THRESHOLD = int(args["quarantine_gate_threshold"])

sc = SparkContext()
glue_context = GlueContext(sc)
spark = glue_context.spark_session
job = Job(glue_context)
job.init(args["JOB_NAME"], args)

SOURCE = f"s3://{args['source_bucket']}"
TARGET = f"s3://{args['target_bucket']}"
QUARANTINE = f"s3://{args['quarantine_bucket']}"
RUN_TS = datetime.now(timezone.utc)
RUN_DT = RUN_TS.strftime("%Y-%m-%d")

cloudwatch = boto3.client("cloudwatch")


def load_sources() -> list:
    """Fuentes activas desde DynamoDB. Sin config, lista vacia (no es un error)."""
    table = boto3.resource("dynamodb").Table(args["config_table"])
    resp = table.query(
        KeyConditionExpression=boto3.dynamodb.conditions.Key("jobName").eq("raw_to_clean")
        & boto3.dynamodb.conditions.Key("sk").begins_with("source#")
    )
    return [item for item in resp.get("Items", []) if item.get("enabled", False)]


# Valores que "parecen" nulos y que en un archivo crudo casi nunca se quieren.
NULL_SENTINELS = ("", "null", "NULL", "N/A", "-")


def validate(df, source_name: str, source_cfg: dict) -> list:
    """<<< VALIDACIONES — EXTENDER AQUI >>>

    Devuelve una lista de (nombre_regla, Column booleana que marca FILA MALA).

    Sin conocer el esquema solo se pueden chequear dos cosas: las columnas que la
    config declara, y hechos estructurales. Rangos, enums, integridad referencial y
    reglas de negocio van aca abajo, en Python — no en strings de configuracion.

    Ejemplos de lo que agregarias:
        checks.append(("monto_negativo", F.col("monto") < 0))
        checks.append(("moneda_desconocida", ~F.col("moneda").isin("CLP", "USD")))
    """
    checks = []
    for column in source_cfg.get("not_null", []) or []:
        column = str(column)
        if column not in df.columns:
            # La columna declarada no llego: TODA la fuente es sospechosa.
            checks.append((f"columna_ausente:{column}", F.lit(True)))
        else:
            col = F.col(column)
            checks.append((
                f"nulo:{column}",
                col.isNull() | F.trim(col.cast("string")).isin(*NULL_SENTINELS),
            ))
    return checks


def split_by_validation(df, checks: list):
    """Separa en (aprobadas, rechazadas_con__quarantine_reason).

    PASA = CERO checks fallidos. La polaridad importa: filtrar por "cumplio alguna
    regla" dejaria pasar filas que violan otras, y el gate no serviria de nada.
    """
    if not checks:
        return df, None

    empty = F.array().cast("array<string>")
    # `F.array_compact` seria mas directo pero es Spark 3.4 y Glue 4.0 trae 3.3:
    # fallaria en runtime con "Undefined function" mientras synth y tests pasan.
    reasons = F.concat(*[
        F.when(cond, F.array(F.lit(name))).otherwise(empty) for name, cond in checks
    ])
    tagged = df.withColumn("_reasons", reasons)
    passed = tagged.filter(F.size("_reasons") == 0).drop("_reasons")
    failed = (
        tagged.filter(F.size("_reasons") > 0)
        .withColumn("_quarantine_reason", F.concat_ws(",", F.col("_reasons")))
        .drop("_reasons")
    )
    return passed, failed


def split_duplicates(df, dedup_keys: list):
    """Separa duplicados por clave de negocio. Devuelve (unicos, duplicados).

    Se cuarentenan en vez de descartarse: `dropDuplicates` se queda con una fila
    arbitraria y no deja rastro de que hubo un choque.
    """
    if not dedup_keys:
        return df, None
    keys = [F.col(str(k)) for k in dedup_keys]
    ranked = df.withColumn(
        "_rn", F.row_number().over(Window.partitionBy(*keys).orderBy(F.lit(1)))
    )
    unique = ranked.filter(F.col("_rn") == 1).drop("_rn")
    dupes = (
        ranked.filter(F.col("_rn") > 1)
        .drop("_rn")
        .withColumn("_quarantine_reason", F.lit("clave_duplicada"))
    )
    return unique, dupes


def publish_metric(name: str, value: float, source: str) -> None:
    """Metrica custom. Las alarmas de CloudWatch leen de este namespace."""
    try:
        cloudwatch.put_metric_data(
            Namespace=args["metric_namespace"],
            MetricData=[
                {
                    "MetricName": name,
                    "Value": value,
                    "Unit": "Count",
                    "Timestamp": RUN_TS,
                    "Dimensions": [
                        {"Name": "Environment", "Value": args["env_name"]},
                        {"Name": "Source", "Value": source},
                    ],
                }
            ],
        )
    except Exception:  # noqa: BLE001 - una metrica no debe tumbar el job
        log.warning("no se pudo publicar la metrica %s de %s", name, source, exc_info=True)


def transform(df, source_name: str):
    """<<< TRANSFORMACION DEL NEGOCIO — IMPLEMENTAR AQUI >>>

    Recibe el DataFrame crudo de una fuente y devuelve el DataFrame estandarizado.
    Lo que ya esta resuelto alrededor: lectura incremental, gate de calidad, ruteo a
    cuarentena, particionado, compresion, registro en el catalogo e idempotencia.

    Tipico: castear tipos, normalizar nombres a snake_case, unificar zonas horarias,
    resolver codigos de negocio. Ejemplo de lo que ya viene puesto:
    """
    # Normaliza los nombres de columna a snake_case: es generico y casi siempre se
    # quiere. Borra esta linea si tu fuente ya viene normalizada.
    for old in df.columns:
        new = old.strip().lower().replace(" ", "_").replace("-", "_")
        if new != old:
            df = df.withColumnRenamed(old, new)

    # Columna de particion por defecto, si la fuente no la trae.
    if "dt" not in df.columns:
        df = df.withColumn("dt", F.lit(RUN_DT))

    return df


def write_quarantine(df, source_name: str) -> int:
    """Escribe los rechazados con su causa. Devuelve cuantos fueron.

    Espera que `df` ya traiga `_quarantine_reason`. La columna de particion se agrega
    ACA y no en el llamador: si cada ruta de rechazo tuviera que recordarla, la
    primera que la olvide hace estallar el `partitionBy`.
    """
    if df is None:
        return 0
    count = df.count()
    if count == 0:
        return 0
    (
        df.withColumn("_quarantine_dt", F.lit(RUN_DT))
        .withColumn("_quarantine_run", F.lit(args["JOB_NAME"]))
        .withColumn("_quarantine_ts", F.lit(RUN_TS.isoformat()))
        .write.mode("append")
        .partitionBy("_quarantine_dt")
        .parquet(f"{QUARANTINE}/{source_name}/")
    )
    log.warning("fuente %s: %d filas en cuarentena", source_name, count)
    return count


def process(source: dict) -> dict:
    """Procesa una fuente. Devuelve un resumen con los contadores."""
    name = source["sk"].split("#", 1)[1]
    prefix = source.get("raw_prefix", f"{name}/")
    fmt = source.get("format", "json")
    partition_keys = [str(k) for k in source.get("partition_keys", ["dt"])]

    log.info("fuente %s: leyendo s3://%s/%s (%s)", name, args["source_bucket"], prefix, fmt)

    # `transformation_ctx` es lo que hace que los bookmarks funcionen de verdad:
    # sin el, el flag --job-bookmark-enable no tiene efecto y cada corrida reprocesa
    # todo el historico.
    frame = glue_context.create_dynamic_frame.from_options(
        connection_type="s3",
        connection_options={
            "paths": [f"{SOURCE}/{prefix}"],
            "recurse": True,
            # Agrupa archivos chicos en tareas mas grandes: la ingesta por API deja
            # muchos objetos pequenos y sin esto cada uno gasta una tarea Spark.
            "groupFiles": "inPartition",
            "groupSize": "134217728",  # 128 MiB
        },
        format=fmt,
        format_options={"withHeader": True} if fmt == "csv" else {},
        transformation_ctx=f"read_{name}",
    )

    if frame.count() == 0:
        log.info("fuente %s: sin datos nuevos", name)
        return {"source": name, "clean": 0, "quarantined": 0}

    df = transform(frame.toDF(), name)

    # --- Gate de calidad ---
    # Las filas que no pasan van a la Quarantine Zone con su causa, en vez de
    # propagarse en silencio hasta Curated o reventar el job — que eran las dos
    # unicas opciones antes de que existiera la zona.
    passed, failed = split_by_validation(df, validate(df, name, source))
    quarantined = write_quarantine(failed, name)

    # Duplicados por clave de negocio, si la fuente declara una.
    passed, dupes = split_duplicates(passed, source.get("dedup_keys", []))
    quarantined += write_quarantine(dupes, name)

    clean_count = passed.count()
    if clean_count > 0:
        # `overwrite` con particion dinamica en vez de `append`: Step Functions
        # reintenta el job, y con append cada reintento duplicaria la particion.
        (
            passed.repartition(*[F.col(k) for k in partition_keys])
            .write.mode("overwrite")
            .option("partitionOverwriteMode", "dynamic")
            .option("compression", "snappy")
            .partitionBy(*partition_keys)
            .parquet(f"{TARGET}/{name}/")
        )

    publish_metric("CleanRows", clean_count, name)
    publish_metric("QuarantinedRows", quarantined, name)
    log.info("fuente %s: %d filas a Clean, %d en cuarentena", name, clean_count, quarantined)
    return {"source": name, "clean": clean_count, "quarantined": quarantined}


spark.conf.set("spark.sql.sources.partitionOverwriteMode", "dynamic")

sources = load_sources()
if not sources:
    log.info(
        "sin fuentes activas en %s (jobName=raw_to_clean). "
        "Carga items 'source#<nombre>' con enabled=true para empezar.",
        args["config_table"],
    )
    job.commit()
    sys.exit(0)

summaries, failures = [], []
for src in sources:
    try:
        summaries.append(process(src))
    except Exception as exc:  # noqa: BLE001 - una fuente no debe tumbar las demas
        name = src.get("sk", "?")
        log.error("fuente %s fallo: %s", name, exc, exc_info=True)
        failures.append(f"{name}: {exc}")

total_clean = sum(s["clean"] for s in summaries)
total_quarantined = sum(s["quarantined"] for s in summaries)
publish_metric("CleanRows", total_clean, "ALL")
publish_metric("QuarantinedRows", total_quarantined, "ALL")
log.info("resumen: %s", json.dumps({"sources": summaries, "failures": failures}))

job.commit()

# Falla DESPUES del commit de las fuentes que si funcionaron, para no reprocesarlas
# en el reintento de Step Functions.
if failures:
    raise RuntimeError(f"{len(failures)} fuente(s) fallaron: {'; '.join(failures)}")

# --- Gate de calidad a nivel de pipeline ---
# El gate vive ACA y no en un estado Choice del Step Functions porque
# GlueStartJobRun con RUN_JOB no devuelve la salida del job: la maquina de estados
# no tiene forma de leer estos contadores. El job si los conoce, asi que decide el
# mismo. Al fallar, el catch del Step Functions notifica por SNS y
# clean_to_curated NO corre — que es el punto: no propagar datos malos a Curated.
if total_quarantined > GATE_THRESHOLD:
    raise RuntimeError(
        f"gate de calidad: {total_quarantined} filas rechazadas supera el umbral de "
        f"{GATE_THRESHOLD}. Los datos NO avanzan a Curated. Revisa la Quarantine "
        f"Zone: la causa va en la columna _quarantine_reason de cada fila. "
        f"Detalle por fuente: {json.dumps(summaries)}"
    )
