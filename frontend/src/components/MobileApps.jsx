import { useEffect, useRef, useState } from 'react';
import Login from './Login.jsx';
import { AppRunner } from './Apps.jsx';
import { useUI } from './ui.jsx';
import { signOut, startSession } from '../lib/auth.js';
import { listFiles } from '../lib/cloud.js';
import { publishedApps } from '../lib/apps.js';
import { serverInfo } from '../lib/backend.js';
import { NO_AI, refreshAI, sampleP } from '../lib/ai.js';
import { md } from '../lib/markdown.js';

/* WorkLine Apps (/mobile): the end user's phone app. Two things only: the published workflows (those
   published as apps, Home → Apps, run with a form; and those published as web apps, opened here), and
   chat with AI. Nothing to edit, nothing about nodes. The list reloads whenever the app comes back.
   It installs as an app (a PWA: /mobile.webmanifest and /sw.js), and the Android app (mobile/, made
   with Capacitor) opens this same page. */

export const isMobileShell = () => /^\/(mobile|run)\/?$/.test(location.pathname);
// /run: the end users' app. The server's public apps (STORE_OWNER's published workflows), no sign-in.
const isStore = () => /^\/run\/?$/.test(location.pathname);
// Inside the installed app (the PWA in its own window, or the Android app), home is /mobile.
export const inInstalledApp = () => {
  try { return matchMedia('(display-mode: standalone)').matches || /WorkLineApp/.test(navigator.userAgent); } catch (e) { return false; }
};

// The page's manifest, icons and service worker, added only here so the rest of WorkLine stays a website.
function useInstallable() {
  useEffect(() => {
    const add = (tag, attrs) => { const el = document.createElement(tag); Object.assign(el, attrs); el.dataset.mobile = '1'; document.head.appendChild(el); return el; };
    const els = [
      add('link', { rel: 'manifest', href: isStore() ? '/run.webmanifest' : '/mobile.webmanifest' }),
      add('link', { rel: 'apple-touch-icon', href: '/icons/apple-touch-icon.png' }),
      add('meta', { name: 'theme-color', content: '#1D2320' }),
      add('meta', { name: 'apple-mobile-web-app-capable', content: 'yes' }),
      add('meta', { name: 'apple-mobile-web-app-title', content: 'WorkLine Apps' }),
    ];
    document.title = 'WorkLine Apps';
    document.documentElement.classList.add('m-dark');
    if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});
    return () => { els.forEach(el => el.remove()); document.documentElement.classList.remove('m-dark'); };
  }, []);
}

export default function MobileApps() {
  useInstallable();
  return isStore() ? <StoreApp /> : <OwnerApp />;
}

// The end users' app: the published workflows, run with a form. Nothing else, and no account needed.
function StoreApp() {
  const [store, setStore] = useState(null), [error, setError] = useState(null), [busy, setBusy] = useState(false), [openId, setOpenId] = useState(null);
  const load = () => {
    setBusy(true); setError(null);
    fetch('/api/store', { cache: 'no-store' }).then(r => r.json().then(j => (r.ok ? j : Promise.reject(new Error(j.message || 'Couldn’t load the workflows.')))))
      .then(j => { setStore(j); setBusy(false); }, e => { setError(e.message || 'Couldn’t load the workflows. Check the internet.'); setBusy(false); });
  };
  useEffect(() => {
    load();
    let last = Date.now();
    const again = () => { if (document.visibilityState === 'visible' && Date.now() - last > 3000) { last = Date.now(); load(); } };
    document.addEventListener('visibilitychange', again); addEventListener('focus', again);
    return () => { document.removeEventListener('visibilitychange', again); removeEventListener('focus', again); };
  }, []);
  const apps = store ? store.apps : [];
  const open = apps.find(a => a.id === openId);
  // Runs it on the server; a long one is asked about again until it's done.
  const runner = async form => {
    const post = await fetch(`/api/store/${encodeURIComponent(open.id)}/run`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ input: form }) });
    let j = await post.json().catch(() => ({}));
    for (let i = 0; i < 200 && j.status === 'running' && j.token; i++) {
      await new Promise(r => setTimeout(r, 1500));
      const r = await fetch(`/api/store/runs/${j.token}`, { cache: 'no-store' });
      j = await r.json().catch(() => ({ status: 'error', error: 'Lost the run.' }));
    }
    if (j.status === 'success') return { status: 'success', items: j.items || [] };
    return { status: 'error', error: j.error || j.message || 'It couldn’t run.' };
  };
  if (open) return (
    <div className="m-shell m-run">
      <AppRunner file={{ id: open.id, flow: { nodes: [], edges: [], app: open } }} server runner={runner} backLabel="← Workflows" onBack={() => setOpenId(null)} />
    </div>
  );
  return (
    <div className="m-shell">
      <MobileBar onRefresh={load} busy={busy} title="Workflows" hello={(store && store.name) || greeting()} />
      {error && <p className="m-note err">{error} <button className="link" onClick={load}>Try again</button></p>}
      {!store && !error && <Skeleton />}
      {store && (!apps.length ? <Empty text="No workflows here yet. Pull back in a little while." />
        : <Workflows items={apps.map(a => ({ key: a.id, name: a.name, description: a.description, icon: a.icon, tone: a.tone, label: `Run ${a.name}`, onClick: () => setOpenId(a.id) }))} />)}
    </div>
  );
}

// The account owner's own view (/mobile): their published workflows, and AI chat.
function OwnerApp() {
  // undefined while checking; null when nobody is signed in.
  const [session, setSession] = useState(undefined);
  useEffect(() => { startSession().then(setSession, () => setSession(null)); }, []);
  if (session === undefined) return <div className="boot" aria-busy="true" />;
  if (!session || !session.mode || session.pending) return <div className="m-login"><Login pending={session && session.pending} notice={session && session.notice} onSignedIn={setSession} /></div>;
  if (session.mode !== 'cloud') return (
    <div className="m-shell"><MobileBar />
      <p className="m-note">WorkLine Apps shows the apps on your account. Sign in to your WorkLine account to see them.</p>
      <button className="btn primary m-wide" onClick={async () => { await signOut(session.mode); setSession(null); }}>Sign in</button>
    </div>
  );
  return <AppsHome session={session} onSignOut={async () => { await signOut('cloud'); setSession(null); }} />;
}

// Small line icons, drawn in the text colour.
const Svg = ({ d, fill, size = 20 }) => (
  <svg viewBox="0 0 24 24" width={size} height={size} aria-hidden="true" fill={fill ? 'currentColor' : 'none'} stroke={fill ? 'none' : 'currentColor'} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d={d} /></svg>
);
const ICON = {
  play: 'M8 5.6v12.8a1 1 0 0 0 1.52.85l10.2-6.4a1 1 0 0 0 0-1.7L9.52 4.75A1 1 0 0 0 8 5.6z',
  open: 'M7 17 17 7M9 7h8v8',
  refresh: 'M20 11a8 8 0 1 0-2.34 5.66M20 4v7h-7',
  search: 'M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14zm9 3-4.35-4.35',
  grid: 'M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h6v6h-6z',
  spark: 'M12 3l1.9 5.6L19.5 10.5l-5.6 1.9L12 18l-1.9-5.6L4.5 10.5l5.6-1.9zM19 16l.8 2.2L22 19l-2.2.8L19 22l-.8-2.2L16 19l2.2-.8z',
};

const greeting = () => { const h = new Date().getHours(); return h < 5 ? 'Good night' : h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening'; };

function MobileBar({ user, onSignOut, onRefresh, busy, title = 'WorkLine Apps', hello }) {
  return (
    <header className="m-bar">
      <div className="m-title">{hello && <small>{hello}</small>}<h1>{title}</h1></div>
      {onRefresh && <button className="m-ib" aria-label="Refresh" onClick={onRefresh} disabled={busy}><span className={busy ? 'm-spin' : ''}><Svg d={ICON.refresh} size={18} /></span></button>}
      {user && <button className="m-ib m-me" aria-label={`Sign out ${user.email || ''}`} title="Sign out" onClick={onSignOut}>{(user.name || user.email || '?')[0].toUpperCase()}</button>}
    </header>
  );
}

const Skeleton = () => <div className="m-skel" aria-busy="true"><i /><b /><b /></div>;
const Empty = ({ children, text }) => <div className="m-empty"><span aria-hidden="true"><Svg d={ICON.grid} size={26} /></span><p>{children || text}</p></div>;

/* The workflows: the first one large (it's the one most people came for), the rest in a list, and a
   search once there are a few. Each item: { key, name, description, icon, tone, label, web, onClick }. */
function Workflows({ items }) {
  const [q, setQ] = useState('');
  const needle = q.trim().toLowerCase();
  const shown = items.filter(it => !needle || `${it.name} ${it.description || ''}`.toLowerCase().includes(needle));
  const top = needle ? null : shown[0];
  const rest = needle ? shown : shown.slice(1);
  return (<>
    {items.length > 3 && <label className="m-search"><Svg d={ICON.search} size={18} /><input type="search" placeholder="Search workflows" aria-label="Search workflows" value={q} onChange={e => setQ(e.target.value)} /></label>}
    {top && (
      <button className={'m-feat t-' + (top.tone || 'violet')} onClick={top.onClick} aria-label={top.label}>
        <span className="m-feat-head"><i aria-hidden="true">{top.icon || '✨'}</i><small>{top.web ? 'Web app' : 'Workflow'}</small></span>
        <b>{top.name}</b>
        {top.description && <span className="m-feat-desc">{top.description}</span>}
        <span className="m-feat-go" aria-hidden="true"><Svg d={top.web ? ICON.open : ICON.play} fill={!top.web} size={16} />{top.web ? 'Open' : 'Run now'}</span>
      </button>
    )}
    {rest.length > 0 && <>
      {!needle && <h2 className="m-sec">More workflows <small>{rest.length}</small></h2>}
      <div className="m-rows">
        {rest.map((it, i) => (
          <button key={it.key} className={'m-row t-' + (it.tone || 'blue')} style={{ animationDelay: `${Math.min(i, 10) * 40}ms` }} onClick={it.onClick} aria-label={it.label}>
            <i aria-hidden="true">{it.icon || '✨'}</i>
            <span className="m-row-txt"><b>{it.name}</b><small>{it.description || (it.web ? 'Web app' : 'Tap to run')}</small></span>
            <em aria-hidden="true"><Svg d={it.web ? ICON.open : ICON.play} fill={!it.web} size={14} /></em>
          </button>
        ))}
      </div>
    </>}
    {needle && !shown.length && <Empty text={`Nothing called “${q.trim()}”.`} />}
  </>);
}

// Workflows published as web apps ("Publish web app": active, with a Page trigger), at their own link.
const livePages = files => files.filter(f => !f.archived && f.flow && f.flow.active).flatMap(f => (f.flow.nodes || [])
  .filter(n => n.type === 'trigger.page' && n.params && n.params.path)
  .map(n => ({ id: `${f.id}:${n.id}`, title: (f.flow.nodes.length && n.params.title) || f.title, url: n.params.link ? `/p/${n.params.link}` : `/api/hook/${n.params.path}` })));

// The end user's app: two tabs, run a published workflow, or chat with AI. Nothing else.
function AppsHome({ session, onSignOut }) {
  const { ask } = useUI();
  const [tab, setTab] = useState('run');
  const [files, setFiles] = useState(null), [error, setError] = useState(null), [busy, setBusy] = useState(false);
  const [openId, setOpenId] = useState(null), [server, setServer] = useState(undefined);
  const [install, setInstall] = useState(null);
  const load = () => { setBusy(true); setError(null); listFiles().then(f => { setFiles(f); setBusy(false); }, e => { setError(e.message || 'Couldn’t load your workflows.'); setBusy(false); }); };
  // Back in the app (from another app, or the phone woke up): the list again, so what was just published shows.
  useEffect(() => {
    let last = Date.now();
    const again = () => { if (document.visibilityState === 'visible' && Date.now() - last > 3000) { last = Date.now(); load(); } };
    document.addEventListener('visibilitychange', again); addEventListener('focus', again);
    return () => { document.removeEventListener('visibilitychange', again); removeEventListener('focus', again); };
  }, []);
  useEffect(() => {
    load();
    serverInfo().then(i => setServer(!!(i && (i.features || []).includes('flows'))));
    const keep = e => { e.preventDefault(); setInstall(e); };
    addEventListener('beforeinstallprompt', keep);
    return () => removeEventListener('beforeinstallprompt', keep);
  }, []);
  const apps = files ? publishedApps(files) : [];
  const pages = files ? livePages(files) : [];
  const open = apps.find(f => f.id === openId);
  const [page, setPage] = useState(null);
  const out = async () => { if (await ask({ title: 'Sign out?', text: 'You can sign in again any time.', input: false, ok: 'Sign out' })) onSignOut(); };
  // A web app opens here, full screen, with a way back.
  if (page) return (
    <div className="m-page-view">
      <div className="m-page-bar"><button className="btn" onClick={() => setPage(null)}>← Workflows</button><b>{page.title}</b></div>
      <iframe title={page.title} src={page.url} />
    </div>
  );
  return (
    <div className="m-app-shell">
      <div className="m-shell">
        {open && tab === 'run' ? <div className="m-run"><AppRunner file={open} server={server} onBack={() => setOpenId(null)} /></div> : (<>
          <MobileBar user={session.user} onSignOut={out} onRefresh={tab === 'run' ? load : null} busy={busy} title={tab === 'run' ? 'Workflows' : 'AI chat'}
            hello={`${greeting()}${session.user.name ? `, ${session.user.name.split(' ')[0]}` : ''}`} />
          {install && <button className="btn primary m-wide m-install" onClick={async () => { install.prompt(); await install.userChoice.catch(() => {}); setInstall(null); }}>⬇ Install WorkLine Apps</button>}
          {tab === 'run' ? (<>
            {error && <p className="m-note err">{error} <button className="link" onClick={load}>Try again</button></p>}
            {!files && !error && <Skeleton />}
            {files && (!apps.length && !pages.length ? <Empty>No published workflows yet. On WorkLine, open a workflow and press <b>Publish</b>: it shows up here.</Empty>
              : <Workflows items={[
                ...apps.map(f => ({ key: f.id, ...f.flow.app, label: `Run ${f.flow.app.name}`, onClick: () => setOpenId(f.id) })),
                ...pages.map(p => ({ key: p.id, name: p.title, icon: '🌐', tone: 'sky', web: true, label: `Open ${p.title}`, onClick: () => setPage(p) })),
              ]} />)}
          </>) : <MobileChat apps={apps} user={session.user} />}
        </>)}
      </div>
      <nav className="m-tabs" aria-label="WorkLine Apps">
        <button aria-current={tab === 'run' ? 'page' : undefined} onClick={() => { setTab('run'); }}><span className="m-tab-ic"><Svg d={ICON.grid} size={21} /></span>Workflows</button>
        <button aria-current={tab === 'chat' ? 'page' : undefined} onClick={() => setTab('chat')}><span className="m-tab-ic"><Svg d={ICON.spark} size={21} /></span>AI chat</button>
      </nav>
    </div>
  );
}

// AI chat: the account's default model (GLM 5.3 Flash when it's set up), kept on this phone.
const CHAT_KEY = 'linework:m-chat';
function MobileChat({ apps, user }) {
  const key = `${CHAT_KEY}:${user.id || user.email || ''}`;
  const [msgs, setMsgs] = useState(() => { try { return JSON.parse(localStorage.getItem(key) || '[]'); } catch (e) { return []; } });
  const [text, setText] = useState(''), [busy, setBusy] = useState(false), [off, setOff] = useState(null);
  const endRef = useRef(null), stop = useRef(null);
  useEffect(() => { refreshAI().then(s => { if (!s) setOff(NO_AI); }); }, []);
  useEffect(() => { try { localStorage.setItem(key, JSON.stringify(msgs.slice(-60))); } catch (e) {} endRef.current?.scrollIntoView({ block: 'end' }); }, [msgs, key]);
  const send = async e => {
    e?.preventDefault();
    const q = text.trim();
    if (!q || busy) return;
    const sample = await sampleP;
    if (!sample) { setOff(NO_AI); return; }
    const history = [...msgs, { who: 'you', text: q }];
    setMsgs([...history, { who: 'ai', text: '' }]); setText(''); setBusy(true);
    const names = apps.map(f => f.flow.app.name).join(', ');
    const prompt = `You are the assistant in WorkLine Apps, a phone app where ${user.name || 'the user'} runs workflows published on WorkLine${names ? ` (here: ${names})` : ''}. Answer briefly and clearly, in the language the user writes in. Use Markdown only for short lists or code.\n\n`
      + history.slice(-12).map(m => `${m.who === 'you' ? 'User' : 'Assistant'}: ${m.text}`).join('\n\n') + '\n\nAssistant:';
    const ctl = new AbortController(); stop.current = ctl;
    try {
      await sample(prompt, { signal: ctl.signal, onText: ({ text: t }) => setMsgs(m => [...m.slice(0, -1), { who: 'ai', text: t }]) });
    } catch (err) {
      const why = err && err.code === 'daily_limit' ? 'Today’s AI limit is used up. It resets at midnight UTC.' : err && err.code === 'signed_out' ? 'Sign in again to use AI.' : err && err.code === 'cancelled' ? null : 'AI didn’t answer. Try again.';
      setMsgs(m => { const last = m[m.length - 1]; return why ? [...m.slice(0, -1), { who: 'ai', text: last.text || why, error: !last.text }] : m; });
    }
    setBusy(false); stop.current = null;
  };
  return (
    <div className="m-chat">
      {off && <p className="m-note">{off}</p>}
      {!msgs.length && !off && <div className="m-chat-empty"><b>Ask anything</b><span>Write, translate, plan, or ask how to use a workflow.</span></div>}
      <div className="m-msgs" aria-live="polite">
        {msgs.map((m, i) => (m.who === 'you'
          ? <p key={i} className="m-msg you">{m.text}</p>
          : <div key={i} className={'m-msg ai' + (m.error ? ' err' : '')}>{m.text ? <div dangerouslySetInnerHTML={{ __html: md(m.text) }} /> : <span className="m-dots" aria-label="Thinking"><i /><i /><i /></span>}</div>))}
        <div ref={endRef} />
      </div>
      <form className="m-ask" onSubmit={send}>
        {msgs.length > 0 && !busy && <button type="button" className="m-ib" aria-label="New chat" title="New chat" onClick={() => setMsgs([])}>＋</button>}
        <textarea rows={1} aria-label="Message" placeholder="Message AI…" value={text} onChange={e => setText(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey && !('ontouchstart' in window)) { e.preventDefault(); send(); } }} />
        {busy ? <button type="button" className="m-send" aria-label="Stop" onClick={() => stop.current?.abort()}>■</button>
          : <button className="m-send" aria-label="Send" disabled={!text.trim() || !!off}>↑</button>}
      </form>
    </div>
  );
}
