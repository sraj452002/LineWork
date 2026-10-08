import { createHash, randomBytes, randomUUID, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

/* Passwords (scrypt) and sessions (a random token in an HttpOnly cookie; the database keeps its hash). */

const scryptP = promisify(scrypt);
const N = 16384, KEYLEN = 64;
export const COOKIE = 'lw_session';
export const SESSION_DAYS = 30;

export async function hashPassword(pw) {
  const salt = randomBytes(16);
  const key = await scryptP(pw, salt, KEYLEN, { N });
  return `scrypt$${N}$${salt.toString('base64url')}$${key.toString('base64url')}`;
}
export async function checkPassword(pw, stored) {
  const [kind, n, salt, key] = String(stored).split('$');
  if (kind !== 'scrypt') return false;
  const want = Buffer.from(key, 'base64url');
  const got = await scryptP(pw, Buffer.from(salt, 'base64url'), want.length, { N: Number(n) });
  return timingSafeEqual(got, want);
}
// A hash to compare against when the email isn't known, so a wrong email takes as long as a wrong password.
export const DUMMY = await hashPassword(randomUUID());

export const newToken = () => randomBytes(32).toString('base64url');
export const tokenHash = t => createHash('sha256').update(String(t)).digest('base64url');
export const newId = () => randomUUID();

export function readCookie(req, name) {
  for (const part of String(req.headers.cookie || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0 && part.slice(0, i).trim() === name) return decodeURIComponent(part.slice(i + 1).trim());
  }
  return null;
}
export function sessionCookie(req, value, maxAge) {
  const secure = req.secure ? '; Secure' : '';
  return `${COOKIE}=${encodeURIComponent(value)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure}`;
}

// Counts failures per key in a sliding window; at `max`, that key waits.
export function limiter({ max = 10, windowMs = 15 * 60_000 } = {}) {
  const hits = new Map();
  const key = k => { const now = Date.now(); const h = (hits.get(k) || []).filter(t => now - t < windowMs); hits.set(k, h); return h; };
  return {
    blocked: (...ks) => ks.some(k => key(k).length >= max),
    fail: (...ks) => ks.forEach(k => key(k).push(Date.now())),
    clear: (...ks) => ks.forEach(k => hits.delete(k)),
  };
}
