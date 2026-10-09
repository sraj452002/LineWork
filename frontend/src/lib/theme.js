// Light, dark, or following the system. The choice is kept in this browser and applied as
// data-theme on <html>, which the stylesheet's tokens follow (no attribute = the system's choice).
const KEY = 'linework:theme';
export const THEMES = [['system', 'System'], ['light', 'Light'], ['dark', 'Dark']];

export function themePref() {
  try { const v = localStorage.getItem(KEY); return v === 'light' || v === 'dark' ? v : 'system'; } catch (e) { return 'system'; }
}
export function applyTheme(pref = themePref()) {
  const el = document.documentElement;
  if (pref === 'light' || pref === 'dark') el.dataset.theme = pref; else delete el.dataset.theme;
}
export function setTheme(pref) {
  try { if (pref === 'system') localStorage.removeItem(KEY); else localStorage.setItem(KEY, pref); } catch (e) {}
  applyTheme(pref);
}
