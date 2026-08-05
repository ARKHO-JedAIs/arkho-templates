#!/usr/bin/env node
/**
 * Corre un comando de la CDK CLI una vez por cada ambiente de este proyecto.
 *
 *   node scripts/each-env.js synth --quiet
 *   node scripts/each-env.js synth --quiet -c nag=true
 *   node scripts/each-env.js diff
 *
 * Existe porque la lista de ambientes es distinta en cada proyecto generado: un
 * `nag:all` con los cuatro nombres escritos a mano fallaría en cualquier proyecto
 * que tenga menos, y `nag:all` es el gate de CI.
 *
 * La lista sale del context `environments` de cdk.json, no de un import de
 * lib/config/environments.ts, para que este script siga siendo node puro sin
 * registrar ts-node. Las dos copias no pueden divergir: test/environments.test.ts
 * afirma que coinciden.
 */
'use strict';

const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const CDK_JSON = path.join(__dirname, '..', 'cdk.json');

// Espejo de CANONICAL_ORDER en lib/config/environments.ts, para que la salida de
// este script vaya en el mismo orden que ACTIVE_ENV_NAMES. Solo afecta el orden de
// iteración —el conjunto recorrido es el mismo—, así que si se desincroniza no
// rompe nada; los nombres que no estén acá van al final, en el orden de cdk.json.
const CANONICAL_ORDER = ['dev', 'qa', 'stg', 'prod'];

const canonicalRank = (name) => {
  const i = CANONICAL_ORDER.indexOf(name);
  return i === -1 ? CANONICAL_ORDER.length : i;
};

const readEnvNames = () => {
  const raw = JSON.parse(fs.readFileSync(CDK_JSON, 'utf8'));
  const value = raw?.context?.environments;
  if (typeof value !== 'string') {
    throw new Error(
      `Falta el context "environments" en ${CDK_JSON}. Debe ser una lista separada ` +
        'por comas, p. ej. "dev, prod", igual que ACTIVE_ENV_NAMES en ' +
        'lib/config/environments.ts.',
    );
  }
  const names = value.split(',').map((s) => s.trim()).filter(Boolean);
  if (names.length === 0) {
    throw new Error(`El context "environments" de ${CDK_JSON} está vacío.`);
  }
  return names.sort((a, b) => canonicalRank(a) - canonicalRank(b));
};

const args = process.argv.slice(2);
if (args.length === 0) {
  console.error('Uso: node scripts/each-env.js <comando cdk> [flags...]');
  process.exit(64);
}

let names;
try {
  names = readEnvNames();
} catch (err) {
  console.error(err.message);
  process.exit(1);
}

console.log(`Ambientes: ${names.join(', ')}`);

for (const name of names) {
  const command = ['cdk', ...args, '-c', `env=${name}`].join(' ');
  console.log(`\n▸ ${command}`);
  // `shell: true` porque en Windows los binarios de node_modules/.bin son .cmd y
  // no son ejecutables directos. Los argumentos vienen de package.json, no de
  // entrada externa, así que no hay nada que escapar.
  const result = spawnSync(command, { stdio: 'inherit', shell: true });
  if (result.error) {
    console.error(`\nNo se pudo ejecutar '${command}': ${result.error.message}`);
    process.exit(1);
  }
  // Aborta en el primer fallo: seguir con los demás ambientes solo entierra el
  // error real bajo más salida.
  if (result.status !== 0) {
    console.error(`\nFalló en el ambiente '${name}' (exit ${result.status}).`);
    process.exit(result.status ?? 1);
  }
}

console.log(`\nOK en ${names.length} ambiente(s): ${names.join(', ')}`);
