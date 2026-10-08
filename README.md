# Linework

A React web app for technical design docs and diagrams: architecture diagrams, flowcharts, sequence diagrams and database schemas, with a markdown design doc beside the canvas and a code editor (Monaco, the editor inside VS Code) for the code that goes with them.

## Run locally

```bash
npm install
npm run dev
```

Open the URL Vite prints (usually http://localhost:5173).

## Sign in

The username and password are hardcoded in `src/lib/auth.js`. Change them there and rebuild.
Sessions last 30 days in the browser; **Sign out** ends them.

This check runs in the browser, so anyone who opens the built JavaScript can read the credentials. It keeps out casual visitors, not a determined one.

## Deploy on Netlify

Connect the repo in Netlify (or run `npx netlify-cli deploy --prod`). `netlify.toml` already sets:

- Build command: `npm run build`
- Publish directory: `dist`

### Optional: AI generation

Set `ANTHROPIC_API_KEY` in Netlify environment variables. The edge function in `netlify/edge-functions/ai.ts` keeps the key on the server. `ANTHROPIC_MODEL` overrides the model (default `claude-sonnet-5-5`).

The AI endpoint isn't behind the sign-in, so anyone who finds the site URL could use it and spend your API credit. Leave the key unset if that's a concern.

## Running code

The Code view's **Run** button, **Terminal** and **Python** prompt run code in the visitor's browser; nothing runs on the server.

- **Node.js** runs in a [StackBlitz WebContainer](https://webcontainers.io): `node`, `npm`, `npx`, `yarn` and `pnpm` in a real shell, with npm packages installed from the npm registry, and a **Preview** of any web server the code starts. WebContainers is free for personal and open-source projects; [commercial production use needs a StackBlitz license](https://webcontainers.io/enterprise).
- **Python** runs in [Pyodide](https://pyodide.org) (CPython in WebAssembly) in a web worker, loaded from the jsDelivr CDN. `pip install` works for pure-Python packages from PyPI and for packages Pyodide has built (NumPy, pandas and many more). `input()` isn't available.
- Both need a cross-origin isolated page, so `netlify.toml` (and `vite.config.js` for development) send `Cross-Origin-Opener-Policy: same-origin` and `Cross-Origin-Embedder-Policy: credentialless`. That works in Chrome, Edge and Firefox on desktop; Safari and phones can edit code but not run it.
- Native binaries, system packages (`apt-get`) and other languages need a real machine, which this in-browser setup doesn't provide.

## Project layout

```
src/
  App.jsx               sign-in gate, file list state, saving
  components/
    Login.jsx           sign-in screen
    Home.jsx            templates, file list, create with AI
    Editor.jsx          file view: tabs, export, doc/canvas split
    DocPane.jsx         markdown doc with AI writing help
    Canvas.jsx          pan, zoom, drag, code drawer, AI prompt
    CodeWorkspace.jsx   Code view: explorer, tabs, Monaco editor, quick open, Run
    RunPanel.jsx        Output, Terminal, Python prompt and Preview (xterm.js)
    ui.jsx              menus, dialogs, toasts, theme
  lib/
    auth.js             hardcoded credentials
    engines.js          diagram parsers, layout and SVG rendering
    markdown.js         markdown renderer for docs
    ai.js               AI client and prompt language
    monaco.js           loads Monaco and its language workers
    runtime.js          running code: Node.js (WebContainers) and Python (Pyodide)
    python.worker.js    Pyodide in a web worker
    storage.js          browser storage
```

Files are saved in the browser's local storage, so they stay on the device you use.
