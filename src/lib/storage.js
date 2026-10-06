const KEY = 'linework:files:v2';

export function loadFiles() {
  try {
    const o = JSON.parse(localStorage.getItem(KEY) || '{}') || {};
    return Object.values(o).filter(f => f && f.id && Array.isArray(f.diagrams));
  } catch (e) {
    return [];
  }
}

export function saveFiles(files) {
  try {
    const o = {};
    files.forEach(f => { o[f.id] = f; });
    localStorage.setItem(KEY, JSON.stringify(o));
    return true;
  } catch (e) {
    return false;
  }
}
