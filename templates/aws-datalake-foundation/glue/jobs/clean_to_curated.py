"""Job Glue: Clean Zone -> Curated Zone (Apache Iceberg).

Mecanica de plataforma COMPLETA: crea la tabla Iceberg si no existe, con propiedades
y particionado explicitos, y carga con MERGE INTO por la clave de negocio (carga
idempotente real, no `append`).

Lo UNICO que falta implementar es el modelo analitico: la funcion `build_model()`.

La configuracion del catalogo Iceberg (incluido `spark.sql.extensions`) llega por
`--conf` desde la definicion del job, NO por `spark.conf.set`: `spark.sql.extensions`
es una conf estatica de la sesion y aplicarla despues de crear el SparkContext no
tiene efecto — sin ella, MERGE INTO y los CALL de mantenimiento fallan en runtime.

Contrato de la tabla de configuracion (DynamoDB, --config_table):

    jobName = "clean_to_curated"
    sk      = "table#<nombre>"
    enabled       (bool)  procesar o no
    source_tables (list)  prefijos de Clean que alimentan la tabla
    merge_keys    (list)  clave de negocio para el MERGE          (requerido)
    partition_by  (str)   expresion de particion Iceberg          (default "days(dt)")
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
from pyspark.sql import functions as F

logging.basicConfig(
    level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s", stream=sys.stdout
)
log = logging.getLogger("clean_to_curated")

args = getResolvedOptions(
    sys.argv,
    [
        "JOB_NAME",
        "source_bucket",
        "target_bucket",
        "config_table",
        "curated_database",
        "metric_namespace",
        "env_name",
    ],
)

sc = SparkContext()
glue_context = GlueContext(sc)
spark = glue_context.spark_session
job = Job(glue_context)
job.init(args["JOB_NAME"], args)

SOURCE = f"s3://{args['source_bucket']}"
DATABASE = args["curated_database"]
CATALOG = "glue_catalog"
RUN_TS = datetime.now(timezone.utc)

cloudwatch = boto3.client("cloudwatch")


def load_tables() -> list:
    table = boto3.resource("dynamodb").Table(args["config_table"])
    resp = table.query(
        KeyConditionExpression=boto3.dynamodb.conditions.Key("jobName").eq("clean_to_curated")
        & boto3.dynamodb.conditions.Key("sk").begins_with("table#")
    )
    return [item for item in resp.get("Items", []) if item.get("enabled", False)]


def publish_metric(name: str, value: float, table: str) -> None:
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
                        {"Name": "Table", "Value": table},
                    ],
                }
            ],
        )
    except Exception:  # noqa: BLE001
        log.warning("no se pudo publicar %s de %s", name, table, exc_info=True)


def build_model(sources: dict, table_name: str):
    """<<< MODELO ANALITICO — IMPLEMENTAR AQUI >>>

    `sources` es un dict {nombre_fuente: DataFrame} con las zonas Clean declaradas en
    `source_tables`. Devuelve el DataFrame final que se va a mergear.

    Tipico: joins entre fuentes, metricas de negocio, SCD tipo 2, deduplicacion.

    Lo que ya esta resuelto alrededor: DDL Iceberg con particionado y propiedades,
    MERGE idempotente por clave, compactacion semanal y expiracion de snapshots.

    Por defecto: si hay una sola fuente la devuelve tal cual; si hay varias, falla
    explicitamente en vez de adivinar un join.
    """
    if len(sources) == 1:
        return next(iter(sources.values()))
    raise NotImplementedError(
        f"tabla '{table_name}': implementa build_model() para combinar "
        f"{sorted(sources)} — no se puede inferir el join."
    )


def ensure_table(table_name: str, df, partition_by: str) -> None:
    """CREATE TABLE IF NOT EXISTS con propiedades explicitas.

    Las propiedades importan: sin `write.target-file-size-bytes` Iceberg escribe
    archivos chicos, y sin la limpieza de metadata el arbol de snapshots crece
    indefinidamente incluso con expire_snapshots corriendo.
    """
    fqn = f"{CATALOG}.{DATABASE}.{table_name}"
    df.createOrReplaceTempView(f"src_{table_name}")
    spark.sql(
        f"""
        CREATE TABLE IF NOT EXISTS {fqn}
        USING iceberg
        PARTITIONED BY ({partition_by})
        TBLPROPERTIES (
            'format-version' = '2',
            'write.parquet.compression-codec' = 'snappy',
            'write.target-file-size-bytes' = '134217728',
            'write.distribution-mode' = 'hash',
            'write.metadata.delete-after-commit.enabled' = 'true',
            'write.metadata.previous-versions-max' = '20'
        )
        AS SELECT * FROM src_{table_name} WHERE 1 = 0
        """
    )


def merge(table_name: str, df, merge_keys: list) -> int:
    """MERGE INTO por la clave de negocio: reejecutar el job no duplica filas."""
    fqn = f"{CATALOG}.{DATABASE}.{table_name}"
    view = f"stage_{table_name}"
    df.createOrReplaceTempView(view)
    on_clause = " AND ".join(f"t.`{k}` = s.`{k}`" for k in merge_keys)
    spark.sql(
        f"""
        MERGE INTO {fqn} AS t
        USING {view} AS s
        ON {on_clause}
        WHEN MATCHED THEN UPDATE SET *
        WHEN NOT MATCHED THEN INSERT *
        """
    )
    return df.count()


def process(item: dict) -> dict:
    table_name = item["sk"].split("#", 1)[1]
    source_tables = [str(s) for s in item.get("source_tables", [table_name])]
    merge_keys = [str(k) for k in item.get("merge_keys", [])]
    partition_by = item.get("partition_by", "days(dt)")

    if not merge_keys:
        raise ValueError(
            f"tabla '{table_name}': falta 'merge_keys' en la configuracion. "
            "Sin clave de negocio el MERGE no puede ser idempotente."
        )

    sources = {}
    for src in source_tables:
        path = f"{SOURCE}/{src}/"
        log.info("tabla %s: leyendo %s", table_name, path)
        sources[src] = spark.read.parquet(path)

    df = build_model(sources, table_name)
    if "dt" in df.columns:
        df = df.withColumn("dt", F.to_date(F.col("dt")))

    ensure_table(table_name, df, partition_by)
    merged = merge(table_name, df, merge_keys)

    publish_metric("CuratedRows", merged, table_name)
    log.info("tabla %s: %d filas mergeadas", table_name, merged)
    return {"table": table_name, "rows": merged}


tables = load_tables()
if not tables:
    log.info(
        "sin tablas activas en %s (jobName=clean_to_curated). "
        "Carga items 'table#<nombre>' con enabled=true y merge_keys para empezar.",
        args["config_table"],
    )
    job.commit()
    sys.exit(0)

summaries, failures = [], []
for entry in tables:
    try:
        summaries.append(process(entry))
    except Exception as exc:  # noqa: BLE001
        name = entry.get("sk", "?")
        log.error("tabla %s fallo: %s", name, exc, exc_info=True)
        failures.append(f"{name}: {exc}")

log.info("resumen: %s", json.dumps({"tables": summaries, "failures": failures}))
job.commit()

if failures:
    raise RuntimeError(f"{len(failures)} tabla(s) fallaron: {'; '.join(failures)}")
