// Utilidades de interfaz: formato, notificaciones, ventanas modales y formularios.

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

export function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

const fmtCOP = new Intl.NumberFormat('es-CO', { maximumFractionDigits: 0 });
export const money = (n) => '$ ' + fmtCOP.format(Math.round(Number(n) || 0));
export const num = (n, d = 2) => new Intl.NumberFormat('es-CO', { maximumFractionDigits: d }).format(Number(n) || 0);
export const pct = (n) => num(n, 1) + ' %';

export function fechaCorta(f) {
  if (!f) return '';
  const [d, h] = String(f).split(' ');
  const [y, m, dd] = d.split('-');
  return `${dd}/${m}/${y}` + (h ? ' ' + h.substring(0, 5) : '');
}

export function toast(msg, tipo = 'ok', ms = 3500) {
  let cont = $('#toasts');
  if (!cont) { cont = document.createElement('div'); cont.id = 'toasts'; document.body.appendChild(cont); }
  const t = document.createElement('div');
  t.className = 'toast toast-' + tipo;
  t.setAttribute('role', 'status');
  t.textContent = msg;
  cont.appendChild(t);
  while (cont.children.length > 3) cont.firstChild.remove();
  setTimeout(() => { t.classList.add('out'); setTimeout(() => t.remove(), 300); }, ms);
}

export function errorMsg(e) {
  if (e && e.offline) return 'Sin conexión con el servidor. Intente de nuevo cuando vuelva el internet.';
  return (e && e.message) || String(e);
}

/**
 * Ventana modal. body: HTML. actions: [{label, cls, value, onClick(close, el) -> false para no cerrar}]
 * Devuelve una promesa con el value del botón (o null si se cierra).
 */
export function modal({ title, body, actions = [], wide = false, onOpen, dismissable = true }) {
  return new Promise((resolve) => {
    const wrap = document.createElement('div');
    wrap.className = 'modal-wrap';
    wrap.innerHTML = `
      <div class="modal ${wide ? 'modal-wide' : ''}" role="dialog" aria-modal="true" aria-label="${esc(title)}">
        <div class="modal-head"><h3>${esc(title)}</h3>${dismissable ? '<button class="icon-btn" data-x aria-label="Cerrar">✕</button>' : ''}</div>
        <div class="modal-body">${body || ''}</div>
        ${actions.length ? `<div class="modal-foot">${actions.map((a, i) => `<button class="btn ${a.cls || ''}" data-i="${i}" type="button">${esc(a.label)}</button>`).join('')}</div>` : ''}
      </div>`;
    document.body.appendChild(wrap);
    let cerrado = false;
    const close = (v = null) => {
      if (cerrado) return;
      cerrado = true;
      wrap.remove();
      document.removeEventListener('keydown', onKey);
      resolve(v);
    };
    const onKey = (e) => { if (e.key === 'Escape' && dismissable) close(null); };
    document.addEventListener('keydown', onKey);
    if (dismissable) {
      wrap.addEventListener('mousedown', (e) => { if (e.target === wrap) close(null); });
      $('[data-x]', wrap).onclick = () => close(null);
    }
    $$('[data-i]', wrap).forEach((b) => {
      b.onclick = async () => {
        const a = actions[+b.dataset.i];
        if (a.onClick) {
          b.disabled = true;
          try {
            const r = await a.onClick(close, wrap);
            if (r === false) { b.disabled = false; return; }
          } catch (e) {
            b.disabled = false;
            toast(errorMsg(e), 'error');
            return;
          }
        }
        close(a.value !== undefined ? a.value : true);
      };
    });
    const first = $('input:not([type=hidden]),select,textarea', wrap);
    if (first) setTimeout(() => { if (!wrap.contains(document.activeElement)) first.focus(); }, 30);
    if (onOpen) onOpen(wrap, close);
  });
}

export function confirmar(msg, { titulo = 'Confirmar', ok = 'Aceptar', peligro = false } = {}) {
  return modal({
    title: titulo, body: `<p>${esc(msg)}</p>`,
    actions: [{ label: 'Cancelar', cls: 'btn-ghost', value: false }, { label: ok, cls: peligro ? 'btn-danger' : 'btn-primary', value: true }]
  }).then((v) => v === true);
}

/** Pide usuario y PIN de un administrador (operaciones sensibles). Devuelve {usuario,pin} o null. */
export function pedirAutorizacion(motivo) {
  let datos = null;
  return modal({
    title: 'Autorización de administrador',
    body: `<p class="muted">${esc(motivo || 'Esta operación requiere autorización.')}</p>
      <form class="form" onsubmit="return false">
        <label>Usuario administrador<input name="usuario" autocomplete="off" required></label>
        <label>PIN<input name="pin" type="password" inputmode="numeric" autocomplete="off" required></label>
      </form>`,
    actions: [
      { label: 'Cancelar', cls: 'btn-ghost', value: false },
      {
        label: 'Autorizar', cls: 'btn-primary', onClick: (close, el) => {
          const f = formData($('form', el));
          if (!f.usuario || !f.pin) { toast('Ingrese usuario y PIN', 'error'); return false; }
          datos = f;
        }
      }
    ]
  }).then((v) => (v === true ? datos : null));
}

export function formData(form) {
  const o = {};
  new FormData(form).forEach((v, k) => { o[k] = typeof v === 'string' ? v.trim() : v; });
  $$('input[type=checkbox]', form).forEach((c) => { if (c.name) o[c.name] = c.checked; });
  return o;
}

export function validar(form) {
  if (!form.checkValidity()) { form.reportValidity(); return false; }
  return true;
}

export function opciones(lista, valor, { vacio, val = 'id', txt = 'nombre' } = {}) {
  return (vacio !== undefined ? `<option value="">${esc(vacio)}</option>` : '') +
    lista.map((o) => `<option value="${esc(o[val])}" ${String(o[val]) === String(valor ?? '') ? 'selected' : ''}>${esc(o[txt])}</option>`).join('');
}

/** Tabla simple. cols: [{t: título, k: clave | f: fn(row) -> html, cls}] */
export function tabla(rows, cols, { vacio = 'Sin registros', onRow } = {}) {
  if (!rows.length) return `<div class="empty">${esc(vacio)}</div>`;
  return `<div class="table-wrap"><table class="table">
    <thead><tr>${cols.map((c) => `<th class="${c.cls || ''}">${esc(c.t)}</th>`).join('')}</tr></thead>
    <tbody>${rows.map((r, i) => `<tr ${onRow ? `data-row="${i}" class="clickable"` : ''}>${cols.map((c) => `<td class="${c.cls || ''}" data-label="${esc(c.t)}">${c.f ? c.f(r) : esc(r[c.k])}</td>`).join('')}</tr>`).join('')}</tbody>
  </table></div>`;
}

export function bindRows(root, rows, fn) {
  $$('tr[data-row]', root).forEach((tr) => { tr.onclick = (e) => { if (!e.target.closest('button,a,input')) fn(rows[+tr.dataset.row]); }; });
}

export function badge(txt, tipo = '') { return `<span class="badge ${tipo ? 'badge-' + tipo : ''}">${esc(txt)}</span>`; }

export function loading(el, msg = 'Cargando…') { el.innerHTML = `<div class="loading"><span class="spinner"></span>${esc(msg)}</div>`; }

export function debounce(fn, ms = 250) {
  let t;
  return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
}

export function rangoPreset(preset) {
  const hoy = new Date();
  const p = (n) => String(n).padStart(2, '0');
  const ymd = (d) => `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
  if (preset === 'hoy') return { desde: ymd(hoy), hasta: ymd(hoy), agrupar: 'dia' };
  if (preset === 'semana') {
    const l = new Date(hoy); l.setDate(hoy.getDate() - ((hoy.getDay() + 6) % 7));
    const d = new Date(l); d.setDate(l.getDate() + 6);
    return { desde: ymd(l), hasta: ymd(d), agrupar: 'dia' };
  }
  if (preset === 'mes') {
    return { desde: ymd(new Date(hoy.getFullYear(), hoy.getMonth(), 1)), hasta: ymd(new Date(hoy.getFullYear(), hoy.getMonth() + 1, 0)), agrupar: 'dia' };
  }
  if (preset === 'anio') return { desde: `${hoy.getFullYear()}-01-01`, hasta: `${hoy.getFullYear()}-12-31`, agrupar: 'mes' };
  return { desde: ymd(hoy), hasta: ymd(hoy), agrupar: 'dia' };
}
