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
- The Terminal adds everyday commands to the WebContainer shell, written in JavaScript (`src/lib/shell/lw.cjs`) and installed on its `PATH`: `grep`, `find`, `touch`, `head`, `tail`, `wc`, `sort`, `uniq`, `tree`, `diff`, `sed`, `which`, `env`, `date`, `du`, `curl`, `wget`, `git` ([isomorphic-git](https://isomorphic-git.org), installed on first use; push and pull go through its CORS proxy with `$GITHUB_TOKEN`), and `python`/`pip`, which run in the Python runtime and print in the Terminal. `code <file>` opens a file in the editor. `help` lists them all.
- `curl` and `wget` run in the browser, so they can only fetch sites that allow cross-origin requests.
- Native binaries, system packages (`apt-get`) and other languages need a real machine, which this in-browser setup doesn't provide.

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
    Editor.jsx          file view: tabs, export, doc/canvas split
    DocPane.jsx         markdown doc with AI writing help
    Canvas.jsx          pan, zoom, drag, code drawer, AI prompt
    CodeWorkspace.jsx   Code view: explorer, tabs, Monaco editor, quick open, Run
    RunPanel.jsx        Output, Terminal, Python prompt and Preview (xterm.js)
    Visualizer.jsx      Visualize pane: code diagrams and step-through
    ui.jsx              menus, dialogs, toasts, theme button
  lib/
    auth.js             hardcoded credentials
    engines.js          diagram parsers, layout and SVG rendering
    markdown.js         markdown renderer for docs
    ai.js               AI client and prompt language
    monaco.js           loads Monaco and its language workers
    runtime.js          running code: Node.js (WebContainers) and Python (Pyodide)
    codeviz.js          reads code into flowcharts, class and import diagrams; records JS runs
    theme.js            light, dark or system theme, remembered
    python.worker.js    Pyodide in a web worker
    shell/lw.cjs        the Terminal's extra commands (grep, git, curl, python, code…)
    storage.js          browser storage
```

Files are saved in the browser's local storage, so they stay on the device you use.
