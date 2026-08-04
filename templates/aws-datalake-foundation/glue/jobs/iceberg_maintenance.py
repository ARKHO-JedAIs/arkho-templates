"""Job Glue: mantenimiento de las tablas Iceberg de la Curated Zone.

Sin mantenimiento una tabla Iceberg se degrada de forma garantizada: los archivos
chicos se acumulan (cada commit escribe nuevos), el arbol de metadata crece sin
limite y los archivos huerfanos de escrituras fallidas nunca se liberan. El efecto es
progresivo: las queries se vuelven lentas y el costo de S3 sube sin explicacion.

Este job DESCUBRE las tablas en runtime en vez de recibir una lista. Es deliberado:
`glue.CfnTableOptimizer` —el mecanismo gestionado de AWS— exige el nombre de la tabla
en tiempo de sintesis, y este template no crea tablas: las crean el ETL del cliente y
los crawlers. Descubriendolas, el mantenimiento funciona con cero configuracion y se
adapta a medida que aparecen tablas nuevas.

Cuando tus tablas sean estables, migrar a CfnTableOptimizer es el upgrade natural
(lo gestiona AWS, sin job propio). Ver el README.

Requiere `spark.sql.extensions` de Iceberg, que llega por `--conf` desde la definicion
del job: los procedimientos `CALL system.*` no existen sin esa extension.
"""
import sys
import logging
from datetime import datetime, timedelta, timezone

import boto3
from awsglue.context import GlueContext
from awsglue.job import Job
from awsglue.utils import getResolvedOptions
from pyspark.context import SparkContext

logging.basicConfig(
    level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s", stream=sys.stdout
)
log = logging.getLogger("iceberg_maintenance")

args = getResolvedOptions(
    sys.argv,
    ["JOB_NAME", "curated_database", "snapshot_retention_days", "metric_namespace", "env_name"],
)

sc = SparkContext()
glue_context = GlueContext(sc)
spark = glue_context.spark_session
job = Job(glue_context)
job.init(args["JOB_NAME"], args)

DATABASE = args["curated_database"]
CATALOG = "glue_catalog"
RETENTION_DAYS = int(args["snapshot_retention_days"])
# `remove_orphan_files` usa una ventana mas conservadora que la de snapshots: borrar
# archivos recientes podria pisar una escritura en curso.
ORPHAN_DAYS = max(RETENTION_DAYS, 3)

glue = boto3.client("glue")
cloudwatch = boto3.client("cloudwatch")


def iceberg_tables() -> list:
    """Tablas ICEBERG de la base curated, via paginacion del catalogo."""
    found = []
    paginator = glue.get_paginator("get_tables")
    for page in paginator.paginate(DatabaseName=DATABASE):
        for table in page.get("TableList", []):
            params = table.get("Parameters", {}) or {}
            if params.get("table_type", "").upper() == "ICEBERG":
                found.append(table["Name"])
    return found


def publish_metric(name: str, value: float) -> None:
    try:
        cloudwatch.put_metric_data(
            Namespace=args["metric_namespace"],
            MetricData=[
                {
                    "MetricName": name,
                    "Value": value,
                    "Unit": "Count",
                    "Timestamp": datetime.now(timezone.utc),
                    "Dimensions": [{"Name": "Environment", "Value": args["env_name"]}],
                }
            ],
        )
    except Exception:  # noqa: BLE001
        log.warning("no se pudo publicar la metrica %s", name, exc_info=True)


def maintain(table_name: str) -> None:
    fqn = f"{CATALOG}.{DATABASE}.{table_name}"
    cutoff = (datetime.now(timezone.utc) - timedelta(days=RETENTION_DAYS)).strftime(
        "%Y-%m-%d %H:%M:%S"
    )
    orphan_cutoff = (datetime.now(timezone.utc) - timedelta(days=ORPHAN_DAYS)).strftime(
        "%Y-%m-%d %H:%M:%S"
    )

    # 1. Compactacion: junta los archivos chicos en archivos del tamano objetivo.
    log.info("%s: compactando", fqn)
    spark.sql(
        f"""
        CALL {CATALOG}.system.rewrite_data_files(
            table => '{DATABASE}.{table_name}',
            options => map('min-input-files','5','target-file-size-bytes','134217728')
        )
        """
    ).show(truncate=False)

    # 2. Compacta tambien los manifests, que se fragmentan con cada commit.
    log.info("%s: reescribiendo manifests", fqn)
    spark.sql(
        f"CALL {CATALOG}.system.rewrite_manifests(table => '{DATABASE}.{table_name}')"
    ).show(truncate=False)

    # 3. Expira snapshots viejos. Esto es lo que acota la ventana de time-travel:
    #    despues de esto ya no se puede consultar el estado anterior a `cutoff`.
    log.info("%s: expirando snapshots anteriores a %s", fqn, cutoff)
    spark.sql(
        f"""
        CALL {CATALOG}.system.expire_snapshots(
            table => '{DATABASE}.{table_name}',
            older_than => TIMESTAMP '{cutoff}',
            retain_last => 5
        )
        """
    ).show(truncate=False)

    # 4. Libera archivos huerfanos de escrituras que fallaron a medio commit.
    log.info("%s: removiendo huerfanos anteriores a %s", fqn, orphan_cutoff)
    spark.sql(
        f"""
        CALL {CATALOG}.system.remove_orphan_files(
            table => '{DATABASE}.{table_name}',
            older_than => TIMESTAMP '{orphan_cutoff}'
        )
        """
    ).show(truncate=False)


tables = iceberg_tables()
if not tables:
    log.info(
        "no hay tablas Iceberg en %s todavia — nada que mantener. "
        "Este job es inofensivo hasta que el ETL cree la primera tabla.",
        DATABASE,
    )
    job.commit()
    sys.exit(0)

log.info("%d tabla(s) Iceberg a mantener: %s", len(tables), ", ".join(tables))

failures = []
for name in tables:
    try:
        maintain(name)
    except Exception as exc:  # noqa: BLE001 - una tabla no debe tumbar las demas
        log.error("tabla %s fallo: %s", name, exc, exc_info=True)
        failures.append(f"{name}: {exc}")

publish_metric("IcebergTablesMaintained", len(tables) - len(failures))
job.commit()

if failures:
    raise RuntimeError(f"{len(failures)} tabla(s) fallaron: {'; '.join(failures)}")
