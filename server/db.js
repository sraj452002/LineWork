import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

/* The server's SQLite database (Node's built-in node:sqlite, so there is nothing native to install).
   Every table that holds someone's data is keyed by their user id, and every query below filters by it. */

const SCHEMA = `
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL DEFAULT '',
  pass TEXT NOT NULL,
  created INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY,               -- SHA-256 of the cookie value, never the value itself
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS files (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  id TEXT NOT NULL,
  data TEXT NOT NULL,
  updated INTEGER NOT NULL,
  PRIMARY KEY (user_id, id)
);
CREATE TABLE IF NOT EXISTS versions (
  vid INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL,
  file_id TEXT NOT NULL,
  data TEXT NOT NULL,
  saved INTEGER NOT NULL,
  FOREIGN KEY (user_id, file_id) REFERENCES files(user_id, id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS versions_file ON versions(user_id, file_id, saved);
CREATE TABLE IF NOT EXISTS folders (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  data TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS shares (
  token TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  file_id TEXT NOT NULL,
  mode TEXT NOT NULL CHECK (mode IN ('view', 'edit')),
  created INTEGER NOT NULL,
  FOREIGN KEY (user_id, file_id) REFERENCES files(user_id, id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS shares_file ON shares(user_id, file_id);
CREATE TABLE IF NOT EXISTS tokens (
  token TEXT PRIMARY KEY,               -- SHA-256 of what's in the email link or sent to the browser
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('verify', 'reset', 'mfa')),
  expires INTEGER NOT NULL,
  tries INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS identities (
  provider TEXT NOT NULL,               -- 'google' | 'github'
  subject TEXT NOT NULL,                -- the provider's id for the person
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  email TEXT NOT NULL DEFAULT '',
  created INTEGER NOT NULL,
  PRIMARY KEY (provider, subject)
);
CREATE INDEX IF NOT EXISTS identities_user ON identities(user_id);
CREATE TABLE IF NOT EXISTS ai_usage (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  day TEXT NOT NULL,
  count INTEGER NOT NULL,
  PRIMARY KEY (user_id, day)
);
`;

// Columns added after the first release; existing databases get them on start.
const COLUMNS = {
  users: {
    verified: 'INTEGER NOT NULL DEFAULT 1',  // 0 until the email link is opened (when email is set up)
    totp_secret: 'TEXT',                     // two-step verification, when on
    totp_pending: 'TEXT',                    // a secret being set up, before its first code
    totp_last: 'INTEGER NOT NULL DEFAULT 0', // the last time step used, so a code works once
    recovery: "TEXT NOT NULL DEFAULT '[]'",  // hashes of unused recovery codes
  },
};

export function openDb(path, { versionEvery = 10 * 60_000, keepVersions = 100 } = {}) {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec(SCHEMA);
  for (const [table, cols] of Object.entries(COLUMNS)) {
    const have = new Set(db.prepare(`PRAGMA table_info(${table})`).all().map(c => c.name));
    for (const [col, type] of Object.entries(cols)) if (!have.has(col)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${col} ${type}`);
  }
  const q = sql => db.prepare(sql);
  const tx = fn => (...a) => { db.exec('BEGIN IMMEDIATE'); try { const r = fn(...a); db.exec('COMMIT'); return r; } catch (e) { db.exec('ROLLBACK'); throw e; } };

  const s = {
    userByEmail: q('SELECT * FROM users WHERE email = ?'),
    userById: q('SELECT * FROM users WHERE id = ?'),
    addUser: q('INSERT INTO users (id, email, name, pass, created, verified) VALUES (?, ?, ?, ?, ?, ?)'),
    setVerified: q('UPDATE users SET verified = 1 WHERE id = ?'),
    setPendingTotp: q('UPDATE users SET totp_pending = ? WHERE id = ?'),
    enableTotp: q('UPDATE users SET totp_secret = totp_pending, totp_pending = NULL, totp_last = ?, recovery = ? WHERE id = ?'),
    disableTotp: q("UPDATE users SET totp_secret = NULL, totp_pending = NULL, totp_last = 0, recovery = '[]' WHERE id = ?"),
    useTotpStep: q('UPDATE users SET totp_last = ? WHERE id = ? AND totp_last < ?'),
    setRecovery: q('UPDATE users SET recovery = ? WHERE id = ?'),
    addToken: q('INSERT INTO tokens (token, user_id, kind, expires) VALUES (?, ?, ?, ?)'),
    token: q('SELECT * FROM tokens WHERE token = ? AND kind = ? AND expires > ?'),
    tryToken: q('UPDATE tokens SET tries = tries + 1 WHERE token = ?'),
    dropToken: q('DELETE FROM tokens WHERE token = ?'),
    dropTokens: q('DELETE FROM tokens WHERE user_id = ? AND kind = ?'),
    oldTokens: q('DELETE FROM tokens WHERE expires <= ?'),
    identity: q('SELECT * FROM identities WHERE provider = ? AND subject = ?'),
    identities: q('SELECT provider, email, created FROM identities WHERE user_id = ? ORDER BY created'),
    addIdentity: q('INSERT INTO identities (provider, subject, user_id, email, created) VALUES (?, ?, ?, ?, ?)'),
    dropIdentity: q('DELETE FROM identities WHERE user_id = ? AND provider = ?'),
    setName: q('UPDATE users SET name = ? WHERE id = ?'),
    setPass: q('UPDATE users SET pass = ? WHERE id = ?'),
    addSession: q('INSERT INTO sessions (token, user_id, expires) VALUES (?, ?, ?)'),
    session: q('SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token = ? AND s.expires > ?'),
    dropSession: q('DELETE FROM sessions WHERE token = ?'),
    dropSessions: q('DELETE FROM sessions WHERE user_id = ? AND token != ?'),
    oldSessions: q('DELETE FROM sessions WHERE expires <= ?'),
    files: q('SELECT data FROM files WHERE user_id = ? ORDER BY updated DESC'),
    file: q('SELECT data FROM files WHERE user_id = ? AND id = ?'),
    putFile: q('INSERT INTO files (user_id, id, data, updated) VALUES (?, ?, ?, ?) ON CONFLICT (user_id, id) DO UPDATE SET data = excluded.data, updated = excluded.updated'),
    dropFile: q('DELETE FROM files WHERE user_id = ? AND id = ?'),
    lastVersion: q('SELECT vid, saved, data FROM versions WHERE user_id = ? AND file_id = ? ORDER BY saved DESC, vid DESC LIMIT 1'),
    addVersion: q('INSERT INTO versions (user_id, file_id, data, saved) VALUES (?, ?, ?, ?)'),
    setVersion: q('UPDATE versions SET data = ?, saved = ? WHERE vid = ?'),
    pruneVersions: q('DELETE FROM versions WHERE user_id = ? AND file_id = ? AND vid NOT IN (SELECT vid FROM versions WHERE user_id = ? AND file_id = ? ORDER BY saved DESC, vid DESC LIMIT ?)'),
    versions: q('SELECT vid, saved, length(data) AS size, json_extract(data, \'$.title\') AS title FROM versions WHERE user_id = ? AND file_id = ? ORDER BY saved DESC, vid DESC'),
    version: q('SELECT data, saved FROM versions WHERE user_id = ? AND file_id = ? AND vid = ?'),
    folders: q('SELECT data FROM folders WHERE user_id = ?'),
    putFolders: q('INSERT INTO folders (user_id, data) VALUES (?, ?) ON CONFLICT (user_id) DO UPDATE SET data = excluded.data'),
    addShare: q('INSERT INTO shares (token, user_id, file_id, mode, created) VALUES (?, ?, ?, ?, ?)'),
    shares: q('SELECT token, mode, created FROM shares WHERE user_id = ? AND file_id = ? ORDER BY created'),
    share: q('SELECT s.*, u.name AS owner_name, u.email AS owner_email FROM shares s JOIN users u ON u.id = s.user_id WHERE s.token = ?'),
    dropShare: q('DELETE FROM shares WHERE token = ? AND user_id = ?'),
    listUsers: q('SELECT u.email, u.name, u.created, u.verified, u.totp_secret IS NOT NULL AS totp, (SELECT count(*) FROM files f WHERE f.user_id = u.id) AS files FROM users u ORDER BY u.created'),
    dropUser: q('DELETE FROM users WHERE id = ?'),
    usage: q('SELECT count FROM ai_usage WHERE user_id = ? AND day = ?'),
    bumpUsage: q('INSERT INTO ai_usage (user_id, day, count) VALUES (?, ?, 1) ON CONFLICT (user_id, day) DO UPDATE SET count = count + 1'),
  };

  // Save a file and keep its history: edits within `versionEvery` of the latest version update that
  // version in place, later ones start a new one. So each version is how the file stood at the end of
  // a stretch of editing.
  const saveFile = tx((uid, id, text, updated, now = Date.now()) => {
    const before = s.file.get(uid, id);
    if (before && before.data === text) return false;
    s.putFile.run(uid, id, text, updated);
    const last = s.lastVersion.get(uid, id);
    if (last && now - last.saved < versionEvery) s.setVersion.run(text, now, last.vid);
    else s.addVersion.run(uid, id, text, now);
    s.pruneVersions.run(uid, id, uid, id, keepVersions);
    return true;
  });

  // Count one AI request against today's allowance; false when it's used up. Days are UTC.
  const useAi = tx((uid, limit, now = Date.now()) => {
    const day = new Date(now).toISOString().slice(0, 10);
    const used = s.usage.get(uid, day)?.count || 0;
    if (limit > 0 && used >= limit) return false;
    s.bumpUsage.run(uid, day);
    return true;
  });
  const aiUsed = (uid, now = Date.now()) => s.usage.get(uid, new Date(now).toISOString().slice(0, 10))?.count || 0;

  return { db, s, saveFile, useAi, aiUsed, close: () => db.close() };
}
