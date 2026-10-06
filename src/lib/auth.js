// Hardcoded sign-in. Anyone who reads the built JavaScript can see these,
// so this keeps out casual visitors, not a determined one.
export const USERNAME = 'sraj452002@gmail.com';
export const PASSWORD = '@S7H7U6b6H6';

const KEY = 'linework:session';
const DAYS = 30;

export function checkCredentials(username, password) {
  return username.trim().toLowerCase() === USERNAME.toLowerCase() && password === PASSWORD;
}

export function signIn() {
  try { localStorage.setItem(KEY, JSON.stringify({ user: USERNAME, exp: Date.now() + DAYS * 864e5 })); } catch (e) {}
}

export function signOut() {
  try { localStorage.removeItem(KEY); } catch (e) {}
}

export function isSignedIn() {
  try {
    const s = JSON.parse(localStorage.getItem(KEY) || 'null');
    return !!s && s.user === USERNAME && s.exp > Date.now();
  } catch (e) {
    return false;
  }
}
