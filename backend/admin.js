import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openStore } from './store.js';
import { backendFromEnv } from './drive.js';
import { hashPassword } from './auth.js';

// Account chores for whoever runs the server (it sends no email, so password resets happen here):
//   npm run admin -- users
//   npm run admin -- reset-password <email> <new password>
//   npm run admin -- delete-user <email>
//   npm run admin -- verify-user <email>       (confirm an address by hand)
//   npm run admin -- disable-2fa <email>       (someone lost their phone and recovery codes)
// Stop the server first: it keeps the accounts in memory and would write over these changes.
const root = resolve(fileURLToPath(import.meta.url), '..');
const backend = backendFromEnv(process.env, root);
if (!backend) { console.error('No storage set up: see .env.example.'); process.exit(1); }
const { s, close } = await openStore(backend);
const [cmd, email, pw] = process.argv.slice(2);
const user = email && s.userByEmail.get(email.trim().toLowerCase());
const fail = m => { console.error(m); process.exitCode = 1; };

if (cmd === 'users') {
  for (const u of s.listUsers.all()) console.log(`${u.email}\t${u.name || '-'}\t${new Date(u.created).toISOString().slice(0, 10)}\t${u.files} files${u.verified ? '' : '\tunconfirmed'}${u.totp ? '\t2-step' : ''}`);
} else if (cmd === 'reset-password') {
  if (!user) fail('No account with that email.');
  else if (!pw || pw.length < 8) fail('Give a new password of at least 8 characters.');
  else { s.setPass.run(await hashPassword(pw), user.id); s.dropSessions.run(user.id, ''); console.log(`Password changed for ${user.email}; it is signed out everywhere.`); }
} else if (cmd === 'delete-user') {
  if (!user) fail('No account with that email.');
  else { s.dropUser.run(user.id); console.log(`Deleted ${user.email} and all of its files.`); }
} else if (cmd === 'verify-user') {
  if (!user) fail('No account with that email.');
  else { s.setVerified.run(user.id); console.log(`Confirmed ${user.email}.`); }
} else if (cmd === 'disable-2fa') {
  if (!user) fail('No account with that email.');
  else { s.disableTotp.run(user.id); s.dropSessions.run(user.id, ''); console.log(`Two-step verification is off for ${user.email}; it is signed out everywhere.`); }
} else {
  fail('Usage: npm run admin -- users | reset-password <email> <password> | delete-user <email> | verify-user <email> | disable-2fa <email>');
}
await close();
