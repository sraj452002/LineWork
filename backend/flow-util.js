import { FlowError, items } from './flow-engine.js';
import { checkHost } from './dbconnect.js';

/* Helpers the workflow nodes share (flow-nodes.js, flow-apps.js). */

export const each = async (args, fn) => {
  const out = [];
  for (let i = 0; i < args.items.length; i++) {
    const got = await fn(args.params(args.items[i], i), args.items[i], i);
    out.push(...items(got));
  }
  return { main: out };
};
export const need = (v, what) => { if (v === undefined || v === null || String(v).trim() === '') throw new FlowError(`Fill in ${what}.`, 'missing'); return v; };
export const cred = async (args) => {
  if (!args.node.credential) throw new FlowError('Pick a credential for this node.', 'no_credential');
  return args.ctx.cred(args.node.credential);
};

// A request to another service, refused for private and local addresses unless the server allows them.
export async function request(url, init = {}, { allowPrivate = false, timeout = 30_000 } = {}) {
  let u;
  try { u = new URL(url); } catch (e) { throw new FlowError(`“${url}” isn't a web address.`, 'bad_url'); }
  if (!/^https?:$/.test(u.protocol)) throw new FlowError('Only http:// and https:// addresses can be called.', 'bad_url');
  try { await checkHost(u.hostname, allowPrivate); } catch (e) { throw new FlowError(e.message, 'private_host'); }
  const res = await fetch(u, { ...init, redirect: 'follow', signal: AbortSignal.timeout(timeout) })
    .catch(e => { throw new FlowError(`Couldn't reach ${u.host}: ${e.cause?.code || e.message}`, 'network'); });
  const type = res.headers.get('content-type') || '';
  const text = await res.text();
  let body = text;
  if (/json/.test(type) || /^\s*[[{]/.test(text)) { try { body = JSON.parse(text); } catch (e) { /* keep the text */ } }
  return { status: res.status, ok: res.ok, headers: Object.fromEntries(res.headers), body };
}
export const failIfBad = (r, service) => {
  if (r.ok) return r.body;
  const why = typeof r.body === 'object' ? (r.body.message || r.body.description || r.body.error?.message || r.body.error || JSON.stringify(r.body).slice(0, 200)) : String(r.body).slice(0, 200);
  throw new FlowError(`${service} answered ${r.status}: ${why}`, 'service');
};
export const json = body => ({ method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
export const pairs = list => Object.fromEntries((Array.isArray(list) ? list : []).filter(p => p && p.name).map(p => [p.name, p.value ?? '']));

// A call to a service's API: JSON or form bodies, bearer or basic auth; private addresses as the server allows.
export function api(args, url, { method = 'GET', headers = {}, body, form, basic, bearer, timeout } = {}) {
  const h = { accept: 'application/json', ...headers };
  if (body !== undefined) h['content-type'] = 'application/json';
  if (form) h['content-type'] = 'application/x-www-form-urlencoded';
  if (basic) h.authorization = `Basic ${Buffer.from(basic).toString('base64')}`;
  if (bearer) h.authorization = `Bearer ${bearer}`;
  return request(url, { method, headers: h, body: form ? new URLSearchParams(form).toString() : body !== undefined ? JSON.stringify(body) : undefined }, { allowPrivate: args.ctx.allowPrivate, timeout });
}
// A param that may be JSON text or already an object (from an expression).
export function obj(v, what) {
  if (v && typeof v === 'object') return v;
  if (v === undefined || v === null || String(v).trim() === '') return {};
  try { return JSON.parse(String(v)); } catch (e) { throw new FlowError(`${what} must be JSON, e.g. {"name": "Ada"}.`, 'bad_param'); }
}

/* Files to attach to an email, from the node's Attachments setting: a file from a form's (file) field
   ({name, type, size, data} with data in base64), a list of them ({{ [$json.a, $json.b] }}), or a data: URL.
   Blank: none. → [{filename, contentType, base64}]. Up to 10 files and 20 MB together. */
export const ATTACH_MAX = 20 * 2 ** 20;
export function attachments(v) {
  if (v === undefined || v === null || v === '') return [];
  let list = Array.isArray(v) ? v : [v];
  if (typeof v === 'string') {
    const s = v.trim();
    if (s.startsWith('[') || s.startsWith('{')) { try { const j = JSON.parse(s); list = Array.isArray(j) ? j : [j]; } catch (e) { /* a data: URL, or wrong */ } }
  }
  const out = [];
  for (const f of list.filter(x => x !== null && x !== '' && x !== undefined)) {
    let file;
    if (typeof f === 'string') {
      const m = /^data:([^;,]*)(?:;[^,]*)?;base64,(.*)$/s.exec(f.trim());
      if (!m) throw new FlowError('Attachments takes a file from a form’s file field, like {{ $json.resume }} (or a list of them), not text or a link.', 'bad_param');
      file = { filename: `attachment-${out.length + 1}`, contentType: m[1] || 'application/octet-stream', base64: m[2] };
    } else if (f && typeof f === 'object' && typeof f.data === 'string') {
      file = { filename: String(f.name || `attachment-${out.length + 1}`).replace(/[\/\r\n]+/g, '_').slice(0, 200), contentType: String(f.type || 'application/octet-stream'), base64: f.data.replace(/^data:[^,]*,/, '') };
    } else throw new FlowError('Attachments takes a file from a form’s file field, like {{ $json.resume }} (or a list of them).', 'bad_param');
    if (!/^[A-Za-z0-9+/=\s]*$/.test(file.base64)) throw new FlowError(`“${file.filename}” isn’t a file Workline can attach.`, 'bad_param');
    out.push(file);
  }
  if (out.length > 10) throw new FlowError('At most 10 attachments per email.', 'bad_param');
  const bytes = out.reduce((n, f) => n + Math.floor(f.base64.replace(/\s/g, '').length * 3 / 4), 0);
  if (bytes > ATTACH_MAX) throw new FlowError(`The attachments come to ${(bytes / 2 ** 20).toFixed(1)} MB: at most 20 MB per email.`, 'too_large');
  return out;
}
