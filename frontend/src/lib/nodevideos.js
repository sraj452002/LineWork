/* The node videos (frontend/public/guides/nodes/<type>.mp4, made by scripts/node-videos.mjs) and how
   long each is, from their index.json. Loaded once, when a guide first asks. */
let list = null;
export const nodeVideos = () => (list ||= fetch('/guides/nodes/index.json').then(r => (r.ok ? r.json() : {})).catch(() => ({})));
export const nodeVideoUrl = type => `/guides/nodes/${encodeURIComponent(type)}.mp4`;
