import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const packageJson = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
const setupSource = readFileSync(join(root, 'scripts', 'setup-db.mjs'), 'utf8');

assert.equal(
  packageJson.scripts.build,
  'node scripts/verify-build.mjs',
  'deployment build must use the database-free verifier',
);
assert.doesNotMatch(
  setupSource,
  /@neondatabase\/serverless|sql\.query\(/,
  'setup-db must not retain an automatic database mutation path',
);

const result = spawnSync(process.execPath, ['scripts/setup-db.mjs'], {
  cwd: root,
  encoding: 'utf8',
  env: {
    ...process.env,
    DATABASE_URL: 'postgresql://invalid:invalid@127.0.0.1:1/never',
  },
  timeout: 5_000,
});

assert.equal(result.error, undefined, `setup-db should not hang: ${result.error?.message ?? ''}`);
assert.equal(result.status, 0, `setup-db must be a harmless no-op: ${result.stderr}`);
assert.match(result.stdout, /automatic database setup is disabled/i);
assert.doesNotMatch(`${result.stdout}\n${result.stderr}`, /applying .*statements|schema ready/i);

console.log('build migration boundary contract passed');
