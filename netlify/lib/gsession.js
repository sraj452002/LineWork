// Google sign-in sessions, shared by netlify/functions/google.mts and the AI edge function.
// The session lives in an HttpOnly cookie, encrypted (AES-GCM) with a key derived from
// LINEWORK_SESSION_SECRET, or GOOGLE_CLIENT_SECRET when that isn't set. It holds the Google
// refresh token and who signed in; the browser only ever sees short-lived access tokens.
// Plain Web Crypto, so it runs in both Netlify Functions (Node) and Edge Functions (Deno).

export const COOKIE = "lw_google";
const MAX_AGE = 180 * 24 * 3600;

const env = name => (typeof Netlify !== "undefined" ? Netlify.env.get(name) : process.env[name]) || "";
export const googleEnv = () => ({ id: env("GOOGLE_CLIENT_ID"), secret: env("GOOGLE_CLIENT_SECRET") });

const b64 = bytes => btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const unb64 = s => Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/")), c => c.charCodeAt(0));

let keyP = null;
function key() {
  const secret = env("LINEWORK_SESSION_SECRET") || googleEnv().secret;
  if (!secret) return Promise.reject(new Error("no session secret"));
  if (!keyP) keyP = crypto.subtle.digest("SHA-256", new TextEncoder().encode("linework-google-session:" + secret))
    .then(raw => crypto.subtle.importKey("raw", raw, "AES-GCM", false, ["encrypt", "decrypt"]));
  return keyP;
}

export async function seal(data) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await key(), new TextEncoder().encode(JSON.stringify(data))));
  return b64(iv) + "." + b64(ct);
}

export async function unseal(value) {
  try {
    const [iv, ct] = String(value || "").split(".");
    if (!iv || !ct) return null;
    const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv: unb64(iv) }, await key(), unb64(ct));
    return JSON.parse(new TextDecoder().decode(pt));
  } catch (e) {
    return null;
  }
}

export function readCookie(req, name = COOKIE) {
  const m = (req.headers.get("cookie") || "").match(new RegExp("(?:^|;\\s*)" + name + "=([^;]+)"));
  return m ? m[1] : null;
}

export const setCookie = value => `${COOKIE}=${value}; Path=/api; Max-Age=${MAX_AGE}; HttpOnly; Secure; SameSite=Lax`;
export const clearCookie = () => `${COOKIE}=; Path=/api; Max-Age=0; HttpOnly; Secure; SameSite=Lax`;

// The signed-in Google user ({sub, email, name, picture, rt}), or null.
export async function googleSession(req) {
  const v = readCookie(req);
  if (!v) return null;
  const s = await unseal(v);
  return s && s.sub && s.rt ? s : null;
}
