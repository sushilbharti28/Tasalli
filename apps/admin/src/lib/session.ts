/**
 * Signed session cookie for the founder. Uses Web Crypto only, so the same code
 * runs in middleware (edge runtime) and in server actions (Node).
 *
 * Token: base64url(JSON {email, exp}) + "." + base64url(HMAC-SHA256(secret, payload))
 */
export const SESSION_COOKIE = 'tasalli_admin_session';
export const SESSION_TTL_SECONDS = 12 * 60 * 60;

export interface Session {
  email: string;
  exp: number; // unix seconds
}

const enc = new TextEncoder();

function b64url(bytes: Uint8Array): string {
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromB64url(s: string): Uint8Array {
  const pad = s.length % 4 === 0 ? '' : '='.repeat(4 - (s.length % 4));
  const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/') + pad);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export function getSessionSecret(): string | null {
  const s = process.env.ADMIN_SESSION_SECRET;
  return s && s.length >= 32 ? s : null;
}

async function hmacKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
}

export async function signSession(session: Session, secret: string): Promise<string> {
  const payload = b64url(enc.encode(JSON.stringify(session)));
  const sig = new Uint8Array(await crypto.subtle.sign('HMAC', await hmacKey(secret), enc.encode(payload)));
  return `${payload}.${b64url(sig)}`;
}

export async function verifySession(token: string | undefined, secret: string | null, nowMs = Date.now()): Promise<Session | null> {
  if (!token || !secret) return null;
  const [payload, sig] = token.split('.');
  if (!payload || !sig) return null;
  try {
    const ok = await crypto.subtle.verify('HMAC', await hmacKey(secret), fromB64url(sig), enc.encode(payload));
    if (!ok) return null;
    const data = JSON.parse(new TextDecoder().decode(fromB64url(payload))) as Session;
    if (typeof data.email !== 'string' || typeof data.exp !== 'number') return null;
    if (data.exp * 1000 <= nowMs) return null;
    // The session must belong to the one configured founder account.
    const admin = process.env.ADMIN_EMAIL?.trim().toLowerCase();
    if (!admin || data.email !== admin) return null;
    return data;
  } catch {
    return null;
  }
}
