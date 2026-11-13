import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync, existsSync, renameSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

/* Where the server keeps its data: named text blobs (JSON). Every backend has the same calls (open,
   read, write, remove, move), all by name; the store (store.js) decides the names. A name may have one
   folder in front ("ada@example.com/file.x.json"); open() returns every name.

   folderBackend    a local folder (DATA_DIR).
   memoryBackend    nothing saved: what the server keeps (workflows, credentials, runs) lasts until it
                    restarts. The default; files themselves stay in each person's browser. */

export function folderBackend(dir) {
  const path = name => join(dir, ...name.split('/'));
  return {
    describe: () => `the folder ${dir}`,
    async open() {
      mkdirSync(dir, { recursive: true });
      return readdirSync(dir, { withFileTypes: true }).flatMap(e => (e.isDirectory()
        ? readdirSync(join(dir, e.name)).filter(n => n.endsWith('.json')).map(n => `${e.name}/${n}`)
        : e.name.endsWith('.json') ? [e.name] : []));
    },
    async read(name) { return existsSync(path(name)) ? readFileSync(path(name), 'utf8') : null; },
    async write(name, text) { mkdirSync(dirname(path(name)), { recursive: true }); writeFileSync(path(name) + '.tmp', text); renameSync(path(name) + '.tmp', path(name)); },
    async remove(name) { rmSync(path(name), { force: true }); },
    async move(from, to) { if (!existsSync(path(from))) return; mkdirSync(dirname(path(to)), { recursive: true }); renameSync(path(from), path(to)); },
  };
}

export function memoryBackend(blobs = new Map()) {
  return {
    blobs,
    describe: () => 'memory (nothing is saved)',
    async open() { return [...blobs.keys()]; },
    async read(name) { return blobs.get(name) ?? null; },
    async write(name, text) { blobs.set(name, text); },
    async remove(name) { blobs.delete(name); },
    async move(from, to) { if (blobs.has(from)) { blobs.set(to, blobs.get(from)); blobs.delete(from); } },
  };
}

// The backend that the environment asks for: DATA_DIR (a folder), else memory.
export function backendFromEnv(env, root) {
  return env.DATA_DIR ? folderBackend(resolve(root, env.DATA_DIR)) : memoryBackend();
}
