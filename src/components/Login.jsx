import { useEffect, useState } from 'react';
import { accountSettings, authMessage, createAccount, finishInvite, sendPasswordReset, setPassword, signIn, signInWith, chooseLocal } from '../lib/auth.js';
import { Brand } from './ui.jsx';

const PROVIDERS = [['google', 'Google'], ['github', 'GitHub'], ['gitlab', 'GitLab'], ['bitbucket', 'Bitbucket']];

// pending: {type: 'recovery' | 'invite', token} when arriving from a password-reset or invite link.
export default function Login({ onSignedIn, pending }) {
  const [settings, setSettings] = useState(undefined); // undefined: checking; null: accounts unavailable
  const [mode, setMode] = useState(pending ? 'password' : 'in'); // in | up | reset | password
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [password, setPw] = useState('');
  const [error, setError] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => { accountSettings().then(setSettings); }, []);

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
      if (settings && settings.server) onSignedIn({ mode: 'cloud', user }); // already signed in
      else if (settings && settings.autoconfirm) onSignedIn({ mode: 'cloud', user: await signIn(email, password) });
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

  const providers = settings ? PROVIDERS.filter(([k]) => settings.providers && settings.providers[k]) : [];
  const title = { in: 'Sign in', up: 'Create your account', reset: 'Reset your password', password: pending && pending.type === 'invite' ? 'Choose a password' : 'Set a new password' }[mode];

  return (
    <main className="login">
      <form onSubmit={submit} noValidate>
        <Brand />
        <h1>{title}</h1>
        {settings === null ? (
          <p>Accounts aren’t available here yet, so files are saved in this browser only.</p>
        ) : mode === 'in' ? <p>Your files are saved to your account and follow you to any device.</p>
          : mode === 'up' ? <p>Free. Your files are saved to your account.</p>
          : mode === 'reset' ? <p>We’ll email you a link to choose a new password.</p>
          : <p>Use at least 8 characters.</p>}
        {error && <p className="err" role="alert">{error}</p>}
        {note && <p className="ok" role="status">{note}</p>}

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
            {mode === 'in' && <>{settings.signup !== false && <button type="button" className="link" onClick={() => { setMode('up'); setError(''); }}>Create an account</button>}
              {settings.server
                ? <small className="login-hint">Forgot your password? Ask whoever runs this server to reset it.</small>
                : <button type="button" className="link" onClick={() => { setMode('reset'); setError(''); }}>Forgot password?</button>}</>}
            {(mode === 'up' || mode === 'reset') && <button type="button" className="link" onClick={() => { setMode('in'); setError(''); }}>I already have an account</button>}
          </div>
        </>)}

        {settings !== undefined && mode !== 'password' && (
          <div className="login-local">
            <button type="button" className={settings ? 'link' : 'btn dark wide'} onClick={local}>Continue without an account</button>
            {settings && <small>Files stay in this browser only, and AI is off.</small>}
          </div>
        )}
      </form>
    </main>
  );
}
