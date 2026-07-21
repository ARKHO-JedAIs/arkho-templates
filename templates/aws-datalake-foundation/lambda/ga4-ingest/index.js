/**
 * Ingesta GA4 → Raw Zone.
 * Obtiene credenciales desde Secrets Manager y deposita NDJSON particionado
 * por fecha en s3://$RAW_BUCKET/$TARGET_PREFIX/dt=YYYY-MM-DD/.
 *
 * TODO (Fase 0/implementación): reemplazar el placeholder por la llamada
 * real a la GA4 Data API (runReport) con paginación y reintentos.
 */
const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3');
const { SecretsManagerClient, GetSecretValueCommand } = require('@aws-sdk/client-secrets-manager');

const s3 = new S3Client({});
const secrets = new SecretsManagerClient({});

exports.handler = async () => {
  const { RAW_BUCKET, TARGET_PREFIX, SECRET_ARN } = process.env;

  const secret = await secrets.send(new GetSecretValueCommand({ SecretId: SECRET_ARN }));
  const credentials = JSON.parse(secret.SecretString ?? '{}');
  if (!credentials.property_id) {
    throw new Error('Secreto GA4 sin cargar: define property_id y la service account');
  }

  // --- TODO: llamada real a GA4 Data API ---
  // const report = await runGa4Report(credentials, { dimensions, metrics, dateRange });
  const rows = []; // placeholder

  const dt = new Date().toISOString().slice(0, 10);
  const key = `${TARGET_PREFIX}dt=${dt}/ga4-${Date.now()}.ndjson`;
  const body = rows.map((r) => JSON.stringify(r)).join('\n');

  await s3.send(new PutObjectCommand({ Bucket: RAW_BUCKET, Key: key, Body: body || '{}' }));

  console.log(JSON.stringify({ msg: 'ingesta ga4 ok', key, rows: rows.length }));
  return { statusCode: 200, key, rows: rows.length };
};
