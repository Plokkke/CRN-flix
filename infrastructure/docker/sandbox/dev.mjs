#!/usr/bin/env node
// Starts the engine on the sandbox (`pnpm dev`). Settings come from components/api/sandbox.env;
// the two values that are not local are fetched here and passed through the environment only, never
// written nor printed: the Jellyfin API key from the sandbox Jellyfin, the TMDB key from sops (Touch ID).
// Any variable already set in the shell wins, e.g. `FAKE_DOWNLOADER_DURATION_MS=2000 pnpm dev`.
import { execFileSync, spawn } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { adminToken, engineApiKey } from './jellyfin.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const SECRETS = path.join(ROOT, 'infrastructure/secrets/production.sops.yaml');
const AGE_KEY = path.join(os.homedir(), '.config/sops/age/se-identity.txt');

async function jellyfinToken() {
  try {
    return await engineApiKey(await adminToken());
  } catch (error) {
    throw new Error(`Sandbox Jellyfin not ready (run pnpm infra:up, then pnpm sandbox:jellyfin): ${error.message}`);
  }
}

/** The read-only TMDB key; without it the sandbox still runs, only titles, posters and identification fail. */
function tmdbKey() {
  try {
    return execFileSync('sops', ['decrypt', '--extract', '["tmdb_api_key"]', SECRETS], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      env: { SOPS_AGE_KEY_FILE: AGE_KEY, ...process.env },
    }).trim();
  } catch {
    console.warn('TMDB key not decrypted (sops): running with a placeholder, TMDB calls will fail');
    return 'placeholder';
  }
}

const env = {
  JELLYFIN_TOKEN: await jellyfinToken(),
  TMDB_API_KEY: process.env.TMDB_API_KEY ?? tmdbKey(),
  ...process.env,
};
spawn('pnpm', ['--filter', '@crn-flix/api', 'dev'], { cwd: ROOT, env, stdio: 'inherit' }).on('exit', (code) =>
  process.exit(code ?? 1),
);
