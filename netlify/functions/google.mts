import type { Config } from "@netlify/functions";
import { clearCookie, googleEnv, googleSession, readCookie, seal, setCookie } from "../lib/gsession.js";

// Sign in with Google, for saving files to Google Drive.
//   GET  /api/google/config    whether Google sign-in is set up here
//   GET  /api/google/start     sends the browser to Google's sign-in page
//   GET  /api/google/callback  where Google sends it back: signs in, sets the session cookie, returns to the app
//   POST /api/google/token     a fresh access token for the signed-in person (401 when signed out)
//   POST /api/google/signout   revokes Google access and clears the cookie
// Needs GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET, and <site>/api/google/callback as an authorized
// redirect URI on the OAuth client (see README).

const SCOPE = "openid email profile https://www.googleapis.com/auth/drive.file";
const STATE = "lw_gstate";

const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "cache-control": "no-store", ...headers } });
const go = (to: string, cookies: string[] = []) => {
  const h = new Headers({ location: to, "cache-control": "no-store" });
  cookies.forEach(c => h.append("set-cookie", c));
  return new Response(null, { status: 302, headers: h });
};

type Tokens = { access_token?: string; expires_in?: number; refresh_token?: string; id_token?: string; error?: string };
async function tokenCall(params: Record<string, string>): Promise<Tokens> {
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(params),
  });
  return res.json().catch(() => ({ error: "bad_response" }));
}

// The id token comes straight from Google's token endpoint over TLS, so its claims can be read as is.
function claims(idToken = "") {
  try {
    const p = idToken.split(".")[1].replace(/-/g, "+").replace(/_/g, "/");
    return JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(p), c => c.charCodeAt(0))));
  } catch {
    return null;
  }
}

const userOf = (s: { sub: string; email?: string; name?: string; picture?: string }) =>
  ({ id: s.sub, email: s.email || "", name: s.name || "", picture: s.picture || "" });

export default async (req: Request) => {
  const url = new URL(req.url), action = url.pathname.split("/").pop();
  const { id, secret } = googleEnv();
  const redirectUri = url.origin + "/api/google/callback";

  if (action === "config") return json({ enabled: Boolean(id && secret) });
  if (!id || !secret) return action === "callback" || action === "start" ? go("/?google=not_configured") : json({ error: "not_configured" }, 503);

  if (action === "start") {
    // A random state, kept in a short-lived cookie, ties Google's reply to this browser.
    // A trailing ".consent" marks the second, consent-screen attempt.
    const consent = Boolean(url.searchParams.get("consent"));
    const state = Array.from(crypto.getRandomValues(new Uint8Array(16)), b => b.toString(16).padStart(2, "0")).join("") + (consent ? ".consent" : "");
    const q = new URLSearchParams({
      client_id: id, redirect_uri: redirectUri, response_type: "code", scope: SCOPE, state,
      access_type: "offline", include_granted_scopes: "true",
      prompt: consent ? "consent" : "select_account",
    });
    return go("https://accounts.google.com/o/oauth2/v2/auth?" + q, [`${STATE}=${state}; Path=/api/google; Max-Age=600; HttpOnly; Secure; SameSite=Lax`]);
  }

  if (action === "callback") {
    const done = (to: string, cookies: string[] = []) => go(to, [`${STATE}=; Path=/api/google; Max-Age=0; HttpOnly; Secure; SameSite=Lax`, ...cookies]);
    const state = url.searchParams.get("state"), code = url.searchParams.get("code");
    if (url.searchParams.get("error")) return done("/?google=cancelled");
    if (!state || !code || state !== readCookie(req, STATE)) return done("/?google=failed");
    const t = await tokenCall({ code, client_id: id, client_secret: secret, redirect_uri: redirectUri, grant_type: "authorization_code" });
    const c = claims(t.id_token);
    if (!t.access_token || !c || !c.sub || c.aud !== id) {
      console.log("Google sign-in failed", t.error);
      return done("/?google=failed");
    }
    // Google only sends a refresh token on first consent. Reuse this browser's earlier one for the same
    // person; otherwise ask once more, this time with the consent screen, which always sends one.
    const prev = await googleSession(req);
    const rt = t.refresh_token || (prev && prev.sub === c.sub ? prev.rt : "");
    if (!rt) return state.endsWith(".consent") ? done("/?google=failed") : go("/api/google/start?consent=1");
    return done("/?google=signed_in", [setCookie(await seal({ sub: c.sub, email: c.email, name: c.name, picture: c.picture, rt }))]);
  }

  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);
  // Only this site's pages may call these (the header can't be sent cross-site without a CORS preflight).
  const origin = req.headers.get("origin");
  if ((origin && origin !== url.origin) || req.headers.get("x-requested-with") !== "XmlHttpRequest") return json({ error: "forbidden" }, 403);

  const s = await googleSession(req);
  if (action === "token") {
    if (!s) return json({ error: "signed_out" }, 401);
    const t = await tokenCall({ refresh_token: s.rt, client_id: id, client_secret: secret, grant_type: "refresh_token" });
    if (!t.access_token) {
      // Revoked or expired at Google: end the session here too.
      return json({ error: "signed_out" }, 401, t.error === "invalid_grant" ? { "set-cookie": clearCookie() } : {});
    }
    return json({ accessToken: t.access_token, expiresIn: t.expires_in || 3600, user: userOf(s) });
  }
  if (action === "signout") {
    if (s) await fetch("https://oauth2.googleapis.com/revoke?token=" + encodeURIComponent(s.rt), { method: "POST" }).catch(() => {});
    return json({ ok: true }, 200, { "set-cookie": clearCookie() });
  }
  return json({ error: "not_found" }, 404);
};

export const config: Config = {
  path: ["/api/google/config", "/api/google/start", "/api/google/callback", "/api/google/token", "/api/google/signout"],
};
