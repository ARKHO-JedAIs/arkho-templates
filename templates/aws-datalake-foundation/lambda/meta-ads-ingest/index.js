/**
 * Ingesta Meta Ads (Marketing API) → Raw Zone.
 * Misma convención que ga4-ingest: NDJSON particionado por fecha.
 *
 * TODO (Fase 0/implementación): reemplazar el placeholder por la llamada
 * real a Graph API /insights con paginación (cursor `after`) y reintentos.
 */
const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3');
const { SecretsManagerClient, GetSecretValueCommand } = require('@aws-sdk/client-secrets-manager');

const s3 = new S3Client({});
const secrets = new SecretsManagerClient({});

exports.handler = async () => {
  const { RAW_BUCKET, TARGET_PREFIX, SECRET_ARN } = process.env;

  const secret = await secrets.send(new GetSecretValueCommand({ SecretId: SECRET_ARN }));
  const credentials = JSON.parse(secret.SecretString ?? '{}');
  if (!credentials.access_token) {
    throw new Error('Secreto Meta sin cargar: define access_token y ad_account_id');
  }

  // --- TODO: llamada real a Meta Marketing API ---
  // const insights = await fetchInsights(credentials, { level: 'ad', datePreset: 'yesterday' });
  const rows = []; // placeholder

  const dt = new Date().toISOString().slice(0, 10);
  const key = `${TARGET_PREFIX}dt=${dt}/meta-ads-${Date.now()}.ndjson`;
  const body = rows.map((r) => JSON.stringify(r)).join('\n');

  await s3.send(new PutObjectCommand({ Bucket: RAW_BUCKET, Key: key, Body: body || '{}' }));

  console.log(JSON.stringify({ msg: 'ingesta meta ok', key, rows: rows.length }));
  return { statusCode: 200, key, rows: rows.length };
};
