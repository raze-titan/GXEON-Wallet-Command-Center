import { Buffer } from 'node:buffer';
import { createPrivateKey, randomUUID, sign, type KeyObject } from 'node:crypto';

export const PAYAI_FACILITATOR = 'https://facilitator.payai.network';
export type PayAIOperation = 'verify' | 'settle';

export type PayAIAuthentication =
  | { mode: 'wallet' }
  | { mode: 'merchant'; keyId: string; privateKey: KeyObject };

export function readPayAIAuthentication(id?: string, rawSecret?: string): PayAIAuthentication | null {
  const keyId = id?.trim();
  const configuredSecret = rawSecret?.trim();
  if (!keyId && !configuredSecret) return { mode: 'wallet' };
  if (!keyId || !configuredSecret) return null;

  const secret = configuredSecret.replace(/^payai_sk_/, '');
  if (!/^[\w+/-]+={0,2}$/.test(secret)) return null;
  try {
    const privateKey = createPrivateKey({ key: Buffer.from(secret, 'base64'), format: 'der', type: 'pkcs8' });
    if (privateKey.asymmetricKeyType !== 'ed25519') return null;
    return { mode: 'merchant', keyId, privateKey };
  } catch {
    return null;
  }
}

function createPayAIHeaders(authentication: PayAIAuthentication): Record<string, string> {
  if (authentication.mode === 'wallet') return {};

  const { keyId, privateKey } = authentication;
  const issuedAt = Math.floor(Date.now() / 1000);
  const header = { alg: 'EdDSA', typ: 'JWT', kid: keyId };
  const claims = { sub: keyId, iss: 'payai-merchant', iat: issuedAt, exp: issuedAt + 120, jti: randomUUID() };
  const encodedHeader = Buffer.from(JSON.stringify(header)).toString('base64url');
  const encodedClaims = Buffer.from(JSON.stringify(claims)).toString('base64url');
  const message = `${encodedHeader}.${encodedClaims}`;
  const signature = sign(null, Buffer.from(message), privateKey).toString('base64url');

  return { Authorization: `Bearer ${message}.${signature}` };
}

export function requestPayAI(operation: PayAIOperation, body: string, authentication: PayAIAuthentication) {
  return fetch(PAYAI_FACILITATOR + '/' + operation, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json', ...createPayAIHeaders(authentication) },
    body,
    redirect: 'error',
    signal: AbortSignal.timeout(operation === 'verify' ? 6_000 : 18_000),
  });
}
