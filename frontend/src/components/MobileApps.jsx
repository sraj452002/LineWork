import { useEffect, useState } from 'react';
import Login from './Login.jsx';
import { AppRunner } from './Apps.jsx';
import { useUI } from './ui.jsx';
import { signOut, startSession } from '../lib/auth.js';
import { listFiles } from '../lib/cloud.js';
import { publishedApps } from '../lib/apps.js';
import { serverInfo } from '../lib/backend.js';

/* WorkLine Apps (/mobile): the phone app. It shows the apps published from the account's workflows
   (Home → Apps) and its live web pages, and runs them; nothing to edit, nothing about nodes.
   It installs as an app (a PWA: /mobile.webmanifest and /sw.js), and the Android app (mobile/, made
   with Capacitor) opens this same page. */

export const isMobileShell = () => /^\/mobile\/?$/.test(location.pathname);
// Inside the installed app (the PWA in its own window, or the Android app), home is /mobile.
export const inInstalledApp = () => {
  try { return matchMedia('(display-mode: standalone)').matches || /WorkLineApp/.test(navigator.userAgent); } catch (e) { return false; }
};

// The page's manifest, icons and service worker, added only here so the rest of WorkLine stays a website.
function useInstallable() {
  useEffect(() => {
    const add = (tag, attrs) => { const el = document.createElement(tag); Object.assign(el, attrs); el.dataset.mobile = '1'; document.head.appendChild(el); return el; };
    const els = [
      add('link', { rel: 'manifest', href: '/mobile.webmanifest' }),
      add('link', { rel: 'apple-touch-icon', href: '/icons/apple-touch-icon.png' }),
      add('meta', { name: 'theme-color', content: '#1D2320' }),
      add('meta', { name: 'apple-mobile-web-app-capable', content: 'yes' }),
      add('meta', { name: 'apple-mobile-web-app-title', content: 'WorkLine Apps' }),
    ];
    document.title = 'WorkLine Apps';
    if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});
    return () => els.forEach(el => el.remove());
  }, []);
}

// Live pages: workflows that are active and start with a Page trigger, at their own link.
const livePages = files => files.filter(f => !f.archived && f.flow && f.flow.active).flatMap(f => (f.flow.nodes || [])
  .filter(n => n.type === 'trigger.page' && n.params && n.params.path)
  .map(n => ({ id: `${f.id}:${n.id}`, title: f.title, url: n.params.link ? `/p/${n.params.link}` : `/api/hook/${n.params.path}`, link: n.params.link })));

export default function MobileApps() {
  useInstallable();
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

function MobileBar({ user, onSignOut, onRefresh, busy }) {
  return (
    <header className="m-bar">
      <img className="m-logo" src="/icons/icon-192.png" alt="" />
      <h1>WorkLine Apps</h1>
      {onRefresh && <button className="m-ib" aria-label="Refresh" onClick={onRefresh} disabled={busy}><span className={busy ? 'm-spin' : ''}>↻</span></button>}
      {user && <button className="m-ib m-me" aria-label={`Sign out ${user.email || ''}`} title="Sign out" onClick={onSignOut}>{(user.name || user.email || '?')[0].toUpperCase()}</button>}
    </header>
  );
}

function AppsHome({ session, onSignOut }) {
  const { ask } = useUI();
  const [files, setFiles] = useState(null), [error, setError] = useState(null), [busy, setBusy] = useState(false);
  const [openId, setOpenId] = useState(null), [server, setServer] = useState(undefined), [q, setQ] = useState('');
  const [install, setInstall] = useState(null);
  const load = () => { setBusy(true); setError(null); listFiles().then(f => { setFiles(f); setBusy(false); }, e => { setError(e.message || 'Couldn’t load your apps.'); setBusy(false); }); };
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
  const out = async () => { if (await ask({ title: 'Sign out?', text: 'You can sign in again any time.', input: false, ok: 'Sign out' })) onSignOut(); };
  if (open) return (
    <div className="m-shell m-run">
      <AppRunner file={open} server={server} onBack={() => setOpenId(null)} />
    </div>
  );
  const needle = q.trim().toLowerCase();
  const shownApps = apps.filter(f => !needle || `${f.flow.app.name} ${f.flow.app.description || ''}`.toLowerCase().includes(needle));
  const shownPages = pages.filter(p => !needle || `${p.title} ${p.link || ''}`.toLowerCase().includes(needle));
  const ios = /iphone|ipad|ipod/i.test(navigator.userAgent) && !inInstalledApp();
  return (
    <div className="m-shell">
      <MobileBar user={session.user} onSignOut={out} onRefresh={load} busy={busy} />
      <p className="m-hello">Hi {(session.user.name || session.user.email || '').split(/[ @]/)[0]}! Your apps, ready to run.</p>
      {install && <button className="btn primary m-wide m-install" onClick={async () => { install.prompt(); await install.userChoice.catch(() => {}); setInstall(null); }}>⬇ Install WorkLine Apps</button>}
      {ios && <p className="m-tip">To install: tap <b>Share</b> → <b>Add to Home Screen</b>.</p>}
      <input className="m-search" type="search" placeholder="Search your apps" aria-label="Search your apps" value={q} onChange={e => setQ(e.target.value)} />
      {error && <p className="m-note err">{error} <button className="link" onClick={load}>Try again</button></p>}
      {!files && !error && <div className="m-skel" aria-busy="true"><i /><i /><i /></div>}
      {files && (<>
        <h2 className="m-h">Apps <small>{shownApps.length}</small></h2>
        {!apps.length ? <p className="m-note">No apps yet. On WorkLine, open a workflow and press <b>Publish</b>: it shows up here.</p>
          : <div className="m-grid">
            {shownApps.map(f => {
              const a = f.flow.app;
              return (
                <button key={f.id} className={'m-app t-' + (a.tone || 'blue')} onClick={() => setOpenId(f.id)} aria-label={`Open the app ${a.name}`}>
                  <i aria-hidden="true">{a.icon || '✨'}</i><b>{a.name}</b>{a.description && <small>{a.description}</small>}
                </button>
              );
            })}
          </div>}
        {pages.length > 0 && (<>
          <h2 className="m-h">Live pages <small>{shownPages.length}</small></h2>
          <div className="m-list">
            {shownPages.map(p => (
              <a key={p.id} className="m-page" href={p.url} aria-label={`Open the page ${p.title}`}>
                <i aria-hidden="true">🌐</i><span><b>{p.title}</b><small>{p.link ? `/p/${p.link}` : 'Page link'}</small></span><em aria-hidden="true">›</em>
              </a>
            ))}
          </div>
        </>)}
      </>)}
      <footer className="m-foot">Make and edit apps on WorkLine on a computer; run them here.</footer>
    </div>
  );
}
