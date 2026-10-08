import { useCallback, useEffect, useRef, useState } from 'react';
import { addShare, api, asUser, getVersion, listShares, listVersions, openShared, removeShare, saveShared, serverInfo, sharedToken } from '../lib/backend.js';
import { clone, rid } from '../lib/utils.js';
import { useUI } from './ui.jsx';
import Editor from './Editor.jsx';

/* What the Linework server (server/) adds: share links, version history, the page a share link opens,
   and account settings (name, password, two-step verification, Google/GitHub). */

function Modal({ title, onClose, children, wide }) {
  const ref = useRef(null);
  useEffect(() => { ref.current?.querySelector('button, input, select')?.focus(); }, []);
  return (
    <div className="modal" onClick={e => { if (e.target === e.currentTarget) onClose(); }} onKeyDown={e => { if (e.key === 'Escape') onClose(); }}>
      <div className={'mbox srv-box' + (wide ? ' wide' : '')} role="dialog" aria-modal="true" aria-labelledby="srvTitle" ref={ref}>
        <h3 id="srvTitle">{title}</h3>
        {children}
      </div>
    </div>
  );
}

const when = t => new Date(t).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
const ago = t => {
  const m = Math.round((Date.now() - t) / 60000);
  return m < 1 ? 'just now' : m < 60 ? `${m} min ago` : m < 1440 ? `${Math.round(m / 60)} h ago` : when(t);
};

// Share: make links that open this file read-only or editable, copy them, and turn them off.
export function ShareDialog({ file, saving, onClose }) {
  const { toast } = useUI();
  const [links, setLinks] = useState(null);
  const [err, setErr] = useState('');
  const [mode, setMode] = useState('view');
  const load = useCallback(() => listShares(file.id).then(setLinks, e => setErr(e.message || 'Couldn’t load the links.')), [file.id]);
  useEffect(() => { load(); }, [load]);
  const copy = url => navigator.clipboard?.writeText(url).then(() => toast('Link copied'), () => toast('Copy the link from the box'));
  const make = async () => {
    setErr('');
    // A brand-new file may still be on its way to the account: give it a moment, once.
    const add = () => addShare(file.id, mode).catch(e => (e.code === 'not_found' ? new Promise(r => setTimeout(r, 1500)).then(() => addShare(file.id, mode)) : Promise.reject(e)));
    try { const l = await add(); await load(); copy(l.url); }
    catch (e) { setErr(e.code === 'not_found' ? 'This file hasn’t reached your account yet. Wait for “Saved”, then try again.' : e.message || 'Couldn’t make a link.'); }
  };
  return (
    <Modal title={`Share “${file.title || 'Untitled'}”`} onClose={onClose}>
      <p>Anyone with a link can open this file{saving ? ' as it was last saved' : ''}. An edit link also lets them change it; their changes are saved to your account.</p>
      <div className="srv-row">
        <div className="seg" role="group" aria-label="Link access">
          <button aria-pressed={mode === 'view'} onClick={() => setMode('view')}>Can view</button>
          <button aria-pressed={mode === 'edit'} onClick={() => setMode('edit')}>Can edit</button>
        </div>
        <button className="btn dark" onClick={make}>Create link</button>
      </div>
      {err && <p className="err" role="alert">{err}</p>}
      {links && links.length > 0 && (
        <ul className="srv-list" aria-label="Links">
          {links.map(l => (
            <li key={l.token}>
              <span className={'srv-tag ' + l.mode}>{l.mode === 'edit' ? 'Can edit' : 'Can view'}</span>
              <input readOnly value={l.url} aria-label="Link" onFocus={e => e.target.select()} />
              <button className="btn" onClick={() => copy(l.url)}>Copy</button>
              <button className="btn" onClick={() => removeShare(l.token).then(load)} aria-label="Turn off this link">Turn off</button>
            </li>
          ))}
        </ul>
      )}
      {links && !links.length && <p className="srv-empty">No links yet.</p>}
      <div className="mact"><button className="btn" onClick={onClose}>Done</button></div>
    </Modal>
  );
}

// Version history: the file as it stood after each stretch of editing; restore one.
export function HistoryDialog({ file, onRestore, onClose }) {
  const [list, setList] = useState(null);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(null);
  useEffect(() => { listVersions(file.id).then(setList, e => setErr(e.code === 'offline' ? e.message : 'Couldn’t load the history.')); }, [file.id]);
  const restore = async v => {
    setBusy(v.id);
    try { const { file: old, saved } = await getVersion(file.id, v.id); onRestore(old, saved); onClose(); }
    catch (e) { setErr(e.message || 'Couldn’t restore that version.'); setBusy(null); }
  };
  return (
    <Modal title="Version history" onClose={onClose} wide>
      <p>A version is kept for each stretch of editing (the last 100). Restoring one keeps the current version in this list too.</p>
      {err && <p className="err" role="alert">{err}</p>}
      {!list && !err && <p className="srv-empty">Loading…</p>}
      {list && !list.length && <p className="srv-empty">No versions yet. They appear once the file is saved to your account.</p>}
      {list && list.length > 0 && (
        <ol className="srv-list" aria-label="Versions">
          {list.map((v, i) => (
            <li key={v.id}>
              <span className="srv-when"><b>{i === 0 ? 'Current version' : when(v.saved)}</b><small>{i === 0 ? ago(v.saved) : v.title || 'Untitled'} · {Math.max(1, Math.round(v.size / 1024))} KB</small></span>
              {i > 0 && <button className="btn" disabled={busy != null} onClick={() => restore(v)}>{busy === v.id ? 'Restoring…' : 'Restore'}</button>}
            </li>
          ))}
        </ol>
      )}
      <div className="mact"><button className="btn" onClick={onClose}>Close</button></div>
    </Modal>
  );
}

// The page a share link opens (/s/<token>): the file in the editor. Edit links save back to the owner's
// account; view links can be changed on screen but aren't saved, and can be copied.
export function SharedFile({ onGuide }) {
  const { toast } = useUI();
  const token = sharedToken();
  const [state, setState] = useState(null); // {mode, owner, file} | {error}
  const [file, setFile] = useState(null);
  const [saveState, setSaveState] = useState('');
  useEffect(() => {
    openShared(token).then(s => { setState(s); setFile(s.file); setSaveState(s.mode === 'edit' ? 'Saved' : 'View only'); },
      e => setState({ error: e.code === 'not_found' ? 'This link has been turned off, or the file was deleted.' : e.message || 'Couldn’t open this link.' }));
  }, [token]);

  // Edit links: save shortly after each change; retry what fails.
  const latest = useRef(null), timer = useRef(0);
  const save = useCallback(async () => {
    const f = latest.current;
    if (!f) return;
    try { await saveShared(token, f); if (latest.current === f) setSaveState('Saved'); }
    catch (e) { setSaveState('Not saved'); if (e.code === 'view_only' || e.code === 'not_found') toast('This link no longer allows editing.'); else timer.current = setTimeout(save, 15000); }
  }, [token, toast]);
  const update = useCallback(fn => setFile(f => {
    const c = clone(f);
    fn(c);
    c.updated = Date.now();
    if (state && state.mode === 'edit') {
      latest.current = c;
      setSaveState('Saving');
      clearTimeout(timer.current);
      timer.current = setTimeout(save, 900);
    }
    return c;
  }), [state, save]);
  useEffect(() => () => clearTimeout(timer.current), []);

  // Keep a copy: in the visitor's account when signed in to this server, else in this browser.
  const copy = async () => {
    const c = clone(file);
    c.id = rid('f'); c.title = (file.title || 'Untitled') + ' (copy)'; c.created = c.updated = Date.now();
    try { await api('/files/' + c.id, { method: 'PUT', body: c }); toast('Copied to your files'); return; }
    catch (e) { if (e.status !== 401) { toast('Couldn’t copy it. Try again.'); return; } }
    const { loadFiles, saveFiles } = await import('../lib/storage.js');
    saveFiles([...loadFiles(), c]) ? toast('Copied to the files in this browser') : toast('Browser storage is full.');
  };

  if (!state) return <div className="boot" aria-busy="true" />;
  if (state.error) {
    return (
      <main className="login"><form onSubmit={e => e.preventDefault()}>
        <h1>Link unavailable</h1><p>{state.error}</p>
        <a className="btn dark wide" href="/">Open Linework</a>
      </form></main>
    );
  }
  return (
    <>
      <div className={'shared-bar ' + state.mode} role="status">
        {state.mode === 'edit'
          ? <>Editing <b>{state.owner}</b>’s file. Your changes are saved for everyone with the link.</>
          : <>Viewing <b>{state.owner}</b>’s file. Changes you make here aren’t saved; make a copy to keep them.</>}
      </div>
      <Editor key={file.id} file={file} update={update} saveState={saveState}
        onBack={() => { location.href = '/'; }} onDuplicate={copy} duplicateLabel="Make a copy for me" onGuide={onGuide} />
    </>
  );
}

// Account & security: name, password, two-step verification, and Google/GitHub sign-in.
export function AccountDialog({ onUser, onClose }) {
  const { toast } = useUI();
  const [me, setMe] = useState(null);
  const [providers, setProviders] = useState({});
  const [err, setErr] = useState('');
  const [name, setName] = useState('');
  const [pw, setPw] = useState({ current: '', next: '' });
  const [setup, setSetup] = useState(null);   // {secret, qr} while turning two-step on
  const [codes, setCodes] = useState(null);   // recovery codes, shown once
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);

  const take = r => { setMe(r.user); onUser && onUser(asUser(r.user)); return r; };
  useEffect(() => {
    api('/auth/me').then(r => { setMe(r.user); setName(r.user.name || ''); }, e => setErr(e.message || 'Couldn’t load your account.'));
    serverInfo().then(i => setProviders((i && i.providers) || {}));
  }, []);
  const run = async fn => { setBusy(true); setErr(''); try { await fn(); } catch (e) { setErr(e.message || 'That didn’t work.'); } finally { setBusy(false); } };

  const saveName = () => run(async () => { take(await api('/auth/me', { method: 'PATCH', body: { name } })); toast('Name saved'); });
  const savePw = () => run(async () => {
    if (pw.next.length < 8) throw new Error('Use a longer password (at least 8 characters).');
    take(await api('/auth/me', { method: 'PATCH', body: { password: pw.next, current: pw.current } }));
    setPw({ current: '', next: '' });
    toast('Password saved. Other devices are signed out.');
  });
  const startTotp = () => run(async () => { setSetup(await api('/auth/2fa/setup', { method: 'POST' })); setCode(''); });
  const enableTotp = () => run(async () => { const r = take(await api('/auth/2fa/enable', { method: 'POST', body: { code } })); setSetup(null); setCode(''); setCodes(r.recovery); });
  const disableTotp = () => run(async () => { take(await api('/auth/2fa/disable', { method: 'POST', body: { code } })); setCode(''); toast('Two-step verification is off'); });
  const newCodes = () => run(async () => { const r = await api('/auth/2fa/recovery', { method: 'POST', body: { code } }); setCode(''); setCodes(r.recovery); });
  const unlink = p => run(async () => { take(await api('/auth/unlink', { method: 'POST', body: { provider: p } })); toast(`Disconnected ${providers[p] || p}`); });
  const saveCodes = () => {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([`Linework recovery codes for ${me.email}\nEach works once, in place of a code from your app.\n\n${codes.join('\n')}\n`], { type: 'text/plain' }));
    a.download = 'linework-recovery-codes.txt';
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const linked = me ? Object.fromEntries(me.identities.map(i => [i.provider, i])) : {};
  return (
    <Modal title="Account & security" onClose={onClose} wide>
      {err && <p className="err" role="alert">{err}</p>}
      {!me ? <p className="srv-empty">{err ? '' : 'Loading…'}</p> : (<div className="acct">
        <section aria-labelledby="acct-profile">
          <h4 id="acct-profile">Profile</h4>
          <p className="acct-mail">{me.email}</p>
          <div className="srv-row">
            <input aria-label="Name" placeholder="Your name" value={name} onChange={e => setName(e.target.value)} />
            <button className="btn" disabled={busy || name === (me.name || '')} onClick={saveName}>Save name</button>
          </div>
        </section>

        <section aria-labelledby="acct-pw">
          <h4 id="acct-pw">{me.hasPassword ? 'Password' : 'Set a password'}</h4>
          {!me.hasPassword && <p>You sign in with {me.identities.map(i => providers[i.provider] || i.provider).join(' or ')}. A password lets you sign in with your email too.</p>}
          <div className="srv-row">
            {me.hasPassword && <input type="password" aria-label="Current password" placeholder="Current password" autoComplete="current-password" value={pw.current} onChange={e => setPw({ ...pw, current: e.target.value })} />}
            <input type="password" aria-label="New password" placeholder="New password" autoComplete="new-password" value={pw.next} onChange={e => setPw({ ...pw, next: e.target.value })} />
            <button className="btn" disabled={busy || !pw.next} onClick={savePw}>{me.hasPassword ? 'Change' : 'Set password'}</button>
          </div>
        </section>

        <section aria-labelledby="acct-2fa">
          <h4 id="acct-2fa">Two-step verification <span className={'srv-tag' + (me.totp ? ' edit' : '')}>{me.totp ? 'On' : 'Off'}</span></h4>
          {codes ? (<>
            <p>Your recovery codes. Keep them somewhere safe: each one signs you in once if you lose your phone. They won’t be shown again.</p>
            <ol className="acct-codes" aria-label="Recovery codes">{codes.map(c => <li key={c}><code>{c}</code></li>)}</ol>
            <div className="srv-row">
              <button className="btn" onClick={() => navigator.clipboard?.writeText(codes.join('\n')).then(() => toast('Codes copied'))}>Copy</button>
              <button className="btn" onClick={saveCodes}>Download</button>
              <button className="btn dark" onClick={() => setCodes(null)}>I’ve saved them</button>
            </div>
          </>) : setup ? (<>
            <p>Scan this with an authenticator app (Google Authenticator, 1Password, Authy…), then enter the 6-digit code it shows.</p>
            <div className="acct-qr" role="img" aria-label="QR code for your authenticator app" dangerouslySetInnerHTML={{ __html: setup.qr }} />
            <p className="acct-secret">Can’t scan it? Enter this key: <code>{setup.secret.replace(/(.{4})/g, '$1 ').trim()}</code></p>
            <div className="srv-row">
              <input aria-label="Code from the app" placeholder="123456" inputMode="numeric" autoComplete="one-time-code" value={code} onChange={e => setCode(e.target.value)} />
              <button className="btn dark" disabled={busy || !code} onClick={enableTotp}>Turn on</button>
              <button className="btn" onClick={() => setSetup(null)}>Cancel</button>
            </div>
          </>) : me.totp ? (<>
            <p>Signing in asks for a code from your authenticator app. To turn it off or get new recovery codes, enter a current code (or a recovery code).</p>
            <div className="srv-row">
              <input aria-label="Code from the app" placeholder="Code" inputMode="numeric" autoComplete="one-time-code" value={code} onChange={e => setCode(e.target.value)} />
              <button className="btn" disabled={busy || !code} onClick={newCodes}>New recovery codes</button>
              <button className="btn" disabled={busy || !code} onClick={disableTotp}>Turn off</button>
            </div>
          </>) : (<>
            <p>After your password (or Google/GitHub), also ask for a code from an app on your phone, so a stolen password isn’t enough.</p>
            <div className="srv-row"><button className="btn dark" disabled={busy} onClick={startTotp}>Set up</button></div>
          </>)}
        </section>

        {Object.keys(providers).length > 0 && (
          <section aria-labelledby="acct-sso">
            <h4 id="acct-sso">Sign in with</h4>
            <ul className="srv-list">
              {Object.entries(providers).map(([k, n]) => (
                <li key={k}>
                  <span className="srv-when"><b>{n}</b><small>{linked[k] ? `Connected${linked[k].email ? ' · ' + linked[k].email : ''}` : 'Not connected'}</small></span>
                  {linked[k]
                    ? <button className="btn" disabled={busy} onClick={() => unlink(k)}>Disconnect</button>
                    : <a className="btn" href={`/api/auth/oauth/${k}?link=1`}>Connect</a>}
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>)}
      <div className="mact"><button className="btn" onClick={onClose}>Close</button></div>
    </Modal>
  );
}
