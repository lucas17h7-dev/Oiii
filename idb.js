const DB_NAME = 'cartoon-studio-2d';
const DB_VERSION = 1;

let dbPromise = null;

function openDb() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('projects')) {
        db.createObjectStore('projects', { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains('library')) {
        db.createObjectStore('library', { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains('meta')) {
        db.createObjectStore('meta', { keyPath: 'key' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

function reqToPromise(req) {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function idbPut(store, value) {
  const db = await openDb();
  const t = db.transaction([store], 'readwrite');
  const result = await reqToPromise(t.objectStore(store).put(value));
  await new Promise((resolve, reject) => {
    t.oncomplete = resolve;
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error || new Error('aborted'));
  });
  return result;
}

export async function idbGet(store, key) {
  const db = await openDb();
  const t = db.transaction([store], 'readonly');
  return reqToPromise(t.objectStore(store).get(key));
}

export async function idbDelete(store, key) {
  const db = await openDb();
  const t = db.transaction([store], 'readwrite');
  t.objectStore(store).delete(key);
  await new Promise((resolve, reject) => {
    t.oncomplete = resolve;
    t.onerror = () => reject(t.error);
  });
}

export async function idbGetAll(store) {
  const db = await openDb();
  const t = db.transaction([store], 'readonly');
  const result = await reqToPromise(t.objectStore(store).getAll());
  return result || [];
}

export function uid(prefix = 'id') {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}
