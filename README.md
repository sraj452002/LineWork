# Linework

A React web app for technical design docs and diagrams: architecture diagrams, flowcharts, sequence diagrams and database schemas, with a markdown design doc beside the canvas and a code editor (Monaco, the editor inside VS Code) for the code that goes with them.

## Run locally

```bash
npm install
npm run dev
```

Open the URL Vite prints (usually http://localhost:5173).

## Accounts and where files are saved

Linework runs with one of two backends, and works without either:

- **On Netlify**: accounts are [Netlify Identity](https://docs.netlify.com/security/secure-access-to-sites/identity/) (email and password, or Google/GitHub if you turn them on). Files are saved with `netlify/functions/files.mts` in Netlify Blobs, and folders in the account's profile.
- **On your own server** (`server/`, below): its own accounts and a SQLite database, plus **share links**, **version history** and a **daily AI allowance** per account.
- **Without an account**: files stay in the browser. Only where accounts aren't available (local development without the server, the tests), or the site allows it: `ALLOW_LOCAL_MODE=true` on the server, `VITE_ALLOW_LOCAL_MODE=true` when building for Netlify. Otherwise **sign-in is required**; files someone made without an account are offered for import when they sign in.

The app asks `GET /api/server` which one it's talking to.

## Deploy on Netlify

Connect the repo in Netlify (or run `npx netlify-cli deploy --prod`). `netlify.toml` already sets the build command (`npm run build`, with a 4 GB Node heap), the publish directory (`dist`) and the headers. Turn on Identity in the Netlify project for accounts. Identity sends the confirmation and password-reset emails itself; Google and GitHub sign-in are turned on under Identity → External providers. (Netlify Identity has no two-step verification; the server below does.)

### Optional: AI generation

Set `ANTHROPIC_API_KEY` in Netlify environment variables. The edge function in `netlify/edge-functions/ai.ts` keeps the key on the server and only answers signed-in accounts. `ANTHROPIC_MODEL` overrides the model (default `claude-sonnet-5-5`).

## Run your own server

`server/` is a standalone Node.js backend (Express, and Node's built-in SQLite) that serves the app and its API, so Linework runs on any host that runs Node 22.13 or later, without Netlify.

```bash
npm install
npm run build        # the app, into dist/
npm start            # http://localhost:8787
```

It adds, on top of what the Netlify backend does:

- **Accounts** with email and password (scrypt hashes; sessions are an HttpOnly cookie for 30 days; 10 wrong passwords lock an email for 15 minutes).
- **Email confirmation and password reset**, when the server can send email (`RESEND_API_KEY`, or `SMTP_URL` for any SMTP service, and `MAIL_FROM`). New accounts confirm their address with an emailed link before they can sign in; **Forgot password?** emails a one-hour reset link, and resetting signs out every other device. Without email, nothing needs confirming and passwords are reset by whoever runs the server (below).
- **Continue with Google / GitHub** (`GOOGLE_CLIENT_ID`/`_SECRET`, `GITHUB_CLIENT_ID`/`_SECRET`). The authorization-code flow with PKCE and a state cookie. A provider's *verified* email signs in to the account with that email, or creates one; people can connect or disconnect Google and GitHub under **Account & security**. Register the redirect URI `<APP_URL>/api/auth/oauth/google/callback` (or `…/github/callback`), and set `APP_URL` to the site's public address.
- **Two-step verification** (TOTP): **Account & security** shows a QR code for an authenticator app (Google Authenticator, 1Password, Authy…). After that, signing in (with a password or Google/GitHub) asks for the 6-digit code. Each code works once; ten **recovery codes** stand in for the phone, each once; five wrong codes end the attempt.
- **Admin commands**, since it's your server: `npm run admin -- users` lists accounts; `reset-password <email> <new password>`, `verify-user <email>`, `disable-2fa <email>` (lost phone and codes) and `delete-user <email>` (with its files).
- **Folders and the archive** saved to the account.
- **Version history**: each stretch of editing (10 minutes) keeps a version, the last 100 per file. **Version history…** on a file's ⋯ menu restores one.
- **Share links**: **Share…** makes a link that opens one file, read-only or editable, for anyone who has it (no account needed). Edits through an edit link are saved to the owner's account. Links can be turned off.
- **AI with a daily allowance**: `AI_DAILY_LIMIT` requests per account per day (default 50, UTC days).

Settings are environment variables; `server/.env.example` lists them all. The main ones:

| Variable | Default | |
|---|---|---|
| `PORT` | `8787` | |
| `DATABASE_PATH` | `data/linework.db` | Keep it on a persistent disk, and back it up. |
| `ANTHROPIC_API_KEY` | | Turns AI on. `ANTHROPIC_MODEL` picks the model. |
| `AI_DAILY_LIMIT` | `50` | `0` for no limit. |
| `ALLOW_SIGNUP` | `true` | `false` stops new accounts (Google/GitHub can still sign in to existing ones). |
| `APP_URL` | | The site's public address, for email links and Google/GitHub. |
| `RESEND_API_KEY` or `SMTP_URL`, `MAIL_FROM` | | Email: confirmation and reset links. |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | | Continue with Google. |
| `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET` | | Continue with GitHub. |
| `ALLOW_LOCAL_MODE` | `false` | `true` lets people use the app without an account. |
| `TRUST_PROXY` | | `1` behind a host's proxy (Render, Railway, Fly.io), so cookies are marked Secure on HTTPS. |

**Hosting.** Any Node host with a persistent disk works. Build command `npm install && npm run build`, start command `npm start`, a disk mounted where `DATABASE_PATH` points, and `TRUST_PROXY=1`. Or use the `Dockerfile`: `docker build -t linework . && docker run -p 8787:8787 -v linework-data:/data linework`. The server needs HTTPS in front of it for the Code view's runtimes and for secure cookies; hosts provide that.

**Developing against it.** Run the server for the API only, and Vite with a proxy to it:

```bash
npm run server                                  # API on :8787, restarts on changes
LINEWORK_API=http://localhost:8787 npm run dev  # the app, with /api sent to the server
```

## Running code

The Code view's **Run** button, **Terminal** and **Python** prompt run code in the visitor's browser; nothing runs on the server.

- **Node.js** runs in a [StackBlitz WebContainer](https://webcontainers.io): `node`, `npm`, `npx`, `yarn` and `pnpm` in a real shell, with npm packages installed from the npm registry, and a **Preview** of any web server the code starts. WebContainers is free for personal and open-source projects; [commercial production use needs a StackBlitz license](https://webcontainers.io/enterprise).
- **Python** runs in [Pyodide](https://pyodide.org) (CPython in WebAssembly) in a web worker, loaded from the jsDelivr CDN. `pip install` works for pure-Python packages from PyPI and for packages Pyodide has built (NumPy, pandas and many more). `input()` isn't available.
- Both need a cross-origin isolated page, so `netlify.toml` (and `vite.config.js` for development) send `Cross-Origin-Opener-Policy: same-origin` and `Cross-Origin-Embedder-Policy: credentialless`. That works in Chrome, Edge and Firefox on desktop; Safari and phones can edit code but not run it.
- The Terminal adds everyday commands to the WebContainer shell, written in JavaScript (`src/lib/shell/lw.cjs`) and installed on its `PATH`: `grep`, `find`, `touch`, `head`, `tail`, `wc`, `sort`, `uniq`, `tree`, `diff`, `sed`, `which`, `env`, `date`, `du`, `curl`, `wget`, `git` ([isomorphic-git](https://isomorphic-git.org), installed on first use; push and pull go through its CORS proxy with `$GITHUB_TOKEN`), and `python`/`pip`, which run in the Python runtime and print in the Terminal. `code <file>` opens a file in the editor. `help` lists them all.
- `curl` and `wget` run in the browser, so they can only fetch sites that allow cross-origin requests.
- Native binaries, system packages (`apt-get`) and other languages need a real machine, which this in-browser setup doesn't provide.

## Tools

**Tools** in the home page's sidebar lists every tool, grouped (Diagrams, Docs & data, Code), and each one starts a new file open in that tool: the Code view can open straight into the Terminal, the Python prompt or the Visualize pane. See `src/components/Tools.jsx`.

## Spreadsheets

The **Sheet** view keeps spreadsheets in the file (`file.sheets`): a grid with Excel-style formulas (`=SUM(B2:B9)`, `IF`, `ROUND`, `SUMIF`, `COUNTIF`, `VLOOKUP`, `$`-fixed references…), several sheets per file, copy and paste with Excel and Google Sheets, fill down, sort, number formats, and CSV import and export. **Show on canvas** (or **Insert → Spreadsheet**) draws a sheet on the diagram as a live table. The formula engine is `src/lib/sheet.js`; the view is `src/components/SheetView.jsx`.

## Visualizing code

The Code view's **Visualize** pane draws Python, JavaScript and TypeScript with Linework's own diagram engines: a flowchart of a function, a class diagram (as a database-schema diagram), and an import graph (as an architecture diagram). Any of them can be added to the file as a canvas tab.

- JavaScript and TypeScript are read with [`@babel/parser`](https://babeljs.io/docs/babel-parser); Python is read by Python's own `ast` module in the Pyodide worker. See `src/lib/codeviz.js`.
- **Step through** records a run, like Python Tutor. Python uses `sys.settrace` in the worker. JavaScript is converted with [Sucrase](https://github.com/alangpierce/sucrase) (TypeScript and imports, keeping line numbers), instrumented with a call before each statement, and run in a separate web worker, so it can only `require` other files in the project. Recordings stop at 2,000 steps.

## Project layout

```
src/
  App.jsx               sign-in gate, file list state, saving
  components/
    Login.jsx           sign-in screen
    Home.jsx            templates, file list, create with AI
    Tools.jsx           the Tools page: every tool, each starting a new file
    Editor.jsx          file view: tabs, export, doc/canvas split
    DocPane.jsx         markdown doc with AI writing help
    Canvas.jsx          pan, zoom, drag, code drawer, AI prompt
    CodeWorkspace.jsx   Code view: explorer, tabs, Monaco editor, quick open, Run
    RunPanel.jsx        Output, Terminal, Python prompt and Preview (xterm.js)
    ServerDialogs.jsx   Share links, version history and shared-file page (server/ only)
    Visualizer.jsx      Visualize pane: code diagrams and step-through
    SheetView.jsx       Sheet view: spreadsheets with formulas
    ui.jsx              menus, dialogs, toasts, theme button
  lib/
    auth.js             accounts: Netlify Identity, or the Linework server
    backend.js          talking to the Linework server
    cloud.js            keeping files in step with the account
    engines.js          diagram parsers, layout and SVG rendering
    markdown.js         markdown renderer for docs
    ai.js               AI client and prompt language
    monaco.js           loads Monaco and its language workers
    runtime.js          running code: Node.js (WebContainers) and Python (Pyodide)
    codeviz.js          reads code into flowcharts, class and import diagrams; records JS runs
    sheet.js            spreadsheet formulas, CSV, and sheets drawn on the canvas
    theme.js            light, dark or system theme, remembered
    python.worker.js    Pyodide in a web worker
    shell/lw.cjs        the Terminal's extra commands (grep, git, curl, python, code…)
    storage.js          browser storage
server/
  index.js              starts the server from environment variables
  app.js                the API: accounts, files, versions, folders, share links, AI
  db.js                 SQLite schema and queries
  accounts.js           sign-up, sign-in, email links, two-step verification, Google/GitHub
  auth.js               passwords, sessions, sign-in limits
  mail.js               sending email (Resend or SMTP)
  oauth.js              Google and GitHub sign-in (OAuth 2 with PKCE)
  totp.js               authenticator-app codes (RFC 6238) and recovery codes
  admin.js              npm run admin: list users, reset passwords
netlify/
  functions/files.mts   files API on Netlify (Blobs)
  edge-functions/ai.ts  AI proxy on Netlify
```

Without an account, files are saved in the browser's local storage, so they stay on the device you use.
