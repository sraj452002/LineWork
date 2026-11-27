import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import postcss from '../frontend/node_modules/postcss/lib/postcss.js';

// The app's stylesheet has no mistakes the browser would drop: it parses, every declaration is one the browser
// accepts, and every selector is valid. (Safari-only -webkit-backdrop-filter and ::-webkit-details-marker, and
// @property descriptors, aside.)
test('styles.css parses and the browser accepts every declaration and selector', async ({ page }) => {
  const root = postcss.parse(readFileSync(new URL('../frontend/src/styles.css', import.meta.url), 'utf8'));
  const decls = [], sels = [];
  root.walkDecls(d => {
    if (d.prop.startsWith('--') || d.prop === '-webkit-backdrop-filter' || d.parent?.type === 'atrule' && d.parent.name === 'property') return;
    decls.push({ prop: d.prop, value: d.value, line: d.source.start.line });
  });
  root.walkRules(r => { if (!(r.parent?.type === 'atrule' && /keyframes/.test(r.parent.name))) sels.push({ sel: r.selector, line: r.source.start.line }); });
  expect(decls.length).toBeGreaterThan(10000);
  await page.setContent('<!doctype html><body></body>');
  const bad = await page.evaluate(({ decls, sels }) => {
    const out = [], seen = new Set();
    for (const d of decls) { const k = d.prop + ':' + d.value; if (!seen.has(k)) { seen.add(k); if (!CSS.supports(d.prop, d.value)) out.push(`line ${d.line}: ${d.prop}: ${d.value}`); } }
    // Each selector in a list, outside brackets.
    const parts = sel => { const r = []; let d = 0, cur = ''; for (const ch of sel) { if (ch === '(' || ch === '[') d++; if (ch === ')' || ch === ']') d--; if (ch === ',' && !d) { r.push(cur.trim()); cur = ''; } else cur += ch; } r.push(cur.trim()); return r.filter(Boolean); };
    for (const s of sels) for (const one of parts(s.sel)) if (!/::-webkit-details-marker$/.test(one) && !CSS.supports(`selector(${one})`)) out.push(`line ${s.line}: selector ${one}`);
    return out;
  }, { decls, sels });
  expect(bad).toEqual([]);
});
