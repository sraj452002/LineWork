# Linework

A React web app for technical design docs and diagrams: architecture diagrams, flowcharts, sequence diagrams and database schemas, with a markdown design doc beside the canvas.

## Run locally

```bash
npm install
npm run dev
```

Open the URL Vite prints (usually http://localhost:5173).

## Sign in and where files are saved

There are three ways in, chosen on the sign-in screen:

- **Continue with Google**: files are saved to a *Linework* folder in your Google Drive, one `<title>.linework.json` file each. Needs the Google setup below.
- **Email and password** (or GitHub and other providers) with Netlify Identity: files are saved to your Linework account in Netlify Blobs. Turn on Identity for the site in Netlify.
- **Continue without an account**: files stay in this browser only, and AI is off.

Accounts only work on a deployed site, so `npm run dev` always uses the third option.

## Deploy on Netlify

Connect the repo in Netlify (or run `npx netlify-cli deploy --prod`). `netlify.toml` already sets:

- Build command: `npm run build`
- Publish directory: `dist`

### Optional: AI generation

Set `ANTHROPIC_API_KEY` in Netlify environment variables. The edge function in `netlify/edge-functions/ai.ts` keeps the key on the server. `ANTHROPIC_MODEL` overrides the model (default `claude-sonnet-5-5`).

AI is only available to people signed in (with Google or a Linework account), since every request costs API credit.

### Optional: Google sign-in with Google Drive storage

1. In the [Google Cloud console](https://console.cloud.google.com/), create or pick a project and enable the **Google Drive API** (APIs & Services → Library).
2. Set up the **OAuth consent screen** (Google Auth Platform → Branding / Audience). Add the scopes `openid`, `email`, `profile` and `https://www.googleapis.com/auth/drive.file`. While the app is in *Testing*, add the Google accounts that may sign in as test users. `drive.file` is a non-sensitive scope, so publishing doesn't need Google's verification review.
3. Create an **OAuth client ID** of type *Web application*. Under **Authorized redirect URIs** add `https://<your-site>/api/google/callback` for each domain you use (the Netlify domain, any custom domain; deploy previews need their own entry).
4. In Netlify → Site configuration → Environment variables, set `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` from that client. Optionally set `LINEWORK_SESSION_SECRET` to a long random string; it encrypts the sign-in cookie (the client secret is used when it's unset). Redeploy.

**Continue with Google** then appears on the sign-in screen. The server (`netlify/functions/google.mts`) handles the Google sign-in and keeps the session in an encrypted, HttpOnly cookie for 180 days; the browser only gets short-lived access tokens and talks to the Drive API directly (`src/lib/gdrive.js`). With `drive.file`, Linework can only see the files it created. Deleted files go to the Drive trash. **Sign out** revokes Linework's access to the Google account.

## Project layout

```
src/
  App.jsx               sign-in gate, file list state, saving
  components/
    Login.jsx           sign-in screen
    Home.jsx            templates, file list, create with AI
    Editor.jsx          file view: tabs, export, doc/canvas split
    DocPane.jsx         markdown doc with AI writing help
    Canvas.jsx          pan, zoom, drag, code drawer, AI chat, copy and paste
    ui.jsx              menus, dialogs, toasts, theme
  lib/
    auth.js             who's signed in: Netlify Identity, Google, or no account
    cloud.js            files on a Linework account (/api/files)
    gdrive.js           Google sign-in session and files in Google Drive
    engines.js          diagram parsers, layout and SVG rendering
    markdown.js         markdown renderer for docs
    ai.js               AI client and prompt language
    storage.js          browser storage (no account)
netlify/
  functions/files.mts   Linework account files, in Netlify Blobs
  functions/google.mts  Google sign-in
  edge-functions/ai.ts  AI proxy
  lib/gsession.js       encrypted Google session cookie
```

Signed in, every change is written to this browser first and then uploaded, so work carries on offline and syncs when the connection is back.
