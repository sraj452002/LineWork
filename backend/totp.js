import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

/* Time-based one-time codes (RFC 6238): the 6-digit codes authenticator apps show, changing every 30 s. */

const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
export function base32(buf) {
  let bits = 0, val = 0, out = '';
  for (const b of buf) {
    val = (val << 8) | b; bits += 8;
    while (bits >= 5) { out += B32[(val >>> (bits - 5)) & 31]; bits -= 5; }
  }
  if (bits > 0) out += B32[(val << (5 - bits)) & 31];
  return out;
}
export function unbase32(str) {
  let bits = 0, val = 0;
  const out = [];
  for (const ch of str.replace(/[\s=-]/g, '').toUpperCase()) {
    const i = B32.indexOf(ch);
    if (i < 0) throw new Error('bad base32');
    val = (val << 5) | i; bits += 5;
    if (bits >= 8) { out.push((val >>> (bits - 8)) & 255); bits -= 8; }
  }
  return Buffer.from(out);
}

export const newSecret = () => base32(randomBytes(20));
export const stepAt = (now = Date.now()) => Math.floor(now / 30_000);

export function codeAt(secret, step) {
  const msg = Buffer.alloc(8);
  msg.writeBigUInt64BE(BigInt(step));
  const h = createHmac('sha1', unbase32(secret)).update(msg).digest();
  const o = h[h.length - 1] & 15;
  return String((h.readUInt32BE(o) & 0x7fffffff) % 1_000_000).padStart(6, '0');
}

// The time step a code belongs to (allowing one step of clock drift either way), if it's newer than
// `after`, the last step already used; else null.
export function checkCode(secret, code, after = 0, now = Date.now()) {
  const c = String(code || '').replace(/\s/g, '');
  if (!/^\d{6}$/.test(c)) return null;
  const now0 = stepAt(now);
  for (const step of [now0, now0 - 1, now0 + 1]) {
    if (step <= after) continue;
    if (timingSafeEqual(Buffer.from(codeAt(secret, step)), Buffer.from(c))) return step;
  }
  return null;
}

export const otpauthUri = (secret, account, issuer = 'Linework') =>
  `otpauth://totp/${encodeURIComponent(issuer)}:${encodeURIComponent(account)}?secret=${secret}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=6&period=30`;

// Recovery codes, for when the phone is lost: ten, each usable once. Like "k7q2-9xm4".
export function newRecoveryCodes(n = 10) {
  const abc = 'abcdefghjkmnpqrstuvwxyz23456789';
  return Array.from({ length: n }, () => {
    const b = randomBytes(8);
    const s = [...b].map(x => abc[x % abc.length]).join('');
    return s.slice(0, 4) + '-' + s.slice(4);
  });
}
export const normRecovery = c => String(c || '').toLowerCase().replace(/[^a-z0-9]/g, '');
