import { readFileSync } from 'fs';
import { signJwt } from './jwt.js';
import { expandPath } from './pushconfig.js';

interface ServiceAccount {
  project_id?: string;
  client_email?: string;
  private_key?: string;
  token_uri?: string;
}

const FCM_SCOPE = 'https://www.googleapis.com/auth/firebase.messaging';

function readServiceAccount(serviceAccountPath: string): Required<ServiceAccount> {
  let sa: ServiceAccount;
  try {
    sa = JSON.parse(readFileSync(expandPath(serviceAccountPath), 'utf8'));
  } catch {
    throw new Error(`Could not read the service-account file at ${serviceAccountPath}`);
  }
  if (!sa.project_id || !sa.client_email || !sa.private_key) {
    throw new Error('Service-account file is missing project_id, client_email, or private_key.');
  }
  return {
    project_id: sa.project_id,
    client_email: sa.client_email,
    private_key: sa.private_key,
    token_uri: sa.token_uri ?? 'https://oauth2.googleapis.com/token',
  };
}

async function getAccessToken(sa: Required<ServiceAccount>): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const jwt = signJwt(
    { alg: 'RS256', typ: 'JWT' },
    { iss: sa.client_email, scope: FCM_SCOPE, aud: sa.token_uri, iat: now, exp: now + 3600 },
    sa.private_key,
    'RSA-SHA256',
  );

  const res = await fetch(sa.token_uri, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: jwt,
    }),
  });
  if (!res.ok) {
    throw new Error(`FCM auth failed (${res.status}): ${(await res.text()).trim()}`);
  }
  const data = (await res.json()) as { access_token?: string };
  if (!data.access_token) throw new Error('FCM auth returned no access_token.');
  return data.access_token;
}

// payload is the FCM message body (notification/data/apns/…); simon injects the token.
export async function sendFcm(serviceAccountPath: string, token: string, payload: object): Promise<void> {
  const sa = readServiceAccount(serviceAccountPath);
  const accessToken = await getAccessToken(sa);

  const res = await fetch(`https://fcm.googleapis.com/v1/projects/${sa.project_id}/messages:send`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ message: { ...payload, token } }),
  });
  if (!res.ok) {
    throw new Error(`FCM send failed (${res.status}): ${(await res.text()).trim()}`);
  }
}
