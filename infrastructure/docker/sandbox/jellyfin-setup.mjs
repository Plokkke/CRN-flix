#!/usr/bin/env node
// Sets up the sandbox Jellyfin once: first-run wizard, a local admin account, the Films / Séries
// libraries on the fake library, and an API key for the engine (`pnpm dev:local` fetches it itself).
// Idempotent.
import { ADMIN, adminToken, BASE_URL, call, engineApiKey } from './jellyfin.mjs';

const LIBRARIES = [
  { name: 'Films', collectionType: 'movies', path: '/medias/movies' },
  { name: 'Séries', collectionType: 'tvshows', path: '/medias/series' },
];

async function completeWizard() {
  const info = await call('GET', '/System/Info/Public');
  if (info.StartupWizardCompleted) {
    return;
  }
  await call('POST', '/Startup/Configuration', {
    body: { UICulture: 'fr-FR', MetadataCountryCode: 'FR', PreferredMetadataLanguage: 'fr' },
  });
  await call('GET', '/Startup/User');
  await call('POST', '/Startup/User', { body: ADMIN });
  await call('POST', '/Startup/Complete');
  console.log(`First-run wizard completed (${ADMIN.Name} / ${ADMIN.Password})`);
}

async function ensureLibraries(token) {
  const existing = await call('GET', '/Library/VirtualFolders', { token });
  for (const library of LIBRARIES) {
    if (existing.some((folder) => folder.Locations.includes(library.path))) {
      continue;
    }
    await call('POST', '/Library/VirtualFolders', {
      token,
      query: { name: library.name, collectionType: library.collectionType, refreshLibrary: true },
      body: { LibraryOptions: { PathInfos: [{ Path: library.path }] } },
    });
    console.log(`Library « ${library.name} » created on ${library.path}`);
  }
}

await completeWizard();
const token = await adminToken();
await ensureLibraries(token);
await engineApiKey(token);
console.log(`Jellyfin ready on ${BASE_URL} (${ADMIN.Name} / ${ADMIN.Password})`);
