import { readFileSync } from 'fs';
import http2 from 'http2';
import { signJwt } from './jwt.js';
import { ApnsConfig, expandPath } from './pushconfig.js';

function buildToken(cfg: ApnsConfig): string {
  let key: string;
  try {
    key = readFileSync(expandPath(cfg.keyFile), 'utf8');
  } catch {
    throw new Error(`Could not read the APNs key file at ${cfg.keyFile}`);
  }
  const now = Math.floor(Date.now() / 1000);
  return signJwt({ alg: 'ES256', kid: cfg.keyId }, { iss: cfg.teamId, iat: now }, key, 'SHA256', true);
}

function postHttp2(
  host: string,
  path: string,
  headers: Record<string, string>,
  body: string,
): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const client = http2.connect(`https://${host}`);
    client.on('error', reject);

    const req = client.request({ ':method': 'POST', ':path': path, ...headers });
    let status = 0;
    let data = '';
    req.on('response', h => {
      status = Number(h[':status']);
    });
    req.setEncoding('utf8');
    req.on('data', chunk => {
      data += chunk;
    });
    req.on('end', () => {
      client.close();
      resolve({ status, body: data });
    });
    req.on('error', reject);
    req.end(body);
  });
}

// aps is the raw APNs payload ({ aps: {...}, ...customData }).
export async function sendApns(cfg: ApnsConfig, token: string, aps: object): Promise<void> {
  const jwt = buildToken(cfg);
  const host = cfg.env === 'production' ? 'api.push.apple.com' : 'api.sandbox.push.apple.com';
  const body = JSON.stringify(aps);

  const { status, body: resBody } = await postHttp2(
    host,
    `/3/device/${token}`,
    {
      authorization: `bearer ${jwt}`,
      'apns-topic': cfg.bundleId,
      'apns-push-type': 'alert',
      'content-type': 'application/json',
    },
    body,
  );

  if (status !== 200) {
    let reason = resBody.trim();
    try {
      reason = JSON.parse(resBody).reason ?? reason;
    } catch {
      /* keep raw body */
    }
    throw new Error(`APNs send failed (${status}): ${reason}`);
  }
}
