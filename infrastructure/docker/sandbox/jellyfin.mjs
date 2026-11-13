// The sandbox Jellyfin's API, shared by the sandbox scripts. Local only: the admin password
// below protects nothing but this sandbox.
export const BASE_URL = 'http://127.0.0.1:8096';
export const ADMIN = { Name: 'admin', Password: 'sandbox' };
export const APP = 'crn-flix-sandbox';

const CLIENT = `MediaBrowser Client="${APP}", Device="sandbox", DeviceId="${APP}", Version="1.0.0"`;

export async function call(method, route, { token, body, query } = {}) {
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

/** A session token of the sandbox admin (run `pnpm sandbox:jellyfin` first). */
export async function adminToken() {
  const { AccessToken } = await call('POST', '/Users/AuthenticateByName', {
    body: { Username: ADMIN.Name, Pw: ADMIN.Password },
  });
  return AccessToken;
}
