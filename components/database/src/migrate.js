#!/usr/bin/env node

const { exec } = require('child_process');
const { promisify } = require('util');
const { createHash } = require('crypto');
const path = require('path');
const fs = require('fs');

const execAsync = promisify(exec);

const MIGRATIONS_TABLE = '_migrations';
const SCRIPTS_DIR = path.join(__dirname, 'scripts');

function psqlCommand(sql) {
  const oneLine = sql.split('\n').map(l => l.trim()).join(' ');
  return execAsync(`psql "${process.env.DATABASE_URL}" -tAc ${JSON.stringify(oneLine)}`);
}

function psqlFile(filePath) {
  return execAsync(`psql "${process.env.DATABASE_URL}" -f "${filePath}"`);
}

function fileHash(filePath) {
  const content = fs.readFileSync(filePath);
  return createHash('sha256').update(content).digest('hex');
}

async function waitForDatabase() {
  const maxAttempts = 30;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      await execAsync(`pg_isready -h ${process.env.DATABASE_HOST} -p ${process.env.DATABASE_PORT} -U ${process.env.DATABASE_USER}`);
      console.log('Database is ready');
      return;
    } catch {
      console.log(`Database not ready (attempt ${attempt}/${maxAttempts})`);
      await new Promise(resolve => setTimeout(resolve, 2000));
    }
  }

  throw new Error('Database did not become ready in time');
}

async function ensureMigrationsTable() {
  await psqlCommand(`
    CREATE TABLE IF NOT EXISTS ${MIGRATIONS_TABLE} (
      id SERIAL PRIMARY KEY,
      name TEXT UNIQUE NOT NULL,
      hash TEXT NOT NULL,
      duration_ms INTEGER NOT NULL,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
}

async function getAppliedMigrations() {
  const { stdout } = await psqlCommand(`SELECT name, hash FROM ${MIGRATIONS_TABLE} ORDER BY name`);
  const applied = new Map();
  for (const line of stdout.trim().split('\n')) {
    if (!line) continue;
    const [name, hash] = line.split('|');
    applied.set(name, hash);
  }
  return applied;
}

async function recordMigration(name, hash, durationMs) {
  await psqlCommand(`INSERT INTO ${MIGRATIONS_TABLE} (name, hash, duration_ms) VALUES ('${name}', '${hash}', ${durationMs})`);
}

async function runSQLFile(filePath) {
  const { stdout } = await psqlFile(filePath);
  if (stdout) console.log(stdout);
}

async function runJSFile(filePath) {
  const script = require(filePath);
  if (typeof script === 'function') {
    await script();
  } else if (script.default && typeof script.default === 'function') {
    await script.default();
  }
}

async function runMigrations() {
  if (!fs.existsSync(SCRIPTS_DIR)) {
    console.log('No scripts directory found, nothing to migrate');
    return;
  }

  const applied = await getAppliedMigrations();

  const files = fs.readdirSync(SCRIPTS_DIR)
    .filter(file => file.endsWith('.sql') || file.endsWith('.js'))
    .sort();

  const lastApplied = [...applied.keys()].sort().at(-1);
  let appliedCount = 0;

  for (const file of files) {
    const filePath = path.join(SCRIPTS_DIR, file);
    const hash = fileHash(filePath);

    if (applied.has(file)) {
      const appliedHash = applied.get(file);
      if (appliedHash !== hash) {
        throw new Error(`Migration ${file} was modified after being applied (expected hash ${appliedHash}, got ${hash})`);
      }
      console.log(`Skipping ${file} (already applied)`);
      continue;
    }

    if (lastApplied && file < lastApplied) {
      throw new Error(`Migration ${file} sorts before already applied migration ${lastApplied}. Cannot insert a migration out of order.`);
    }

    console.log(`Applying ${file}...`);
    const start = Date.now();

    if (file.endsWith('.sql')) {
      await runSQLFile(filePath);
    } else {
      await runJSFile(filePath);
    }

    const durationMs = Date.now() - start;
    await recordMigration(file, hash, durationMs);
    console.log(`Applied ${file} (${durationMs}ms)`);
    appliedCount++;
  }

  if (appliedCount === 0) {
    console.log('No new migrations to apply');
  } else {
    console.log(`${appliedCount} migration(s) applied`);
  }
}

async function migrate() {
  try {
    console.log('Starting migration process...');
    await waitForDatabase();
    await ensureMigrationsTable();
    await runMigrations();
    console.log('Migration process completed successfully');
    process.exit(0);
  } catch (error) {
    console.error('Migration process failed:', error);
    process.exit(1);
  }
}

process.on('SIGTERM', () => process.exit(0));
process.on('SIGINT', () => process.exit(0));

migrate();
