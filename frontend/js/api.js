// Cliente de la API (Apps Script) con soporte sin conexión: cola de operaciones idempotentes y sincronización.
import { kv, cola, errores } from './store.js';

const API_URL = (window.MULAN_CONFIG && window.MULAN_CONFIG.API_URL) || '/api';
const listeners = new Set();
let token = localStorage.getItem('mulan_token') || '';
let sincronizando = false;
let seq = Date.now();

export class OfflineError extends Error {
  constructor() { super('Sin conexión'); this.offline = true; }
}
export class ApiError extends Error {
  constructor(msg, code) { super(msg); this.code = code; }
}

export const estado = { online: navigator.onLine, pendientes: 0, errores: 0, ultimaSync: null };

export function onEstado(fn) { listeners.add(fn); return () => listeners.delete(fn); }
function emitir() { listeners.forEach((fn) => { try { fn(estado); } catch (e) { console.error(e); } }); }

export function setToken(t) {
  token = t || '';
  if (t) localStorage.setItem('mulan_token', t); else localStorage.removeItem('mulan_token');
}
export function getToken() { return token; }

export function uuid() {
  if (crypto.randomUUID) return crypto.randomUUID();
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
}

/** Llamada directa al servidor. Lanza OfflineError si no hay red y ApiError si el servidor rechaza. */
export async function call(action, data = {}) {
  if (!navigator.onLine) { marcarOnline(false); throw new OfflineError(); }
  let res;
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 45000);
    res = await fetch(API_URL, {
      method: 'POST',
      // text/plain evita la verificación CORS previa (requerido por Apps Script)
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ action, token, data }),
      redirect: 'follow',
      signal: ctrl.signal
    });
    clearTimeout(t);
  } catch (e) {
    marcarOnline(false);
    throw new OfflineError();
  }
  marcarOnline(true);
  let json;
  try { json = await res.json(); } catch (e) { throw new ApiError('Respuesta inválida del servidor (' + res.status + ')', res.status); }
  if (!json.ok) {
    if (json.code === 401 && action !== 'auth.login') window.dispatchEvent(new CustomEvent('mulan:sesion-vencida', { detail: json.error }));
    throw new ApiError(json.error || 'Error', json.code);
  }
  return json.data;
}

/**
 * Para operaciones sincronizables (venta.guardar, caja.movimiento): intenta en línea y, si no hay red,
 * la guarda en la cola local. Devuelve {data} o {encolada:true}.
 */
export async function callOrQueue(action, data) {
  // si ya hay pendientes, se encola para conservar el orden
  if ((await cola.count()) === 0) {
    try {
      return { data: await call(action, data) };
    } catch (e) {
      if (!e.offline) throw e;
    }
  }
  const op = { op_id: uuid(), seq: ++seq, action, data: { ...data, origen: 'OFFLINE' }, creado: new Date().toISOString() };
  await cola.add(op);
  await refrescarContadores();
  return { encolada: true, op };
}

function marcarOnline(v) {
  if (estado.online !== v) { estado.online = v; emitir(); if (v) setTimeout(sincronizar, 500); }
}

export async function refrescarContadores() {
  estado.pendientes = await cola.count();
  estado.errores = await errores.count();
  emitir();
}

/** Envía la cola al servidor en lotes, en orden. Las que fallan por negocio pasan a "errores" para revisión. */
export async function sincronizar() {
  if (sincronizando || !token) return;
  sincronizando = true;
  try {
    let ops = await cola.all();
    while (ops.length) {
      const lote = ops.slice(0, 15);
      const res = await call('sync', { ops: lote });
      for (const r of res) {
        const op = lote.find((o) => o.op_id === r.op_id);
        if (!r.ok) await errores.add({ ...op, error: r.error, fallo: new Date().toISOString() });
        await cola.del(r.op_id);
        window.dispatchEvent(new CustomEvent('mulan:sincronizada', { detail: { op, resultado: r } }));
      }
      ops = await cola.all();
    }
    estado.ultimaSync = new Date();
  } catch (e) {
    if (!e.offline) console.warn('Sincronización:', e.message);
  } finally {
    sincronizando = false;
    await refrescarContadores();
  }
}

/** Reintenta una operación con error (por ejemplo, tras abrir caja). */
export async function reintentarError(op) {
  await errores.del(op.op_id);
  const { error, fallo, ...limpia } = op;
  await cola.add({ ...limpia, seq: ++seq });
  await refrescarContadores();
  return sincronizar();
}
export async function descartarError(op) { await errores.del(op.op_id); await refrescarContadores(); }
export const listarErrores = () => errores.all();
export const listarPendientes = () => cola.all();

// --- caché de datos para modo sin conexión ---
export async function catalogo(forzar = false) {
  if (!forzar) {
    const c = await kv.get('catalogo');
    if (c && Date.now() - (c._t || 0) < 60000) return c;
  }
  try {
    const c = await call('catalogo.get');
    c._t = Date.now();
    await kv.set('catalogo', c);
    return c;
  } catch (e) {
    if (!e.offline) throw e;
    const c = await kv.get('catalogo');
    if (c) return c;
    throw new ApiError('No hay conexión y el catálogo no está guardado en este dispositivo. Conéctese al menos una vez.');
  }
}

export async function invalidarCatalogo() {
  const c = await kv.get('catalogo');
  if (c) { c._t = 0; await kv.set('catalogo', c); }
}

/** Ejecuta una lectura y guarda el resultado; sin red devuelve lo último guardado. */
export async function cacheado(clave, action, data) {
  try {
    const r = await call(action, data);
    await kv.set(clave, r);
    return r;
  } catch (e) {
    if (!e.offline) throw e;
    const r = await kv.get(clave);
    if (r !== undefined) return r;
    throw e;
  }
}

window.addEventListener('online', () => { estado.online = true; emitir(); sincronizar(); });
window.addEventListener('offline', () => { estado.online = false; emitir(); });
setInterval(() => { if (navigator.onLine) sincronizar(); }, 30000);
