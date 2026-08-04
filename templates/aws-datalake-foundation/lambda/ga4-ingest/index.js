/**
 * Ingesta GA4 → Raw Zone.
 * Obtiene credenciales desde Secrets Manager y deposita NDJSON particionado
 * por fecha en s3://$RAW_BUCKET/$TARGET_PREFIX/dt=YYYY-MM-DD/.
 *
 * Lo que ya está resuelto: credenciales, partición por fecha del DATO, clave
 * idempotente y no-op cuando no hay filas.
 *
 * TODO (implementación): reemplazar `fetchRows` por la llamada real a la GA4 Data
 * API (runReport) con paginación y reintentos.
 */
const crypto = require('node:crypto');
const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3');
const { SecretsManagerClient, GetSecretValueCommand } = require('@aws-sdk/client-secrets-manager');

const s3 = new S3Client({});
const secrets = new SecretsManagerClient({});

/** Fecha del DATO, no de la ejecución: el reporte pedido es del día anterior. */
function dataDate() {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

/**
 * <<< IMPLEMENTAR: llamada real a la GA4 Data API >>>
 * Debe devolver un array de objetos planos (una fila por elemento).
 */
async function fetchRows(_credentials, _date) {
  // const report = await runGa4Report(_credentials, { dimensions, metrics, dateRange: _date });
  // return report.rows.map(normalize);
  return [];
}

exports.handler = async () => {
  const { RAW_BUCKET, TARGET_PREFIX, SECRET_ARN } = process.env;

  const secret = await secrets.send(new GetSecretValueCommand({ SecretId: SECRET_ARN }));
  const credentials = JSON.parse(secret.SecretString ?? '{}');
  if (!credentials.property_id) {
    throw new Error('Secreto GA4 sin cargar: define property_id y la service account');
  }

  const dt = dataDate();
  const rows = await fetchRows(credentials, dt);

  // Sin filas NO se escribe nada. Antes se escribía `body || '{}'`, así que cada
  // corrida programada dejaba un `{}` literal en la Raw Zone: una fila vacía que el
  // ETL leería como un registro real.
  if (rows.length === 0) {
    console.log(JSON.stringify({ msg: 'ingesta ga4 sin filas, nada que escribir', dt }));
    return { statusCode: 200, dt, rows: 0, written: false };
  }

  const body = rows.map((r) => JSON.stringify(r)).join('\n');
  // Clave derivada del CONTENIDO, no de Date.now(): un reintento de EventBridge con
  // los mismos datos sobrescribe el mismo objeto en vez de crear un duplicado
  // parcial en la misma partición.
  const digest = crypto.createHash('sha256').update(body).digest('hex').slice(0, 16);
  const key = `${TARGET_PREFIX}dt=${dt}/ga4-${digest}.ndjson`;

  await s3.send(new PutObjectCommand({
    Bucket: RAW_BUCKET,
    Key: key,
    Body: body,
    ContentType: 'application/x-ndjson',
  }));

  console.log(JSON.stringify({ msg: 'ingesta ga4 ok', key, dt, rows: rows.length }));
  return { statusCode: 200, key, dt, rows: rows.length, written: true };
};
