import { useEffect, useState } from 'react';

/* The large icon sets (general icons, tech logos, cloud logos) live in icondata.js,
   which is split into its own chunk and loaded the first time it's needed.
   Their keys carry a prefix ("lu:activity", "si:docker") so they never clash with the built-in icons. */

let packs = null, loading = null;

function index(m) {
  const byKey = new Map();
  const add = it => { byKey.set(it.key, it); return it; };
  const general = m.GENERAL.map(([n, body, words]) => add({ key: 'lu:' + n, label: n, words: words || '', body, vb: 24, fill: false }));
  const logo = ([slug, title, hex, path]) => byKey.get('si:' + slug) || add({ key: 'si:' + slug, label: title, words: slug, body: `<path d="${path}"/>`, vb: 24, fill: true, hex: '#' + hex });
  return { byKey, general, tech: m.TECH.map(logo), cloud: m.CLOUD.map(logo) };
}

export function loadIconPacks() {
  return loading || (loading = import('./icondata.js').then(m => (packs = index(m)), e => { loading = null; throw e; }));
}

export const iconPacks = () => packs;
export const isPackIcon = v => typeof v === 'string' && v.includes(':');
export const packIcon = v => (packs && packs.byKey.get(v)) || null;

// Loads the packs once `need` is true, and re-renders when they arrive.
export function useIconPacks(need) {
  const [, setV] = useState(0);
  useEffect(() => {
    if (!need || packs) return;
    let live = true;
    loadIconPacks().then(() => { if (live) setV(v => v + 1); }, () => {});
    return () => { live = false; };
  }, [need]);
  return packs;
}
