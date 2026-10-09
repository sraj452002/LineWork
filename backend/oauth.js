import { createHash, randomBytes } from 'node:crypto';

/* "Continue with Google / GitHub": the OAuth 2 authorization-code flow, with PKCE and a state value
   kept in a short-lived cookie. Each provider gives back who the person is: a stable id, their email
   and whether the provider has verified it. URLs can be overridden (the tests use a stand-in). */

const DEFAULTS = {
  google: {
    name: 'Google',
    authUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
    tokenUrl: 'https://oauth2.googleapis.com/token',
    userUrl: 'https://openidconnect.googleapis.com/v1/userinfo',
    scope: 'openid email profile',
  },
  github: {
    name: 'GitHub',
    authUrl: 'https://github.com/login/oauth/authorize',
    tokenUrl: 'https://github.com/login/oauth/access_token',
    userUrl: 'https://api.github.com/user',
    scope: 'read:user user:email',
  },
};

// {google: {clientId, clientSecret, ...overrides}, github: {...}} → the providers that are set up.
export function providers(config = {}) {
  const out = {};
  for (const [k, d] of Object.entries(DEFAULTS)) {
    const c = config[k];
    if (c && c.clientId && c.clientSecret) out[k] = { ...d, ...c, id: k };
  }
  return out;
}

const b64url = b => b.toString('base64url');
export function start(p, redirectUri) {
  const state = b64url(randomBytes(24)), verifier = b64url(randomBytes(32));
  const challenge = b64url(createHash('sha256').update(verifier).digest());
  const url = new URL(p.authUrl);
  url.search = new URLSearchParams({
    client_id: p.clientId, redirect_uri: redirectUri, response_type: 'code', scope: p.scope, state,
    code_challenge: challenge, code_challenge_method: 'S256',
    ...(p.id === 'google' ? { prompt: 'select_account' } : { allow_signup: 'true' }),
  });
  return { url: url.toString(), state, verifier };
}

const getJson = async (url, init) => {
  const r = await fetch(url, init);
  const j = await r.json().catch(() => null);
  if (!r.ok || !j) throw new Error(`${new URL(url).host} answered ${r.status}`);
  return j;
};

// Swap the code for a token, then read the person's profile: {subject, email, verified, name}.
export async function finish(p, code, verifier, redirectUri) {
  const tok = await getJson(p.tokenUrl, {
    method: 'POST',
    headers: { accept: 'application/json', 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: p.clientId, client_secret: p.clientSecret, code, code_verifier: verifier, redirect_uri: redirectUri, grant_type: 'authorization_code' }),
  });
  if (!tok.access_token) throw new Error('no access token');
  const auth = { authorization: `Bearer ${tok.access_token}`, accept: 'application/json', 'user-agent': 'Workline' };
  const u = await getJson(p.userUrl, { headers: auth });
  if (p.id === 'github') {
    // The profile's email can be hidden or unverified; the emails list says which is primary and verified.
    let email = '', verified = false;
    try {
      const list = await getJson(p.userUrl.replace(/\/user$/, '/user/emails'), { headers: auth });
      const best = list.find(e => e.primary && e.verified) || list.find(e => e.verified);
      if (best) { email = best.email; verified = true; }
    } catch (e) { /* no email permission */ }
    return { subject: String(u.id), email: (email || '').toLowerCase(), verified, name: u.name || u.login || '' };
  }
  return { subject: String(u.sub), email: String(u.email || '').toLowerCase(), verified: u.email_verified === true, name: u.name || '' };
}
