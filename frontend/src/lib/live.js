import { nodeDef } from './flows.js';

/* What's live (Home › Live): everything of yours that people or other apps can reach right now.
     app      a workflow published as an app (Apps, and the WorkLine Apps phone app)
     ui       a custom app made in the App view, at its own link
     page     an active workflow's web page (Page trigger), at /p/<name> or its hook link
     form     an active workflow's web form
     chat     an active workflow's chat page
     webhook  an active workflow's web address (Webhook, or another app's events: WhatsApp, Discord…)
     schedule an active workflow that runs on a schedule
     watch    an active workflow that checks something (a feed, a mailbox, a sheet…) every few minutes
   liveList(files) → [{ file, things: [{ kind, label, node?, url?, detail? }] }], newest first. */

export const KIND = {
  app: { label: 'App', icon: '✨', tone: 'blue', stop: 'Unpublish' },
  ui: { label: 'Custom app', icon: '🧩', tone: 'violet', stop: 'Unpublish' },
  page: { label: 'Web page', icon: '🌐', tone: 'sky', stop: 'Take offline' },
  form: { label: 'Form', icon: '📝', tone: 'green', stop: 'Take offline' },
  chat: { label: 'Chat', icon: '💬', tone: 'teal', stop: 'Take offline' },
  webhook: { label: 'Webhook', icon: '🔗', tone: 'amber', stop: 'Turn off' },
  schedule: { label: 'Schedule', icon: '⏰', tone: 'orange', stop: 'Turn off' },
  watch: { label: 'Watching', icon: '👀', tone: 'pink', stop: 'Turn off' },
};

const every = p => (p.mode === 'daily' ? `every day at ${p.at || '09:00'}` : p.mode === 'cron' ? `on the cron “${p.cron || ''}”` : `every ${Math.max(1, Number(p.every) || 15)} ${p.unit || 'minutes'}`);

export function liveList(files, origin = typeof location !== 'undefined' ? location.origin : '') {
  const out = [];
  for (const f of files || []) {
    if (!f || f.archived) continue;
    const things = [], flow = f.flow;
    if (flow && flow.app && flow.app.published) things.push({ kind: 'app', label: flow.app.name || f.title || 'App', detail: flow.app.description || '' });
    if (f.ui && f.ui.published && f.ui.token) things.push({ kind: 'ui', label: f.title || 'Custom app', url: `${origin}/api/ui/${f.ui.token}` });
    if (flow && flow.active) for (const n of flow.nodes || []) {
      const d = nodeDef(n.type), p = n.params || {};
      if (!d || !d.trigger) continue;
      const hook = p.path ? `${origin}/api/hook/${p.path}` : '';
      if (n.type === 'trigger.page') things.push({ kind: 'page', node: n, label: p.title && p.title !== 'My page' ? p.title : n.name, url: p.link ? `${origin}/p/${String(p.link).toLowerCase()}` : hook });
      else if (n.type === 'trigger.form') things.push({ kind: 'form', node: n, label: p.title || n.name, url: hook });
      else if (n.type === 'trigger.chat') things.push({ kind: 'chat', node: n, label: p.title || n.name, url: hook });
      else if (n.type === 'trigger.webhook' || d.hook) things.push({ kind: 'webhook', node: n, label: n.name, url: hook, detail: n.type === 'trigger.webhook' ? `${p.method && p.method !== 'ANY' ? p.method : 'Any method'}` : `${d.label} events` });
      else if (n.type === 'trigger.schedule') things.push({ kind: 'schedule', node: n, label: n.name, detail: `Runs ${every(p)}` });
      else if (d.poll) things.push({ kind: 'watch', node: n, label: n.name, detail: `${d.label}, checked ${p.every ? `every ${p.every} min` : 'every few minutes'}` });
    }
    if (things.length) out.push({ file: f, things });
  }
  return out.sort((a, b) => (b.file.updated || 0) - (a.file.updated || 0));
}

// Take one thing offline, in the file (the app saves it and the server follows): an app or custom app is
// unpublished; a trigger's workflow is turned off (which takes every trigger of that workflow offline).
export function stopThing(c, kind) {
  if (kind === 'app') { if (c.flow && c.flow.app) c.flow.app.published = false; }
  else if (kind === 'ui') { if (c.ui) c.ui.published = false; }
  else if (c.flow) c.flow.active = false;
}
