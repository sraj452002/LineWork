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

const FOLDERS = 'linework:folders:v1';

export function loadFolders() {
  try {
    const a = JSON.parse(localStorage.getItem(FOLDERS) || '[]');
    return Array.isArray(a) ? a.filter(k => k && k.id && typeof k.name === 'string') : [];
  } catch (e) {
    return [];
  }
}

export function saveFolders(folders) {
  try { localStorage.setItem(FOLDERS, JSON.stringify(folders)); } catch (e) {}
}
