// Almacenamiento local (IndexedDB) para trabajar sin conexión: caché del catálogo, cola de operaciones y pedidos abiertos.
const DB_NAME = 'mulan-pos';
const DB_VER = 1;
let dbp = null;

function open() {
  if (dbp) return dbp;
  dbp = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VER);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('kv')) db.createObjectStore('kv');
      if (!db.objectStoreNames.contains('cola')) db.createObjectStore('cola', { keyPath: 'op_id' });
      if (!db.objectStoreNames.contains('errores')) db.createObjectStore('errores', { keyPath: 'op_id' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbp;
}

async function tx(store, mode, fn) {
  const db = await open();
  return new Promise((resolve, reject) => {
    const t = db.transaction(store, mode);
    const s = t.objectStore(store);
    let result;
    Promise.resolve(fn(s)).then((r) => { result = r; });
    t.oncomplete = () => resolve(result);
    t.onerror = () => reject(t.error);
  });
}

const reqP = (r) => new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });

export const kv = {
  get: (k) => tx('kv', 'readonly', (s) => reqP(s.get(k))),
  set: (k, v) => tx('kv', 'readwrite', (s) => { s.put(v, k); }),
  del: (k) => tx('kv', 'readwrite', (s) => { s.delete(k); })
};

export const cola = {
  add: (op) => tx('cola', 'readwrite', (s) => { s.put(op); }),
  all: async () => (await tx('cola', 'readonly', (s) => reqP(s.getAll()))).sort((a, b) => a.seq - b.seq),
  del: (id) => tx('cola', 'readwrite', (s) => { s.delete(id); }),
  count: () => tx('cola', 'readonly', (s) => reqP(s.count()))
};

export const errores = {
  add: (op) => tx('errores', 'readwrite', (s) => { s.put(op); }),
  all: () => tx('errores', 'readonly', (s) => reqP(s.getAll())),
  del: (id) => tx('errores', 'readwrite', (s) => { s.delete(id); }),
  count: () => tx('errores', 'readonly', (s) => reqP(s.count()))
};

export async function limpiarTodo() {
  await tx('kv', 'readwrite', (s) => { s.clear(); });
}
