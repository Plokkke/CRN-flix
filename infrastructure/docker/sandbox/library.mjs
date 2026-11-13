#!/usr/bin/env node
// Fake library for the local sandbox: real titles (real imdb ids, so Jellyfin shows their real
// artwork), each file a copy of the same one-second black video. Named by the engine's own
// layout plugin, exactly as the engine would place them. Idempotent: existing files are kept.
import { execFileSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, renameSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const MEDIAS = path.join(ROOT, '.sandbox/medias');
const SAMPLE = path.join(ROOT, '.sandbox/sample.mkv');
const COMPOSE = ['compose', '-f', path.join(ROOT, 'infrastructure/docker/compose.dev.yaml')];

const { JellyfinLayout } = createRequire(import.meta.url)(path.join(ROOT, 'plugins/layouts/jellyfin/dist/index.js'));

/** A few kids titles, a few that adult rules may refuse, a war film for the « school exemption » case. */
const MOVIES = [
  { title: 'Toy Story', year: 1995, imdbId: 'tt0114709' },
  { title: 'Cars', year: 2006, imdbId: 'tt0317219' },
  { title: 'Spirited Away', year: 2001, imdbId: 'tt0245429' },
  { title: 'Alien', year: 1979, imdbId: 'tt0078748' },
  { title: 'Saving Private Ryan', year: 1998, imdbId: 'tt0120815' },
  { title: 'The Matrix', year: 1999, imdbId: 'tt0133093' },
];

const SHOWS = [
  { title: 'Bluey', year: 2018, imdbId: 'tt7678620', episodes: [1, 2, 3] },
  { title: 'Silo', year: 2023, imdbId: 'tt14688458', episodes: [1, 2, 3] },
];

/** The ffmpeg shipped in the Jellyfin image: nothing to install on the host. */
function ensureSample() {
  if (existsSync(SAMPLE)) {
    return;
  }
  mkdirSync(MEDIAS, { recursive: true });
  const args = ['-loglevel', 'error', '-f', 'lavfi', '-i', 'color=c=black:s=320x240:d=1', '-c:v', 'libx264'];
  execFileSync(
    'docker',
    [...COMPOSE, 'exec', '-T', 'jellyfin', '/usr/lib/jellyfin-ffmpeg/ffmpeg', ...args, '-pix_fmt', 'yuv420p', '-y', '/medias/.sample.mkv'],
    { stdio: 'inherit' },
  );
  renameSync(path.join(MEDIAS, '.sample.mkv'), SAMPLE);
}

function place(identity) {
  const { section, folders, fileName } = new JellyfinLayout().place(identity);
  const folder = path.join(MEDIAS, section, ...folders);
  const file = path.join(folder, `${fileName}.mkv`);
  if (existsSync(file)) {
    return false;
  }
  mkdirSync(folder, { recursive: true });
  copyFileSync(SAMPLE, file);
  return true;
}

const base = { seasonNumber: null, episodeNumber: null, episodeNumberEnd: null };

ensureSample();
const created = [
  ...MOVIES.map((movie) => place({ ...base, ...movie, type: 'movie' })),
  ...SHOWS.flatMap(({ episodes, ...show }) =>
    episodes.map((episodeNumber) => place({ ...base, ...show, type: 'episode', seasonNumber: 1, episodeNumber })),
  ),
].filter(Boolean).length;

console.log(`Fake library in ${path.relative(ROOT, MEDIAS)}: ${created} file(s) created`);
