import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openDb } from './db.js';
import { hashPassword } from './auth.js';

// Account chores for whoever runs the server (it sends no email, so password resets happen here):
//   npm run admin -- users
//   npm run admin -- reset-password <email> <new password>
//   npm run admin -- delete-user <email>
const root = resolve(fileURLToPath(import.meta.url), '../..');
const { s, close } = openDb(resolve(root, process.env.DATABASE_PATH || 'data/linework.db'));
const [cmd, email, pw] = process.argv.slice(2);
const user = email && s.userByEmail.get(email.trim().toLowerCase());
const fail = m => { console.error(m); process.exitCode = 1; };

if (cmd === 'users') {
  for (const u of s.listUsers.all()) console.log(`${u.email}\t${u.name || '-'}\t${new Date(u.created).toISOString().slice(0, 10)}\t${u.files} files`);
} else if (cmd === 'reset-password') {
  if (!user) fail('No account with that email.');
  else if (!pw || pw.length < 8) fail('Give a new password of at least 8 characters.');
  else { s.setPass.run(await hashPassword(pw), user.id); s.dropSessions.run(user.id, ''); console.log(`Password changed for ${user.email}; it is signed out everywhere.`); }
} else if (cmd === 'delete-user') {
  if (!user) fail('No account with that email.');
  else { s.dropUser.run(user.id); console.log(`Deleted ${user.email} and all of its files.`); }
} else {
  fail('Usage: npm run admin -- users | reset-password <email> <password> | delete-user <email>');
}
close();
