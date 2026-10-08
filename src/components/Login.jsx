import { useEffect, useState } from 'react';
import { accountSettings, authMessage, createAccount, finishInvite, sendPasswordReset, setPassword, signIn, signInWith, chooseLocal } from '../lib/auth.js';
import { googleEnabled, signInWithGoogle } from '../lib/gdrive.js';
import { Brand } from './ui.jsx';

const PROVIDERS = [['google', 'Google'], ['github', 'GitHub'], ['gitlab', 'GitLab'], ['bitbucket', 'Bitbucket']];

const GOOGLE_NOTICE = {
  cancelled: 'Google sign-in was cancelled.',
  failed: 'Google sign-in didn’t finish. Try again.',
  not_configured: 'Google sign-in isn’t set up on this site yet.',
};

// pending: {type: 'recovery' | 'invite', token} when arriving from a password-reset or invite link.
// notice: why a Google sign-in just came back without signing in.
export default function Login({ onSignedIn, pending, notice }) {
  const [settings, setSettings] = useState(undefined); // undefined: checking; null: accounts unavailable
  const [google, setGoogle] = useState(false); // Google sign-in (files in Google Drive) is set up
  const [mode, setMode] = useState(pending ? 'password' : 'in'); // in | up | reset | password
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [password, setPw] = useState('');
  const [error, setError] = useState(GOOGLE_NOTICE[notice] || '');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => { accountSettings().then(setSettings); googleEnabled().then(setGoogle); }, []);

  const run = async fn => {
    setBusy(true); setError(''); setNote('');
    try { await fn(); } catch (e) { setError(authMessage(e)); } finally { setBusy(false); }
  };
  const submit = e => {
    e.preventDefault();
    if (mode === 'in') run(async () => onSignedIn({ mode: 'cloud', user: await signIn(email, password) }));
    else if (mode === 'up') run(async () => {
      if (password.length < 8) throw new Error('Use a longer password (at least 8 characters).');
      const user = await createAccount(email, password, name);
      if (settings && settings.autoconfirm) onSignedIn({ mode: 'cloud', user: await signIn(email, password) });
      else { setMode('in'); setPw(''); setNote(`Check ${email.trim()} for a link to confirm your account, then sign in.`); }
    });
    else if (mode === 'reset') run(async () => { await sendPasswordReset(email); setNote(`If ${email.trim()} has an account, a reset link is on its way.`); });
    else run(async () => {
      if (password.length < 8) throw new Error('Use a longer password (at least 8 characters).');
      const user = pending && pending.type === 'invite' ? await finishInvite(pending.token, password) : await setPassword(password);
      onSignedIn({ mode: 'cloud', user });
    });
  };
  const local = () => { chooseLocal(); onSignedIn({ mode: 'local' }); };

  const providers = settings ? PROVIDERS.filter(([k]) => settings.providers && settings.providers[k] && !(google && k === 'google')) : [];
  const title = { in: 'Sign in', up: 'Create your account', reset: 'Reset your password', password: pending && pending.type === 'invite' ? 'Choose a password' : 'Set a new password' }[mode];

  return (
    <main className="login">
      <form onSubmit={submit} noValidate>
        <Brand />
        <h1>{title}</h1>
        {settings === null ? (
          <p>{google ? 'Sign in with Google to keep your files in Google Drive, or keep them in this browser.' : 'Accounts aren’t available here yet, so files are saved in this browser only.'}</p>
        ) : mode === 'in' ? <p>Your files are saved to your account and follow you to any device.</p>
          : mode === 'up' ? <p>Free. Your files are saved to your account.</p>
          : mode === 'reset' ? <p>We’ll email you a link to choose a new password.</p>
          : <p>Use at least 8 characters.</p>}
        {error && <p className="err" role="alert">{error}</p>}
        {note && <p className="ok" role="status">{note}</p>}

        {google && mode !== 'password' && (
          <div className="login-google">
            <button type="button" className="btn google" onClick={() => { setBusy(true); signInWithGoogle(); }} disabled={busy}>
              <svg viewBox="0 0 24 24" aria-hidden="true"><path fill="#4285F4" d="M23.5 12.3c0-.8-.1-1.6-.2-2.3H12v4.5h6.5a5.6 5.6 0 0 1-2.4 3.6v3h3.9c2.3-2.1 3.5-5.2 3.5-8.8z"/><path fill="#34A853" d="M12 24c3.2 0 6-1.1 8-2.9l-3.9-3c-1.1.7-2.5 1.2-4.1 1.2-3.1 0-5.8-2.1-6.7-5H1.3v3.1A12 12 0 0 0 12 24z"/><path fill="#FBBC05" d="M5.3 14.3a7.2 7.2 0 0 1 0-4.6V6.6H1.3a12 12 0 0 0 0 10.8z"/><path fill="#EA4335" d="M12 4.8c1.8 0 3.3.6 4.6 1.8l3.4-3.4A12 12 0 0 0 1.3 6.6l4 3.1c.9-2.9 3.6-4.9 6.7-4.9z"/></svg>
              Continue with Google
            </button>
            <small>Your files are saved to a Linework folder in your Google Drive.</small>
            {settings && <span className="login-or">or use email</span>}
          </div>
        )}

        {settings && (<>
          {mode === 'up' && (<>
            <label htmlFor="n">Name</label>
            <input id="n" value={name} onChange={e => setName(e.target.value)} autoComplete="name" />
          </>)}
          {mode !== 'password' && (<>
            <label htmlFor="u">Email</label>
            <input id="u" type="email" value={email} onChange={e => setEmail(e.target.value)} autoComplete="email" autoCapitalize="none" spellCheck="false" autoFocus required />
          </>)}
          {mode !== 'reset' && (<>
            <label htmlFor="p">{mode === 'password' ? 'New password' : 'Password'}</label>
            <input id="p" type="password" value={password} onChange={e => setPw(e.target.value)} autoComplete={mode === 'in' ? 'current-password' : 'new-password'} required />
          </>)}
          <button type="submit" disabled={busy}>{busy ? 'One moment' : { in: 'Sign in', up: 'Create account', reset: 'Send reset link', password: 'Save password' }[mode]}</button>

          {mode !== 'password' && providers.length > 0 && (
            <div className="login-alt">
              <span>or</span>
              {providers.map(([k, n]) => <button key={k} type="button" className="btn" onClick={() => signInWith(k)}>Continue with {n}</button>)}
            </div>
          )}
          <div className="login-links">
            {mode === 'in' && <><button type="button" className="link" onClick={() => { setMode('up'); setError(''); }}>Create an account</button>
              <button type="button" className="link" onClick={() => { setMode('reset'); setError(''); }}>Forgot password?</button></>}
            {(mode === 'up' || mode === 'reset') && <button type="button" className="link" onClick={() => { setMode('in'); setError(''); }}>I already have an account</button>}
          </div>
        </>)}

        {settings !== undefined && mode !== 'password' && (
          <div className="login-local">
            <button type="button" className={settings || google ? 'link' : 'btn dark wide'} onClick={local}>Continue without an account</button>
            {(settings || google) && <small>Files stay in this browser only, and AI is off.</small>}
          </div>
        )}
      </form>
    </main>
  );
}
