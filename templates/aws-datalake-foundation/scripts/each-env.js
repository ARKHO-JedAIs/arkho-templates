#!/usr/bin/env node
/**
 * Corre un comando de la CDK CLI una vez por cada ambiente de este proyecto.
 *
 *   node scripts/each-env.js synth --quiet
 *   node scripts/each-env.js synth --quiet -c nag=true
 *   node scripts/each-env.js diff
 *
 * Existe porque la lista de ambientes es distinta en cada proyecto: un `nag:all`
 * con los cuatro nombres escritos a mano fallaría en cualquier proyecto que tenga
 * menos, y `nag:all` es el gate de CI.
 *
 * Los ambientes se descubren igual que en lib/config/environments.ts: son los
 * archivos `config/<nombre>.env` que existen. No hay lista que mantener en
 * sincronía, así que este script no puede quedar desalineado con la app.
 */
'use strict';

const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const CONFIG_DIR = path.join(__dirname, '..', 'config');

// Espejo de CANONICAL_ORDER en lib/config/environments.ts. Acá solo decide el
// ORDEN de iteración —el conjunto sale del disco—, así que si se desincroniza no
// rompe nada: los nombres que no estén van al final, alfabéticamente.
const CANONICAL_ORDER = ['dev', 'qa', 'stg', 'prod'];

const readEnvNames = () => {
  let entries;
  try {
    entries = fs.readdirSync(CONFIG_DIR);
  } catch {
    throw new Error(
      `No se encontró el directorio de configuración "${CONFIG_DIR}". Cada ambiente ` +
        'es un archivo config/<nombre>.env.',
    );
  }
  const names = entries
    .filter((name) => name.endsWith('.env'))
    .map((name) => name.slice(0, -'.env'.length))
    .sort((a, b) => {
      const ra = CANONICAL_ORDER.indexOf(a);
      const rb = CANONICAL_ORDER.indexOf(b);
      if (ra === rb) return a.localeCompare(b);
      return (ra === -1 ? CANONICAL_ORDER.length : ra) - (rb === -1 ? CANONICAL_ORDER.length : rb);
    });
  if (names.length === 0) {
    throw new Error(`No hay ningún archivo config/<ambiente>.env en "${CONFIG_DIR}".`);
  }
  return names;
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
    console.error(`\nNo se pudo ejecutar "${command}": ${result.error.message}`);
    process.exit(1);
  }
  // Aborta en el primer fallo: seguir con los demás ambientes solo entierra el
  // error real bajo más salida.
  if (result.status !== 0) {
    console.error(`\nFalló en el ambiente "${name}" (exit ${result.status}).`);
    process.exit(result.status ?? 1);
  }
}

console.log(`\nOK en ${names.length} ambiente(s): ${names.join(', ')}`);
