import { createSign } from 'crypto';

export function base64url(input: Buffer | string): string {
  return Buffer.from(input)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

// Build and sign a JWS. `ec` selects the IEEE-P1363 (raw r||s) encoding that
// ES256 JWTs require; RS256 uses the default DER encoding.
export function signJwt(
  header: object,
  claims: object,
  key: string,
  alg: 'RSA-SHA256' | 'SHA256',
  ec = false,
): string {
  const signingInput = `${base64url(JSON.stringify(header))}.${base64url(JSON.stringify(claims))}`;
  const signature = createSign(alg)
    .update(signingInput)
    .sign(ec ? { key, dsaEncoding: 'ieee-p1363' } : key);
  return `${signingInput}.${base64url(signature)}`;
}
