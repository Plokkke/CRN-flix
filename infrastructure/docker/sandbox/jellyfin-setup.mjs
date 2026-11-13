#!/usr/bin/env node
// Sets up the sandbox Jellyfin once: first-run wizard, a local admin account, the Films / Séries
// libraries on the fake library, and an API key for the engine (printed for .env.local).
// Idempotent. Local only: the admin password below protects nothing but this sandbox.
const BASE_URL = 'http://127.0.0.1:8096';
const ADMIN = { Name: 'admin', Password: 'sandbox' };
const APP = 'crn-flix-sandbox';
const CLIENT = `MediaBrowser Client="${APP}", Device="sandbox", DeviceId="${APP}", Version="1.0.0"`;

const LIBRARIES = [
  { name: 'Films', collectionType: 'movies', path: '/medias/movies' },
  { name: 'Séries', collectionType: 'tvshows', path: '/medias/series' },
];

async function call(method, route, { token, body, query } = {}) {
  const url = new URL(route, BASE_URL);
  Object.entries(query ?? {}).forEach(([key, value]) => url.searchParams.set(key, String(value)));
  const response = await fetch(url, {
    method,
    headers: {
      Authorization: token ? `${CLIENT}, Token="${token}"` : CLIENT,
      ...(body && { 'Content-Type': 'application/json' }),
    },
    body: body && JSON.stringify(body),
  });
  if (!response.ok) {
    throw new Error(`${method} ${route}: ${response.status} ${await response.text()}`);
  }
  const text = await response.text();
  return text ? JSON.parse(text) : null;
}

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
  console.log('First-run wizard completed (admin / sandbox)');
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

async function apiKey(token) {
  const find = async () => (await call('GET', '/Auth/Keys', { token })).Items.find((key) => key.AppName === APP);
  if (!(await find())) {
    await call('POST', '/Auth/Keys', { token, query: { app: APP } });
  }
  return (await find()).AccessToken;
}

await completeWizard();
const { AccessToken } = await call('POST', '/Users/AuthenticateByName', {
  body: { Username: ADMIN.Name, Pw: ADMIN.Password },
});
await ensureLibraries(AccessToken);
console.log(`\nJellyfin ready on ${BASE_URL} (admin / sandbox). For components/api/.env.local:`);
console.log(`JELLYFIN_URL=${BASE_URL}`);
console.log(`JELLYFIN_TOKEN=${await apiKey(AccessToken)}`);
