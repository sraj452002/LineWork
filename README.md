# Linework

A React web app for technical design docs and diagrams: architecture diagrams, flowcharts, sequence diagrams and database schemas, with a markdown design doc beside the canvas and a code editor (Monaco, the editor inside VS Code) for the code that goes with them.

The repository has two separate parts, each with its own `package.json`, that talk to each other only through the API:

| | What | Hosted on |
|---|---|---|
| [`frontend/`](frontend) | The app: React + Vite. It calls the API at `/api` on its own site. | Netlify |
| [`backend/`](backend) | The Linework API: Express, with accounts, files, version history, share links, AI and live databases. Data in Google Drive. | Render (or any Node host) |

The frontend's site proxies `/api/*` to the backend (Netlify's proxy rule in production, Vite's proxy in development), so the browser sees one site: the session cookie is first-party and the backend needs no CORS.

## Run locally

```bash
npm install          # also installs frontend/ and backend/
npm run dev
```

Open http://localhost:5173. This starts the backend on port 8787 (restarting on changes; settings from `backend/.env`, with data in Google Drive when that's set up there, else in `backend/data`) and the frontend, with `/api` sent to the backend. Copy `backend/.env.example` to `backend/.env` to start.

Each part also runs on its own:

```bash
cd backend && npm run dev                                       # the API on :8787
cd frontend && LINEWORK_API=http://localhost:8787 npm run dev   # the app, with /api sent there
cd frontend && npm run dev                                      # the app alone: no accounts, files stay in the browser
```

## The API

Everything is under `/api` on the backend (see [`backend/app.js`](backend/app.js) and [`backend/accounts.js`](backend/accounts.js)). Requests that change something must send JSON, from the app's own site (the backend checks `Origin` against its own host and `APP_URL`). The session is an HttpOnly cookie.

| | |
|---|---|
| `GET /api/server` | What this backend offers: sign-up, email, Google/GitHub, features, AI. The app uses it to know the API is there. |
| `/api/auth/…` | `signup`, `login`, `logout`, `me` (`GET`, `PATCH`), `verify`, `resend`, `forgot`, `reset`, `2fa/setup`, `2fa/enable`, `2fa/verify`, `2fa/disable`, `2fa/recovery`, `oauth/:provider` (and its `callback`), `unlink` |
| `GET/PUT/DELETE /api/files[/:id]` | The account's files. |
| `GET /api/files/:id/versions[/:vid]` | Version history. |
| `GET/POST /api/files/:id/shares`, `DELETE /api/shares/:token`, `GET/PUT /api/shared/:token` | Share links, and opening or saving a shared file. |
| `GET/PUT /api/folders` | The account's folders. |
| `POST /api/ai`, `GET /api/ai/status` | AI (streamed), with a daily allowance per account. |
| `POST /api/db` | Live database connections (the Database view). |

The frontend's calls are in [`frontend/src/lib/backend.js`](frontend/src/lib/backend.js), [`auth.js`](frontend/src/lib/auth.js), [`cloud.js`](frontend/src/lib/cloud.js), [`ai.js`](frontend/src/lib/ai.js) and [`dbclient.js`](frontend/src/lib/dbclient.js).

## Deploy

### Backend on Render

Render → **New → Blueprint** → this repository: [`render.yaml`](render.yaml) makes a web service from `backend/` (build `npm ci`, start `npm start`, health check `/api/server`) and asks for the settings. Or make a **Web Service** by hand with **Root Directory** `backend`, the same commands, and the environment variables below. Note its address (e.g. `https://linework-api.onrender.com`).

- `APP_URL`: the frontend's address on Netlify (e.g. `https://linework.netlify.app`). Email links, share links and Google/GitHub sign-in point there.
- `TRUST_PROXY=2` (Netlify's proxy, then Render's load balancer).
- The Google Drive settings (**Google Drive storage**, below), and optionally `ANTHROPIC_API_KEY`, email and Google/GitHub sign-in.

It needs no disk, since the data is in Google Drive. Run **one** instance: it holds the accounts in memory and is the only writer to the Drive folder. A free Render service sleeps after 15 idle minutes and takes about a minute to wake; the app waits for it (`frontend/src/lib/backend.js`). Or use [`backend/Dockerfile`](backend/Dockerfile): `cd backend && docker build -t linework-api . && docker run -p 8787:8787 --env-file .env linework-api`.

### Frontend on Netlify

Connect the repository in Netlify and set **Base directory** to `frontend`. [`frontend/netlify.toml`](frontend/netlify.toml) sets the build command (`npm run build`, with a 4 GB Node heap), the publish directory and the headers. Set one environment variable:

- `BACKEND_URL`: the backend's address (e.g. `https://linework-api.onrender.com`). The build writes it into `dist/_redirects` as a proxy rule for `/api/*`; the build stops if it's missing.

Netlify's proxy waits at most 26 seconds for a response to start. AI answers stream, so they start in time; a sleeping backend answers 502/504 until it's awake, and the app asks again.

For Google/GitHub sign-in, register the redirect URI `<APP_URL>/api/auth/oauth/google/callback` (or `…/github/callback`): the Netlify address, which proxies it to the backend.

## Accounts and where files are saved

- **Signed in**: accounts on the backend, with everything kept in **Google Drive** (no database), plus **share links**, **version history** and a **daily AI allowance** per account.
- **Without an account**: files stay in the browser. Only where the API isn't there (the frontend on its own, the tests), or it allows it (`ALLOW_LOCAL_MODE=true`). Otherwise **sign-in is required**; files someone made without an account are offered for import when they sign in.

What the backend does:

- **Data in Google Drive**, not a database: accounts, sessions, folders, share links and the AI allowance in one `meta.json`, and each saved file and each version as its own JSON file, all in one Drive folder (see **Google Drive storage** below).
- **Accounts** with email and password (scrypt hashes; sessions are an HttpOnly cookie for 30 days; 10 wrong passwords lock an email for 15 minutes).
- **Email confirmation and password reset**, when the backend can send email (`RESEND_API_KEY`, or `SMTP_URL` for any SMTP service, and `MAIL_FROM`). New accounts confirm their address with an emailed link before they can sign in; **Forgot password?** emails a one-hour reset link, and resetting signs out every other device. Without email, nothing needs confirming and passwords are reset by whoever runs the backend (below).
- **Continue with Google / GitHub** (`GOOGLE_CLIENT_ID`/`_SECRET`, `GITHUB_CLIENT_ID`/`_SECRET`). The authorization-code flow with PKCE and a state cookie. A provider's *verified* email signs in to the account with that email, or creates one; people can connect or disconnect Google and GitHub under **Account & security**.
- **Two-step verification** (TOTP): **Account & security** shows a QR code for an authenticator app (Google Authenticator, 1Password, Authy…). After that, signing in (with a password or Google/GitHub) asks for the 6-digit code. Each code works once; ten **recovery codes** stand in for the phone, each once; five wrong codes end the attempt.
- **Admin commands**: `npm run admin -- users` lists accounts; `reset-password <email> <new password>`, `verify-user <email>`, `disable-2fa <email>` (lost phone and codes) and `delete-user <email>` (with its files).
- **Folders and the archive** saved to the account.
- **Version history**: each stretch of editing (10 minutes) keeps a version, the last 100 per file. **Version history…** on a file's ⋯ menu restores one.
- **Share links**: **Share…** makes a link that opens one file, read-only or editable, for anyone who has it (no account needed). Edits through an edit link are saved to the owner's account. Links can be turned off.
- **AI with a daily allowance**: `AI_DAILY_LIMIT` requests per account per day (default 50, UTC days).

Settings are environment variables; [`backend/.env.example`](backend/.env.example) lists them all. The main ones:

| Variable | Default | |
|---|---|---|
| `PORT` | `8787` | |
| `APP_URL` | | The frontend's public address, for email and share links, Google/GitHub, and the `Origin` check. |
| `GOOGLE_DRIVE_REFRESH_TOKEN`, `GOOGLE_DRIVE_CLIENT_ID`, `GOOGLE_DRIVE_CLIENT_SECRET` | | Keep data in your own Google Drive (`npm run drive-auth` gets the token). |
| `GOOGLE_SERVICE_ACCOUNT_KEY` | | Or a service account's JSON key (or a path to it), with `GOOGLE_DRIVE_FOLDER_ID` in a Shared Drive. |
| `GOOGLE_DRIVE_FOLDER_ID` | | The Drive folder. Empty: the backend makes "Linework data" and prints its id. |
| `DATA_DIR` | | A local folder instead of Drive (relative to `backend/`), for development. |
| `ANTHROPIC_API_KEY` | | Turns AI on. `ANTHROPIC_MODEL` picks the model. |
| `AI_DAILY_LIMIT` | `50` | `0` for no limit. |
| `ALLOW_SIGNUP` | `true` | `false` stops new accounts (Google/GitHub can still sign in to existing ones). |
| `RESEND_API_KEY` or `SMTP_URL`, `MAIL_FROM` | | Email: confirmation and reset links. |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | | Continue with Google. |
| `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET` | | Continue with GitHub. |
| `ALLOW_LOCAL_MODE` | `false` | `true` lets people use the app without an account. |
| `TRUST_PROXY` | | The number of proxies in front (`2` on Render behind Netlify), so cookies are marked Secure on HTTPS and sign-in limits see the visitor's address. |

### Google Drive storage

The backend keeps its data in one Drive folder. It signs in to Drive in one of two ways:

- **Your own Drive (simplest).** In the Google Cloud console, turn on the **Google Drive API**, make an OAuth client of type **Desktop app**, and set the OAuth consent screen to **In production**. Refresh tokens from a project still in *Testing* stop working after 7 days. Then put the client's id and secret in `backend/.env` as `GOOGLE_DRIVE_CLIENT_ID` and `GOOGLE_DRIVE_CLIENT_SECRET`, run `npm run drive-auth`, sign in, and put the values it prints into the backend's environment. The token has the `drive.file` permission, so it reaches only the files the backend makes, not the rest of the Drive. Leave `GOOGLE_DRIVE_FOLDER_ID` empty the first time: the backend makes a **Linework data** folder and prints its id. (A folder you made yourself isn't visible to `drive.file`.)
- **A service account.** Make one, download its JSON key, and add its email as a *Content manager* of a folder in a **Shared Drive** (service accounts have no storage of their own). Set `GOOGLE_SERVICE_ACCOUNT_KEY` to the key's JSON or its path, and `GOOGLE_DRIVE_FOLDER_ID` to the folder.

What's in the folder: `meta.json` (accounts with scrypt password hashes, sessions by the hash of their token, sign-in links, Google/GitHub identities, folders, share links, AI usage, and the list of files and versions), `file.<account>.<file>.json` for each saved file, and `version.<n>.json` for each version. Anyone who can open the folder can read every account's files, so keep it private. Back it up by copying the folder.

The backend loads `meta.json` when it starts and answers a change only after it's written to Drive. Stop the backend before `npm run admin`, which edits the same `meta.json`.

## Running code

The Code view's **Run** button, **Terminal** and **Python** prompt run code in the visitor's browser; nothing runs on the server.

- **Node.js** runs in a [StackBlitz WebContainer](https://webcontainers.io): `node`, `npm`, `npx`, `yarn` and `pnpm` in a real shell, with npm packages installed from the npm registry, and a **Preview** of any web server the code starts. WebContainers is free for personal and open-source projects; [commercial production use needs a StackBlitz license](https://webcontainers.io/enterprise).
- **Python** runs in [Pyodide](https://pyodide.org) (CPython in WebAssembly) in a web worker, loaded from the jsDelivr CDN. `pip install` works for pure-Python packages from PyPI and for packages Pyodide has built (NumPy, pandas and many more). `input()` isn't available.
- Both need a cross-origin isolated page, so `frontend/netlify.toml` (and `frontend/vite.config.js` for development) send `Cross-Origin-Opener-Policy: same-origin` and `Cross-Origin-Embedder-Policy: credentialless`. That works in Chrome, Edge and Firefox on desktop; Safari and phones can edit code but not run it.
- The Terminal adds everyday commands to the WebContainer shell, written in JavaScript (`frontend/src/lib/shell/lw.cjs`) and installed on its `PATH`: `grep`, `find`, `touch`, `head`, `tail`, `wc`, `sort`, `uniq`, `tree`, `diff`, `sed`, `which`, `env`, `date`, `du`, `curl`, `wget`, `git` ([isomorphic-git](https://isomorphic-git.org), installed on first use; push and pull go through its CORS proxy with `$GITHUB_TOKEN`), and `python`/`pip`, which run in the Python runtime and print in the Terminal. `code <file>` opens a file in the editor. `help` lists them all.
- `curl` and `wget` run in the browser, so they can only fetch sites that allow cross-origin requests.
- Native binaries, system packages (`apt-get`) and other languages need a real machine, which this in-browser setup doesn't provide.

## Tools

**Tools** in the home page's sidebar lists every tool, grouped (Diagrams, Docs & data, Code), and each one starts a new file open in that tool: the Code view can open straight into the Terminal, the Python prompt or the Visualize pane. See `frontend/src/components/Tools.jsx`.

## Live databases

The **Database** view connects to PostgreSQL, MySQL / MariaDB, SQL Server and MongoDB, and opens SQLite files in the browser (sql.js). It shows the live schema (and draws it on the canvas, refreshable), browses and edits rows by primary key, and runs queries, with an optional read-only mode per connection.

- `backend/dbconnect.js` does the work, behind `POST /api/db`. Each request opens the connection, does one thing and closes it; passwords are never stored on the server.
- Only signed-in accounts can use it. Hosts are resolved first, and private, loopback, link-local and metadata addresses are refused unless `DB_ALLOW_PRIVATE=1`, so the server can't be used to reach its own network. Queries time out after 30 s and results are capped at 1,000 rows.
- Connections are saved in the browser (`frontend/src/lib/dbclient.js`), never in files; passwords only when "Remember the password" is ticked.
- Tests: `tests/db.spec.js`. Set `LINEWORK_TEST_PG`, `LINEWORK_TEST_MYSQL` and/or `LINEWORK_TEST_MSSQL` to connection strings for scratch databases to run the live tests too.

## Database schemas from SQL

A `.sql` file becomes a database schema diagram without AI: drop it on the canvas, or use **Insert → Database schema from SQL**, **Tools → Open a .sql file**, or a schema's **⋯ → Import SQL**. `frontend/src/lib/sql.js` reads schema files, migrations and dumps from PostgreSQL (`pg_dump`), MySQL (`mysqldump`), SQLite and SQL Server: tables, column types, primary keys (including ones added by `ALTER TABLE`), unique columns and foreign keys, and follows `ALTER TABLE` column changes in order. It also writes a diagram back out as PostgreSQL or MySQL.

## Spreadsheets

The **Sheet** view keeps spreadsheets in the file (`file.sheets`) and works like Excel: a ribbon (File, Home, Insert, Formulas, Data, View), the name box and formula bar, over a hundred Excel functions (`XLOOKUP`, `SUMIFS`, `IFS`, `TEXT`, date and financial functions…), cross-sheet references (`'Sheet 2'!A1`), real dates and number formats, fonts, fills, borders, merged cells, the fill handle with series, frozen panes, filters, find and replace, charts (column, bar, line, area, pie, doughnut, scatter), inserting and deleting rows and columns with formulas following, and the status-bar sum. It opens and saves **.xlsx** files (with ExcelJS, loaded only when needed) and CSV. **Show on canvas** (or **Insert → Spreadsheet**) draws a sheet on the diagram as a live table. The formula engine is `frontend/src/lib/sheet.js`, `.xlsx` files are `frontend/src/lib/xlsx.js`, charts are `frontend/src/lib/charts.js`, and the view is `frontend/src/components/SheetView.jsx`.

## Visualizing code

The Code view's **Visualize** pane draws Python, JavaScript and TypeScript with Linework's own diagram engines: a flowchart of a function, a class diagram (as a database-schema diagram), and an import graph (as an architecture diagram). Any of them can be added to the file as a canvas tab.

- JavaScript and TypeScript are read with [`@babel/parser`](https://babeljs.io/docs/babel-parser); Python is read by Python's own `ast` module in the Pyodide worker. See `frontend/src/lib/codeviz.js`.
- **Step through** records a run, like Python Tutor. Python uses `sys.settrace` in the worker. JavaScript is converted with [Sucrase](https://github.com/alangpierce/sucrase) (TypeScript and imports, keeping line numbers), instrumented with a call before each statement, and run in a separate web worker, so it can only `require` other files in the project. Recordings stop at 2,000 steps.

## Project layout

```
package.json            runs both for development (npm run dev) and the tests; npm install sets up both
scripts/dev.mjs         npm run dev: the backend and the frontend together
render.yaml             the backend on Render
tests/                  Playwright tests, for both
frontend/               the app (Netlify)
  package.json
  netlify.toml          build, headers, and the page fallback
  vite.config.js        dev proxy to the backend; writes the /api proxy rule for Netlify
  index.html
  src/
    App.jsx             sign-in gate, file list state, saving
    components/
      Login.jsx         sign-in screen
      Home.jsx          templates, file list, create with AI
      Tools.jsx         the Tools page: every tool, each starting a new file
      Editor.jsx        file view: tabs, export, doc/canvas split
      DocPane.jsx       markdown doc with AI writing help
      Canvas.jsx        pan, zoom, drag, code drawer, AI prompt
      CodeWorkspace.jsx Code view: explorer, tabs, Monaco editor, quick open, Run
      RunPanel.jsx      Output, Terminal, Python prompt and Preview (xterm.js)
      ServerDialogs.jsx share links, version history and the shared-file page
      Visualizer.jsx    Visualize pane: code diagrams and step-through
      SheetView.jsx     Sheet view: an Excel-like workbook (ribbon, grid, charts)
      DatabaseView.jsx  Database view: live connections, schema, data and queries
      ui.jsx            menus, dialogs, toasts, theme button
    lib/
      backend.js        talking to the API (and waiting for it to wake)
      auth.js           accounts, through the API
      cloud.js          keeping files in step with the account
      engines.js        diagram parsers, layout and SVG rendering
      markdown.js       markdown renderer for docs
      ai.js             AI client and prompt language
      monaco.js         loads Monaco and its language workers
      runtime.js        running code: Node.js (WebContainers) and Python (Pyodide)
      codeviz.js        reads code into flowcharts, class and import diagrams; records JS runs
      sheet.js          spreadsheet formulas, formats, dates, CSV
      xlsx.js           .xlsx open and save (ExcelJS)
      dbclient.js       live database connections, SQLite in the browser, schema → diagram
      charts.js         charts from cells, as SVG
      theme.js          light, dark or system theme, remembered
      python.worker.js  Pyodide in a web worker
      shell/lw.cjs      the Terminal's extra commands (grep, git, curl, python, code…)
      storage.js        browser storage
  scripts/build-icons.mjs  npm run icons: builds src/lib/icondata.js
backend/                the API (Render)
  package.json
  .env.example          every setting; copy to .env for development
  Dockerfile
  index.js              starts the API from environment variables
  app.js                the API: files, versions, folders, share links, AI, databases
  accounts.js           sign-up, sign-in, email links, two-step verification, Google/GitHub
  store.js              accounts, files and versions, kept in a storage backend
  drive.js              the backends: Google Drive, a local folder, memory (tests)
  drive-auth.js         gets a Drive refresh token (npm run drive-auth)
  dbconnect.js          live database connections (PostgreSQL, MySQL, SQL Server, MongoDB)
  auth.js               passwords, sessions, sign-in limits
  mail.js               sending email (Resend or SMTP)
  oauth.js              Google and GitHub sign-in (OAuth 2 with PKCE)
  totp.js               authenticator-app codes (RFC 6238) and recovery codes
  admin.js              npm run admin: list users, reset passwords
```

Without an account, files are saved in the browser's local storage, so they stay on the device you use.
