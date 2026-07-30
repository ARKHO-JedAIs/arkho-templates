"""Job Glue: Clean Zone -> Curated Zone (Apache Iceberg).

Genera las tablas analiticas en formato Iceberg (decision v2): ACID,
schema evolution, time travel y compactacion. Athena las consulta
directamente y permite vistas materializadas que postergan Redshift.

Requiere --datalake-formats iceberg (ya definido en el job) y la
configuracion del catalogo Iceberg via spark.conf (ver abajo).
"""
import sys

from awsglue.context import GlueContext
from awsglue.job import Job
from awsglue.utils import getResolvedOptions
from pyspark.context import SparkContext

args = getResolvedOptions(
    sys.argv, ["JOB_NAME", "source_bucket", "target_bucket", "config_table"]
)

sc = SparkContext()
glue_context = GlueContext(sc)
spark = glue_context.spark_session
job = Job(glue_context)
job.init(args["JOB_NAME"], args)

WAREHOUSE = f"s3://{args['target_bucket']}/iceberg/"

# Catalogo Iceberg sobre Glue Data Catalog
spark.conf.set("spark.sql.catalog.glue_catalog", "org.apache.iceberg.spark.SparkCatalog")
spark.conf.set("spark.sql.catalog.glue_catalog.warehouse", WAREHOUSE)
spark.conf.set(
    "spark.sql.catalog.glue_catalog.catalog-impl",
    "org.apache.iceberg.aws.glue.GlueCatalog",
)
spark.conf.set("spark.sql.catalog.glue_catalog.io-impl", "org.apache.iceberg.aws.s3.S3FileIO")

# TODO (implementacion):
# 1. Leer Clean Zone (parquet) por fuente.
# 2. Aplicar modelo analitico (joins, metricas de negocio, SCD si aplica).
# 3. MERGE INTO tablas Iceberg en glue_catalog.bk_<env>_curated.<tabla>
#    para cargas idempotentes.

job.commit()
