import { useEffect, useState } from 'react';
import { Brand } from './ui.jsx';
import { accountSettings, authMessage, chooseLocal, createAccount, resendConfirmation, sendPasswordReset, setPassword, signIn, signInWith, verifyCode } from '../lib/auth.js';

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
  const [showPw, setShowPw] = useState(false);

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

  // The pointer moves a soft light over the page and tilts the card a few degrees towards it.
  const tilt = e => {
    const el = e.currentTarget, r = el.getBoundingClientRect(), x = e.clientX - r.left, y = e.clientY - r.top;
    el.style.setProperty('--mx', `${x}px`); el.style.setProperty('--my', `${y}px`);
    el.style.setProperty('--tilt-y', `${((x / r.width) - .5) * 5}deg`); el.style.setProperty('--tilt-x', `${(.5 - (y / r.height)) * 4}deg`);
  };
  return (
    <main className="login" onPointerMove={tilt}>
      <div className="login-spot" aria-hidden="true" />
      <LoginThreads />
      <div className="login-blobs" aria-hidden="true"><i className="b1" /><i className="b2" /><i className="b3" /><i className="b4" /></div>
      <div className="login-card wide">
      <aside className="login-side" aria-hidden="true">
        <Brand />
        <LoginOrbit />
        <h2>Design the system,<br />not just the diagram.</h2>
        <div className="login-chips"><span>Diagrams</span><span>Docs</span><span>Sheets</span><span>Code</span></div>
      </aside>
      <form onSubmit={submit} noValidate key={mode}>
        <h1>{title}</h1>
        {settings === null ? (
          <p className="login-sub">Accounts aren’t available here yet, so files are saved in this browser only.</p>
        ) : <p className="login-sub">{{
          in: 'Sign in to pick up your diagrams, docs and code.',
          up: 'Your files are saved to your account and follow you to any device.',
          reset: 'We’ll email you a link to choose a new password.',
          mfa: 'Enter the 6-digit code from your authenticator app.',
          password: 'Use at least 8 characters.',
        }[mode]}</p>}
        {error && <p className="err" role="alert"><Glyph d={G.alert} />{error}</p>}
        {unconfirmed && <p><button type="button" className="link" onClick={resend} disabled={busy}>Send the confirmation email again</button></p>}
        {note && <p className="ok" role="status">{note}</p>}

        {settings && (<>
          {mode === 'up' && (
            <div className="field">
              <label htmlFor="n">Name</label>
              <div className="input"><Glyph d={G.user} /><input id="n" value={name} onChange={e => setName(e.target.value)} autoComplete="name" placeholder="Ada Lovelace" /></div>
            </div>
          )}
          {mode === 'mfa' ? (
            <div className="field">
              <label htmlFor="c">Code</label>
              <div className="input"><Glyph d={G.key} /><input id="c" value={code} onChange={e => setCode(e.target.value)} inputMode="numeric" autoComplete="one-time-code" autoCapitalize="none" spellCheck="false" autoFocus required placeholder="123 456" /></div>
            </div>
          ) : (<>
            {mode !== 'password' && (
              <div className="field">
                <label htmlFor="u">Email</label>
                <div className="input"><Glyph d={G.mail} /><input id="u" type="email" value={email} onChange={e => setEmail(e.target.value)} autoComplete="email" autoCapitalize="none" spellCheck="false" autoFocus required placeholder="you@example.com" /></div>
              </div>
            )}
            {mode !== 'reset' && (
              <div className="field">
                <div className="field-head">
                  <label htmlFor="p">{mode === 'password' ? 'New password' : 'Password'}</label>
                  {mode === 'in' && canReset && <button type="button" className="link" onClick={() => go('reset')}>Forgot password?</button>}
                </div>
                <div className="input">
                  <Glyph d={G.lock} />
                  <input id="p" type={showPw ? 'text' : 'password'} value={password} onChange={e => setPw(e.target.value)} autoComplete={mode === 'in' ? 'current-password' : 'new-password'} required placeholder={mode === 'in' ? 'Your password' : 'At least 8 characters'} />
                  <button type="button" className="pw-eye" aria-pressed={showPw} title={showPw ? 'Hide the password' : 'Show the password'} onClick={() => setShowPw(v => !v)}>
                    <Glyph d={showPw ? G.eyeOff : G.eye} /><span className="sr">{showPw ? 'Hide' : 'Show'}</span>
                  </button>
                </div>
              </div>
            )}
          </>)}
          <button type="submit" className={busy ? 'busy' : undefined} disabled={busy}>
            <span>{busy ? 'One moment' : { in: 'Sign in', up: 'Create account', reset: 'Send reset link', password: 'Save password', mfa: 'Verify' }[mode]}</span>
            {busy ? <i className="spin" aria-hidden="true" /> : <Glyph d={G.arrow} />}
          </button>

          {(mode === 'in' || mode === 'up') && providers.length > 0 && (
            <div className="login-alt">
              <span>or</span>
              {providers.map(([k, n]) => <button key={k} type="button" className="btn" onClick={() => signInWith(k)}>Continue with {n}</button>)}
            </div>
          )}
          {mode === 'in' && !canReset && <p className="login-note">Forgot your password? Ask your admin to reset it.</p>}
          {mode === 'mfa' && <p className="login-note">Lost your phone? Enter one of your recovery codes instead.</p>}
          <div className="login-switch">
            {mode === 'in' && settings.signup !== false && <>New to Workline? <button type="button" className="link" onClick={() => go('up')}>Create an account</button></>}
            {(mode === 'up' || mode === 'reset') && <>Already have an account? <button type="button" className="link" onClick={() => go('in')}>Sign in instead</button></>}
            {mode === 'mfa' && <button type="button" className="link" onClick={() => { setChallenge(null); go('in'); }}>Start over</button>}
          </div>
        </>)}

        {showLocal && (
          <div className="login-local">
            <button type="button" className={settings ? 'link' : 'btn dark wide'} onClick={local}>Continue without an account</button>
            {settings && <small>Files stay in this browser only, and AI is off.</small>}
          </div>
        )}
      </form>
      </div>
    </main>
  );
}


// Small line icons for the form.
const G = {
  mail: 'M4 6h16v12H4zM4 7l8 6 8-6',
  lock: 'M6 11h12v9H6zM8.5 11V8a3.5 3.5 0 0 1 7 0v3',
  user: 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM5 20c1-3.5 4-5 7-5s6 1.5 7 5',
  key: 'M14 10a4 4 0 1 0-1.2 2.8L20 20M17 17l2-2',
  eye: 'M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12zM12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z',
  eyeOff: 'M3 3l18 18M10.6 6c.5-.1.9-.1 1.4-.1 6 0 9.5 6.1 9.5 6.1a17 17 0 0 1-2.6 3.3M6.6 6.7C3.9 8.4 2.5 12 2.5 12s3.5 6.5 9.5 6.5c1.7 0 3.2-.5 4.5-1.2M9.9 9.9a3 3 0 0 0 4.2 4.2',
  arrow: 'M5 12h14M13 6l6 6-6 6',
  alert: 'M12 3l9.5 17h-19zM12 10v4M12 17h.01',
};
const Glyph = ({ d }) => <svg className="glyph" viewBox="0 0 24 24" aria-hidden="true"><path d={d} /></svg>;

// Threads across the whole page behind the card, with light running along them.
const THREADS = [
  'M-60 700C300 520 520 820 820 600S1300 380 1520 520',
  'M-60 220C260 120 560 360 860 240S1260 60 1520 180',
  'M-60 520C320 380 640 640 980 470S1340 330 1520 420',
  'M-60 830C380 760 700 900 1040 760S1360 680 1520 720',
  'M-60 90C340 40 600 180 940 110S1300 30 1520 70',
  'M-60 380C240 300 520 460 760 360S1180 240 1520 300',
];
// Small lights drifting up through the background (the same each time: a fixed seed).
const MOTES = (() => {
  let seed = 7;
  const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  return Array.from({ length: 36 }, () => ({ x: Math.round(rnd() * 1440), y: Math.round(500 + rnd() * 450), r: +(0.8 + rnd() * 1.8).toFixed(1), d: +(14 + rnd() * 18).toFixed(1), t: +(rnd() * 30).toFixed(1) }));
})();
function LoginThreads() {
  return (
    <svg className="login-threads" viewBox="0 0 1440 900" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
      <defs>
        <linearGradient id="thr" x1="0" x2="1" y1="0" y2="0">
          <stop className="thr-a" offset="0" /><stop className="thr-b" offset=".5" /><stop className="thr-a" offset="1" />
        </linearGradient>
        <filter id="thr-glow" x="-20%" y="-20%" width="140%" height="140%"><feGaussianBlur stdDeviation="3" result="b" /><feMerge><feMergeNode in="b" /><feMergeNode in="SourceGraphic" /></feMerge></filter>
      </defs>
      <g className="motes">
        {MOTES.map((m, i) => <circle key={i} cx={m.x} cy={m.y} r={m.r} style={{ animationDuration: `${m.d}s`, animationDelay: `${-m.t}s` }} />)}
      </g>
      {THREADS.map((d, i) => (
        <g key={i}>
          <path className="thr-base" d={d} />
          <path className="thr-flow" d={d} pathLength="100" style={{ animationDuration: `${7 + i * 1.3}s`, animationDelay: `${-i * 1.7}s` }} />
        </g>
      ))}
    </svg>
  );
}

// The tools orbiting Workline in 3D: a tilted ring turns, each tool faces the viewer and is joined to
// the centre by a spoke with light running along it.
const NET_ICON = {
  diagram: 'M4 5h6v5H4zM14 5h6v5h-6zM9 15h6v5H9zM7 10v2h10v-2M12 12v3',
  doc: 'M7 3h7l5 5v13H7zM14 3v5h5M10 13h6M10 17h6',
  sheet: 'M4 4h16v16H4zM4 9h16M4 14h16M9 4v16',
  code: 'M8 7l-5 5 5 5M16 7l5 5-5 5M14 4l-4 16',
  db: 'M4 6c0-1.7 3.6-3 8-3s8 1.3 8 3-3.6 3-8 3-8-1.3-8-3zM4 6v12c0 1.7 3.6 3 8 3s8-1.3 8-3V6M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3',
  ai: 'M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8zM19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8z',
};
const ORBIT = ['diagram', 'db', 'sheet', 'code', 'ai', 'doc'];
function LoginOrbit() {
  return (
    <div className="orbit-scene" aria-hidden="true">
      <div className="orbit-ring">
        <div className="orbit-track" />
        <div className="orbit-track inner" />
        {ORBIT.map((k, i) => (
          <div key={k} className="orbit-item" style={{ '--a': `${i * 60}deg`, '--i': i }}>
            <i className="orbit-spoke" />
            <div className="orbit-pos">
              <div className="orbit-face"><svg viewBox="0 0 24 24"><path d={NET_ICON[k]} /></svg></div>
            </div>
          </div>
        ))}
        <div className="orbit-core">
          <div className="orbit-face core">
            <svg viewBox="0 0 22 22">
              <rect x="1.5" y="3" width="7" height="6" rx="1.5" className="m-o" />
              <rect x="13.5" y="13" width="7" height="6" rx="1.5" className="m-f" />
              <path d="M8.5 6h3.5a2 2 0 0 1 2 2v5" className="m-o" />
            </svg>
          </div>
        </div>
      </div>
    </div>
  );
}
