import { useEffect, useState } from 'react';
import Login from './Login.jsx';
import { AppRunner } from './Apps.jsx';
import { useUI } from './ui.jsx';
import { signOut, startSession } from '../lib/auth.js';
import { listFiles } from '../lib/cloud.js';
import { livePages, publishedApps } from '../lib/apps.js';
import { AppIcon } from './AppIcon.jsx';
import { api, asUser, serverInfo } from '../lib/backend.js';
import Assistant from './Assistant.jsx';

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
  // Pages (active workflows with a Page trigger) open here too, full screen, with a way back.
  const pages = store ? store.pages || [] : [];
  const [page, setPage] = useState(null);
  const [tab, setTab] = useState('workflows'); // workflows | pages | chat (Nemo)
  // Nemo (AI chat) beside the workflows and pages, on a server without accounts (where anyone may use its AI).
  const [chatOk, setChatOk] = useState(false);
  useEffect(() => { serverInfo().then(i => setChatOk(!!(i && i.accounts === false)), () => {}); }, []);
  // An open page is a step back in history, so the phone's back button returns to the list (not out of the app).
  useEffect(() => {
    if (!page) return undefined;
    history.pushState({ mPage: page.id }, '');
    const back = () => setPage(null);
    addEventListener('popstate', back);
    return () => removeEventListener('popstate', back);
  }, [page?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const open = apps.find(a => a.id === openId);
  // Runs it on the server; a long one is asked about again until it's done.
  // (A run that stops at an Editor answers {status: 'edit', nodeId, card}; continuer goes on from it.)
  const storeCall = async (path, body) => {
    const post = await fetch(`/api/store/${encodeURIComponent(open.id)}/${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    let j = await post.json().catch(() => ({}));
    for (let i = 0; i < 200 && j.status === 'running' && j.token; i++) {
      await new Promise(r => setTimeout(r, 1500));
      const r = await fetch(`/api/store/runs/${j.token}`, { cache: 'no-store' });
      j = await r.json().catch(() => ({ status: 'error', error: 'Lost the run.' }));
    }
    if (j.status === 'success') return { status: 'success', items: j.items || [] };
    if (j.status === 'edit') return { status: 'edit', nodeId: j.nodeId, card: j.card };
    return { status: 'error', error: j.error || j.message || 'It couldn’t run.' };
  };
  const runner = form => storeCall('run', { input: form });
  const continuer = (nodeId, edited) => storeCall('continue', { nodeId, edited });
  if (page) return (
    <div className="m-page-view">
      <div className="m-page-bar"><button className="btn" onClick={() => (history.state?.mPage ? history.back() : setPage(null))}>← Pages</button><b>{page.title}</b></div>
      <iframe title={page.title} src={page.url} credentialless="" />
    </div>
  );
  if (open) return (
    <div className="m-shell m-run">
      <AppRunner file={{ id: open.id, flow: { nodes: [], edges: [], app: open } }} server runner={runner} continuer={continuer} backLabel="← Workflows" onBack={() => setOpenId(null)} />
    </div>
  );
  const list = (
    <div className="m-shell">
      <MobileBar onRefresh={tab === 'chat' ? null : load} busy={busy} title={tab === 'pages' ? 'Pages' : tab === 'chat' ? 'Nemo' : 'Workflows'} hello={(store && store.name) || greeting()} />
      {error && <p className="m-note err">{error} <button className="link" onClick={load}>Try again</button></p>}
      {!store && !error && <Skeleton />}
      {(store || chatOk) && <Sections tab={tab} setTab={setTab} apps={apps.length} pages={pages.length} chat={chatOk} />}
      {tab === 'chat' ? <Assistant compact user={null} />
        : store && (tab === 'pages' ? (!pages.length ? <Empty text="No pages yet. A workflow with a Page trigger, published as a web app, shows up here." />
          : <Workflows kind="page" items={pages.map(pg => ({ key: pg.id, name: pg.title, description: pg.description, icon: pg.icon || '🌐', tone: 'sky', web: true, label: `Open ${pg.title}`, onClick: () => setPage(pg) }))} />)
        : !apps.length ? <Empty text="No workflows yet. Publish a workflow as an app and it shows up here." />
        : <Workflows items={apps.map(a => ({ key: a.id, name: a.name, description: a.description, icon: a.icon, tone: a.tone, label: `Run ${a.name}`, onClick: () => setOpenId(a.id) }))} />)}
    </div>
  );
  return list;
}

// The account owner's own view (/mobile): their published workflows, and AI chat.
function OwnerApp() {
  // undefined while checking; null when nobody is signed in.
  const [session, setSession] = useState(undefined);
  useEffect(() => {
    startSession().then(async s => {
      // A server without accounts: its one built-in user's apps, without signing in.
      if (s && s.server) { try { return setSession({ mode: 'cloud', server: true, user: asUser((await api('/auth/me')).user) }); } catch (e) { /* shown as signed out */ } }
      setSession(s);
    }, () => setSession(null));
  }, []);
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
  refresh: 'M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8M21 3v5h-5',
  search: 'M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14zm9 3-4.35-4.35',
  grid: 'M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h6v6h-6z',
  spark: 'M12 3l1.9 5.6L19.5 10.5l-5.6 1.9L12 18l-1.9-5.6L4.5 10.5l5.6-1.9zM19 16l.8 2.2L22 19l-2.2.8L19 22l-.8-2.2L16 19l2.2-.8z',
};

const greeting = () => { const h = new Date().getHours(); return h < 5 ? 'Good night' : h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening'; };

function MobileBar({ user, onSignOut, onRefresh, busy, title = 'WorkLine Apps', hello }) {
  return (
    <header className="m-bar">
      <div className="m-title">{hello && <small>{hello}</small>}<h1>{title}</h1></div>
      {onRefresh && <button className="m-ib" aria-label="Refresh" onClick={onRefresh} disabled={busy}><span className={busy ? 'm-spin' : ''}><Svg d={ICON.refresh} size={19} /></span></button>}
      {user && <button className="m-ib m-me" aria-label={`Sign out ${user.email || ''}`} title="Sign out" onClick={onSignOut}>{(user.name || user.email || '?')[0].toUpperCase()}</button>}
    </header>
  );
}

const Skeleton = () => <div className="m-skel" aria-busy="true"><i /><b /><b /></div>;
const Empty = ({ children, text }) => <div className="m-empty"><span aria-hidden="true"><Svg d={ICON.grid} size={26} /></span><p>{children || text}</p></div>;

/* The workflows: the first one large (it's the one most people came for), the rest in a list, and a
   search once there are a few. Each item: { key, name, description, icon, tone, label, web, onClick }. */
function Workflows({ items, kind = 'workflow' }) {
  const what = kind === 'page' ? 'pages' : 'workflows';
  const [q, setQ] = useState('');
  const needle = q.trim().toLowerCase();
  const shown = items.filter(it => !needle || `${it.name} ${it.description || ''}`.toLowerCase().includes(needle));
  const top = needle ? null : shown[0];
  const rest = needle ? shown : shown.slice(1);
  return (<>
    {items.length > 3 && <label className="m-search"><Svg d={ICON.search} size={18} /><input type="search" placeholder={`Search ${what}`} aria-label={`Search ${what}`} value={q} onChange={e => setQ(e.target.value)} /></label>}
    {top && (
      <button className={'m-feat t-' + (top.tone || 'violet')} onClick={top.onClick} aria-label={top.label}>
        <span className="m-feat-head"><i aria-hidden="true"><AppIcon icon={top.icon} fallback={top.web ? '🌐' : '✨'} /></i><small>{top.web ? 'Page' : 'Workflow'}</small></span>
        <b>{top.name}</b>
        {top.description && <span className="m-feat-desc">{top.description}</span>}
        <span className="m-feat-go" aria-hidden="true"><Svg d={top.web ? ICON.open : ICON.play} fill={!top.web} size={16} />{top.web ? 'Open' : 'Run now'}</span>
      </button>
    )}
    {rest.length > 0 && <>
      {!needle && <h2 className="m-sec">More {what} <small>{rest.length}</small></h2>}
      <div className="m-rows">
        {rest.map((it, i) => (
          <button key={it.key} className={'m-row t-' + (it.tone || 'blue')} style={{ animationDelay: `${Math.min(i, 10) * 40}ms` }} onClick={it.onClick} aria-label={it.label}>
            <i aria-hidden="true"><AppIcon icon={it.icon} fallback={it.web ? '🌐' : '✨'} /></i>
            <span className="m-row-txt"><b>{it.name}</b><small>{it.description || (it.web ? 'Tap to open' : 'Tap to run')}</small></span>
            <em aria-hidden="true"><Svg d={it.web ? ICON.open : ICON.play} fill={!it.web} size={14} /></em>
          </button>
        ))}
      </div>
    </>}
    {needle && !shown.length && <Empty text={`Nothing called “${q.trim()}”.`} />}
  </>);
}

/* Workflows and pages apart: a workflow runs here with a form; a page opens at its own link. */
function Sections({ tab, setTab, apps, pages, chat }) {
  return (
    <div className="m-seg" role="tablist" aria-label="Show">
      <button role="tab" aria-selected={tab === 'workflows'} onClick={() => setTab('workflows')}>Workflows <b>{apps}</b></button>
      <button role="tab" aria-selected={tab === 'pages'} onClick={() => setTab('pages')}>Pages <b>{pages}</b></button>
      {chat && <button role="tab" aria-selected={tab === 'chat'} onClick={() => setTab('chat')}>✦ Nemo</button>}
    </div>
  );
}

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
  const [kind, setKind] = useState('workflows'); // workflows | pages | chat (Nemo)
  const out = async () => { if (await ask({ title: 'Sign out?', text: 'You can sign in again any time.', input: false, ok: 'Sign out' })) onSignOut(); };
  // A web app opens here, full screen, with a way back.
  if (page) return (
    <div className="m-page-view">
      <div className="m-page-bar"><button className="btn" onClick={() => setPage(null)}>← Pages</button><b>{page.title}</b></div>
      <iframe title={page.title} src={page.url} credentialless="" />
    </div>
  );
  return (
    <div className="m-app-shell">
      <div className="m-shell">
        {open && tab === 'run' ? <div className="m-run"><AppRunner file={open} server={server} onBack={() => setOpenId(null)} /></div> : (<>
          <MobileBar user={session.server ? null : session.user} onSignOut={out} onRefresh={kind !== 'chat' ? load : null} busy={busy} title={kind === 'chat' ? 'Nemo' : kind === 'pages' ? 'Pages' : 'Workflows'}
            hello={`${greeting()}${session.user.name ? `, ${session.user.name.split(' ')[0]}` : ''}`} />
          {install && <button className="btn primary m-wide m-install" onClick={async () => { install.prompt(); await install.userChoice.catch(() => {}); setInstall(null); }}>⬇ Install WorkLine Apps</button>}
          <Sections tab={kind} setTab={setKind} apps={apps.length} pages={pages.length} chat />
          {kind !== 'chat' ? (<>
            {error && <p className="m-note err">{error} <button className="link" onClick={load}>Try again</button></p>}
            {!files && !error && <Skeleton />}
            {files && (!apps.length && !pages.length ? <Empty>No published workflows yet. On WorkLine, open a workflow and press <b>Publish</b>: it shows up here.</Empty>
              : kind === 'pages' ? (!pages.length ? <Empty text="No pages yet. A workflow with a Page trigger, published as a web app, shows up here." />
                : <Workflows kind="page" items={pages.map(p => ({ key: p.id, name: p.title, description: p.description, icon: p.icon, tone: 'sky', web: true, label: `Open ${p.title}`, onClick: () => setPage(p) }))} />)
              : !apps.length ? <Empty text="No workflows yet. Publish a workflow as an app and it shows up here." />
              : <Workflows items={apps.map(f => ({ key: f.id, ...f.flow.app, label: `Run ${f.flow.app.name}`, onClick: () => setOpenId(f.id) }))} />)}
          </>) : <Assistant compact user={session.user} />}
        </>)}
      </div>
    </div>
  );
}

