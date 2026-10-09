import { createServer } from 'node:http';
import { randomBytes } from 'node:crypto';

/* Get a refresh token that lets the server keep its data in your Google Drive:
     GOOGLE_DRIVE_CLIENT_ID=… GOOGLE_DRIVE_CLIENT_SECRET=… npm run drive-auth
   The OAuth client (Google Cloud console → APIs & Services → Credentials) is best of type "Desktop app";
   a "Web application" client works too once http://localhost:53682 is one of its redirect URIs.
   Turn on the Google Drive API for the project first. The token only reaches files the server makes
   (the drive.file permission), not the rest of your Drive. */

const clientId = process.env.GOOGLE_DRIVE_CLIENT_ID || process.env.GOOGLE_CLIENT_ID;
const clientSecret = process.env.GOOGLE_DRIVE_CLIENT_SECRET || process.env.GOOGLE_CLIENT_SECRET;
if (!clientId || !clientSecret) {
  console.error('Set GOOGLE_DRIVE_CLIENT_ID and GOOGLE_DRIVE_CLIENT_SECRET (an OAuth client from the Google Cloud console) first.');
  process.exit(1);
}
const port = Number(process.env.DRIVE_AUTH_PORT) || 53682, redirect = `http://localhost:${port}`, state = randomBytes(16).toString('hex');
const url = new URL('https://accounts.google.com/o/oauth2/v2/auth');
url.search = new URLSearchParams({
  client_id: clientId, redirect_uri: redirect, response_type: 'code', state,
  scope: 'https://www.googleapis.com/auth/drive.file', access_type: 'offline', prompt: 'consent',
});

const server = createServer(async (req, res) => {
  const q = new URL(req.url, redirect).searchParams;
  if (!q.has('code') && !q.has('error')) return res.writeHead(404).end();
  const done = (text, code = 0) => { res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' }).end(text); server.close(); process.exitCode = code; };
  if (q.get('state') !== state || q.get('error')) { console.error('Sign-in was cancelled or didn’t match.'); return done('Something went wrong; see the terminal.', 1); }
  const r = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ code: q.get('code'), client_id: clientId, client_secret: clientSecret, redirect_uri: redirect, grant_type: 'authorization_code' }),
  });
  const j = await r.json().catch(() => ({}));
  if (!j.refresh_token) { console.error('Google gave no refresh token:', j.error_description || j.error || r.status); return done('Something went wrong; see the terminal.', 1); }
  console.log(`\nAdd these to the server's environment:\n\nGOOGLE_DRIVE_CLIENT_ID=${clientId}\nGOOGLE_DRIVE_CLIENT_SECRET=${clientSecret}\nGOOGLE_DRIVE_REFRESH_TOKEN=${j.refresh_token}\n\nKeep the refresh token secret: it can read and change the server's data.`);
  done('Done. You can close this tab and go back to the terminal.');
});
server.listen(port, () => console.log(`Open this link and sign in with the Google account whose Drive should hold the data:\n\n${url}\n`));
