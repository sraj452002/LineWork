# Linework

A React web app for technical design docs and diagrams: architecture diagrams, flowcharts, sequence diagrams and database schemas, with a markdown design doc beside the canvas.

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
    ui.jsx              menus, dialogs, toasts, theme
  lib/
    auth.js             hardcoded credentials
    engines.js          diagram parsers, layout and SVG rendering
    markdown.js         markdown renderer for docs
    ai.js               AI client and prompt language
    storage.js          browser storage
```

Files are saved in the browser's local storage, so they stay on the device you use.
