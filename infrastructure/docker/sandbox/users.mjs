#!/usr/bin/env node
// Fake subscribers for the sandbox: an engine user (active, emails to the local outbox) and a
// Jellyfin account each, tied together like an approved registration; then an example
// .sandbox/catalog.json with their requests (kept if it already exists: edit it freely).
// Idempotent. Run after `pnpm infra:up`, `pnpm sandbox:library` and `pnpm sandbox:jellyfin`.
import { execFileSync } from 'node:child_process';
import { existsSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { adminToken, call } from './jellyfin.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const CATALOG = path.join(ROOT, '.sandbox/catalog.json');
const COMPOSE = ['compose', '-f', path.join(ROOT, 'infrastructure/docker/compose.dev.yaml')];
const PASSWORD = 'sandbox';

const USERS = [
  { name: 'papa', email: 'papa@example.invalid' },
  { name: 'leo', email: 'leo@example.invalid' },
];

/** The sandbox database through its container: no client to install on the host. */
function sql(statement) {
  return execFileSync(
    'docker',
    [...COMPOSE, 'exec', '-T', 'postgres', 'psql', '-U', 'crn_flix', '-d', 'crn_flix', '-tAc', statement],
    { encoding: 'utf8' },
  ).trim();
}

const quote = (value) => `'${String(value).replace(/'/g, "''")}'`;

async function ensureJellyfinAccount(token, name) {
  const existing = (await call('GET', '/Users', { token })).find((user) => user.Name === name);
  return existing?.Id ?? (await call('POST', '/Users/New', { token, body: { Name: name, Password: PASSWORD } })).Id;
}

function ensureEngineUser({ name, email }, jellyfinId) {
  sql(
    `INSERT INTO users (name, messaging_key, messaging_id, status, jellyfin_id)
     VALUES (${quote(name)}, 'email', ${quote(email)}, 'active', ${quote(jellyfinId)})
     ON CONFLICT DO NOTHING`,
  );
  sql(`UPDATE users SET jellyfin_id = ${quote(jellyfinId)}, status = 'active' WHERE name = ${quote(name)}`);
}

const movie = (imdbId, title, year) => ({ type: 'movie', imdbId, title, year });
const show = (imdbId, title, year, episodes) => ({ type: 'show', imdbId, title, year, season: 1, episodes });

/** Titles of the fake library plus a few that are not in it (Inception, a new episode of Silo): the planner has work. */
function exampleCatalog(ids) {
  return {
    accounts: [
      {
        playerAccountId: ids.papa,
        requests: {
          WATCHLISTED: [movie('tt0078748', 'Alien', 1979), movie('tt1375666', 'Inception', 2010)],
          PROGRESS: [show('tt14688458', 'Silo', 2023, [1, 2, 3, 4])],
        },
        playheads: { tt14688458: { nextSeason: 1, nextEpisode: 3 } },
      },
      {
        playerAccountId: ids.leo,
        requests: {
          WATCHLISTED: [movie('tt0317219', 'Cars', 2006), movie('tt0120815', 'Saving Private Ryan', 1998)],
          PROGRESS: [show('tt7678620', 'Bluey', 2018, [1, 2, 3])],
        },
        playheads: { tt7678620: { nextSeason: 1, nextEpisode: 2 } },
      },
    ],
  };
}

const token = await adminToken();
const ids = {};
for (const user of USERS) {
  ids[user.name] = await ensureJellyfinAccount(token, user.name);
  ensureEngineUser(user, ids[user.name]);
  console.log(`User ${user.name}: engine + Jellyfin account (password « ${PASSWORD} »)`);
}
if (existsSync(CATALOG)) {
  console.log(`${path.relative(ROOT, CATALOG)} kept as is`);
} else {
  writeFileSync(CATALOG, `${JSON.stringify(exampleCatalog(ids), null, 2)}\n`);
  console.log(`${path.relative(ROOT, CATALOG)} written`);
}
