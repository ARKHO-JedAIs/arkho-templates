"""Job Glue: Raw Zone -> Clean Zone.

Valida y estandariza los datos originales (SFTP CSV, GA4, Meta NDJSON).
Los parametros por fuente (paths, esquemas, flags activo/inactivo) se leen
desde la tabla DynamoDB indicada en --config_table.

Bookmarks habilitados: solo procesa datos nuevos en cada corrida.
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

SOURCE = f"s3://{args['source_bucket']}"
TARGET = f"s3://{args['target_bucket']}"

# TODO (implementacion):
# 1. Leer configuracion de fuentes activas desde DynamoDB (args['config_table']).
# 2. Por cada fuente: leer con bookmarks, castear tipos, validar nulos/duplicados,
#    normalizar nombres de columnas (snake_case) y zonas horarias.
# 3. Escribir en Clean Zone particionado por fuente y fecha:
#    df.write.mode('append').partitionBy('dt').parquet(f"{TARGET}/{fuente}/")

job.commit()
