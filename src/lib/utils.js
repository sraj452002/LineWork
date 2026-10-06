export const esc = s => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
export const trunc = (s, n) => (s = String(s ?? '')).length > n ? s.slice(0, n - 1) + '…' : s;
export const rid = p => p + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
export const clone = o => JSON.parse(JSON.stringify(o));
export const slug = s => (s || 'untitled').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'untitled';
export const ago = t => {
  const s = (Date.now() - t) / 1000;
  if (s < 60) return 'Just now';
  if (s < 3600) return Math.floor(s / 60) + ' min ago';
  if (s < 86400) return Math.floor(s / 3600) + ' h ago';
  return new Date(t).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: (Date.now() - t) > 3e10 ? 'numeric' : undefined });
};
