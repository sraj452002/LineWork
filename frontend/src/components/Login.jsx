import { useEffect, useState } from 'react';
import { accountSettings, authMessage, chooseLocal, createAccount, resendConfirmation, sendPasswordReset, setPassword, signIn, signInWith, verifyCode } from '../lib/auth.js';
import { Brand } from './ui.jsx';

const PROVIDERS = [['google', 'Google'], ['github', 'GitHub'], ['gitlab', 'GitLab'], ['bitbucket', 'Bitbucket']];

// pending: {type: 'recovery' | 'mfa', token} when arriving from a password-reset link,
// or from Google/GitHub on an account with two-step verification. notice: a message to show.
export default function Login({ onSignedIn, pending, notice }) {
  const [settings, setSettings] = useState(undefined); // undefined: checking; null: accounts unavailable
  const [mode, setMode] = useState(!pending ? 'in' : pending.type === 'mfa' ? 'mfa' : 'password'); // in | up | reset | password | mfa
  const [challenge, setChallenge] = useState(pending && pending.type === 'mfa' ? pending.token : null);
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [password, setPw] = useState('');
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [note, setNote] = useState(notice || '');
  const [unconfirmed, setUnconfirmed] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => { accountSettings().then(setSettings); }, []);

  const go = m => { setMode(m); setError(''); setNote(''); setUnconfirmed(false); };
  const run = async fn => {
    setBusy(true); setError(''); setNote(''); setUnconfirmed(false);
    try { await fn(); } catch (e) { setError(authMessage(e)); if (e && e.code === 'unverified') setUnconfirmed(true); } finally { setBusy(false); }
  };
  // The server may answer a password with "now the code from your app".
  const done = r => {
    if (r && r.mfa) { setChallenge(r.mfa); setCode(''); setPw(''); setMode('mfa'); return; }
    onSignedIn({ mode: 'cloud', user: r });
  };
  const submit = e => {
    e.preventDefault();
    if (mode === 'in') run(async () => done(await signIn(email, password)));
    else if (mode === 'up') run(async () => {
      if (password.length < 8) throw new Error('Use a longer password (at least 8 characters).');
      const r = await createAccount(email, password, name);
      if (!r.pending) done(r); // signed in already
      else { setMode('in'); setPw(''); setNote(`Check ${email.trim()} for a link to confirm your account. It signs you in.`); }
    });
    else if (mode === 'reset') run(async () => { await sendPasswordReset(email); setNote(`If ${email.trim()} has an account, a reset link is on its way.`); });
    else if (mode === 'mfa') run(async () => {
      try { done(await verifyCode(challenge, code)); }
      catch (e) { if (e.code === 'bad_challenge' || e.code === 'too_many') { setMode('in'); setChallenge(null); } throw e; }
    });
    else run(async () => {
      if (password.length < 8) throw new Error('Use a longer password (at least 8 characters).');
      done(await setPassword(password, pending && pending.token));
    });
  };
  const local = () => { chooseLocal(); onSignedIn({ mode: 'local' }); };
  const resend = () => run(async () => { await resendConfirmation(email); setNote(`A new link is on its way to ${email.trim()}.`); });

  const providers = settings ? PROVIDERS.filter(([k]) => settings.providers && settings.providers[k]) : [];
  const canReset = settings && settings.mail;
  const showLocal = settings !== undefined && mode !== 'password' && mode !== 'mfa' && (settings === null || settings.allowLocal);
  const title = { in: 'Sign in', up: 'Create your account', reset: 'Reset your password', mfa: 'Two-step verification', password: 'Set a new password' }[mode];

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
          : mode === 'mfa' ? <p>Enter the 6-digit code from your authenticator app.</p>
          : <p>Use at least 8 characters.</p>}
        {error && <p className="err" role="alert">{error}</p>}
        {unconfirmed && <p><button type="button" className="link" onClick={resend} disabled={busy}>Send the confirmation email again</button></p>}
        {note && <p className="ok" role="status">{note}</p>}

        {settings && (<>
          {mode === 'up' && (<>
            <label htmlFor="n">Name</label>
            <input id="n" value={name} onChange={e => setName(e.target.value)} autoComplete="name" />
          </>)}
          {mode === 'mfa' ? (<>
            <label htmlFor="c">Code</label>
            <input id="c" value={code} onChange={e => setCode(e.target.value)} inputMode="numeric" autoComplete="one-time-code" autoCapitalize="none" spellCheck="false" autoFocus required />
          </>) : (<>
            {mode !== 'password' && (<>
              <label htmlFor="u">Email</label>
              <input id="u" type="email" value={email} onChange={e => setEmail(e.target.value)} autoComplete="email" autoCapitalize="none" spellCheck="false" autoFocus required />
            </>)}
            {mode !== 'reset' && (<>
              <label htmlFor="p">{mode === 'password' ? 'New password' : 'Password'}</label>
              <input id="p" type="password" value={password} onChange={e => setPw(e.target.value)} autoComplete={mode === 'in' ? 'current-password' : 'new-password'} required />
            </>)}
          </>)}
          <button type="submit" disabled={busy}>{busy ? 'One moment' : { in: 'Sign in', up: 'Create account', reset: 'Send reset link', password: 'Save password', mfa: 'Verify' }[mode]}</button>

          {(mode === 'in' || mode === 'up') && providers.length > 0 && (
            <div className="login-alt">
              <span>or</span>
              {providers.map(([k, n]) => <button key={k} type="button" className="btn" onClick={() => signInWith(k)}>Continue with {n}</button>)}
            </div>
          )}
          <div className="login-links">
            {mode === 'in' && <>{settings.signup !== false && <button type="button" className="link" onClick={() => go('up')}>Create an account</button>}
              {canReset
                ? <button type="button" className="link" onClick={() => go('reset')}>Forgot password?</button>
                : <small className="login-hint">Forgot your password? Ask whoever runs this server to reset it.</small>}</>}
            {(mode === 'up' || mode === 'reset') && <button type="button" className="link" onClick={() => go('in')}>I already have an account</button>}
            {mode === 'mfa' && <>
              <small className="login-hint left">Lost your phone? Enter one of your recovery codes instead.</small>
              <button type="button" className="link" onClick={() => { setChallenge(null); go('in'); }}>Start over</button>
            </>}
          </div>
        </>)}

        {showLocal && (
          <div className="login-local">
            <button type="button" className={settings ? 'link' : 'btn dark wide'} onClick={local}>Continue without an account</button>
            {settings && <small>Files stay in this browser only, and AI is off.</small>}
          </div>
        )}
      </form>
    </main>
  );
}
