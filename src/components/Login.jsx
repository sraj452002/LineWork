import { useState } from 'react';
import { checkCredentials } from '../lib/auth.js';
import { Brand } from './ui.jsx';

export default function Login({ onSignedIn }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = e => {
    e.preventDefault();
    setBusy(true);
    // A short pause makes repeated guessing slower.
    setTimeout(() => {
      if (checkCredentials(username, password)) onSignedIn();
      else { setError('That username and password don’t match. Try again.'); setPassword(''); }
      setBusy(false);
    }, 450);
  };

  return (
    <main className="login">
      <form onSubmit={submit} noValidate>
        <Brand />
        <h1>Sign in</h1>
        <p>This workspace is private.</p>
        {error && <p className="err" role="alert">{error}</p>}
        <label htmlFor="u">Username</label>
        <input id="u" value={username} onChange={e => setUsername(e.target.value)} autoComplete="username" autoCapitalize="none" spellCheck="false" autoFocus required />
        <label htmlFor="p">Password</label>
        <input id="p" type="password" value={password} onChange={e => setPassword(e.target.value)} autoComplete="current-password" required />
        <button type="submit" disabled={busy}>{busy ? 'Signing in' : 'Sign in'}</button>
      </form>
    </main>
  );
}
