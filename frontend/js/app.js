// MULAN POS — arranque, sesión, navegación y estructura de la aplicación.
import * as api from './api.js';
import { $, $$, esc, toast, modal, formData, errorMsg } from './ui.js';
import { kv } from './store.js';

const ICONS = {
  inicio: 'M3 11l9-8 9 8v10a1 1 0 0 1-1 1h-5v-7H9v7H4a1 1 0 0 1-1-1z',
  pos: 'M4 3h16v18l-3-2-3 2-2-2-2 2-3-2-3 2zM8 8h8M8 12h8M8 16h5',
  ventas: 'M4 4h16v16H4zM8 9h8M8 13h8M8 17h4',
  caja: 'M3 7h18v12H3zM3 11h18M7 15h3',
  inventario: 'M3 7l9-4 9 4v10l-9 4-9-4zM3 7l9 4 9-4M12 11v10',
  productos: 'M4 10h16l-1 10H5zM8 10V6a4 4 0 0 1 8 0v4',
  proveedores: 'M2 7h12v9H2zM14 10h4l3 3v3h-7M6 19a2 2 0 1 0 0-.1M17 19a2 2 0 1 0 0-.1',
  promociones: 'M3 12l9-9h9v9l-9 9zM16 8h.01',
  reportes: 'M4 20V10M10 20V4M16 20v-7M22 20H2',
  usuarios: 'M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM2 21v-1a6 6 0 0 1 12 0v1M17 11a3 3 0 1 0 0-6M22 21v-1a5 5 0 0 0-4-4.9',
  config: 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z',
  menu: 'M3 6h18M3 12h18M3 18h18'
};
export const icon = (n, s = 20) => `<svg width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${ICONS[n]}"/></svg>`;

const RUTAS = [
  { id: 'inicio', t: 'Inicio', roles: ['ADMIN', 'CAJERO'] },
  { id: 'pos', t: 'Vender', roles: ['ADMIN', 'CAJERO'] },
  { id: 'ventas', t: 'Ventas', roles: ['ADMIN', 'CAJERO'] },
  { id: 'caja', t: 'Caja', roles: ['ADMIN', 'CAJERO'] },
  { id: 'inventario', t: 'Inventario', roles: ['ADMIN', 'CAJERO'] },
  { sec: 'Administración', roles: ['ADMIN'] },
  { id: 'productos', t: 'Productos y recetas', roles: ['ADMIN'] },
  { id: 'proveedores', t: 'Proveedores', roles: ['ADMIN'] },
  { id: 'promociones', t: 'Promociones', roles: ['ADMIN'] },
  { id: 'reportes', t: 'Reportes', roles: ['ADMIN'] },
  { id: 'usuarios', t: 'Usuarios', roles: ['ADMIN'] },
  { id: 'config', t: 'Configuración', roles: ['ADMIN'] }
];

const app = {
  user: null,
  api,
  get esAdmin() { return this.user && this.user.rol === 'ADMIN'; },
  catalogo: (forzar) => api.catalogo(forzar),
  ir: (ruta) => { location.hash = '#/' + ruta; },
  titulo: (t) => { const h = $('#page-title'); if (h) h.textContent = t; document.title = t + ' · MULAN POS'; },
  limpiezas: []
};
window.MULAN = app; // útil para depurar

async function iniciar() {
  if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    navigator.serviceWorker.register('sw.js').catch((e) => console.warn('SW', e));
  }
  window.addEventListener('mulan:sesion-vencida', (e) => { toast(e.detail || 'Sesión vencida', 'error'); salir(true); });
  const guardado = await kv.get('usuario');
  if (api.getToken() && guardado) {
    app.user = guardado;
    try {
      app.user = await api.call('auth.yo');
      await kv.set('usuario', app.user);
    } catch (e) {
      if (!e.offline) { api.setToken(''); app.user = null; }
    }
  }
  if (!app.user) return mostrarLogin();
  montarLayout();
}

async function mostrarLogin() {
  const m = await import('./views/login.js');
  m.render($('#app'), {
    onLogin: async (s) => {
      api.setToken(s.token);
      app.user = s.usuario;
      await kv.set('usuario', s.usuario);
      montarLayout();
      api.catalogo(true).catch(() => {});
    }
  });
}

function montarLayout() {
  const u = app.user;
  $('#app').innerHTML = `
    <div class="layout">
      <nav class="nav" id="nav">
        <div class="nav-brand"><img src="assets/logo.png" alt=""><div><b>MULAN</b><small>PUNTO DE VENTA</small></div></div>
        ${RUTAS.filter((r) => r.roles.includes(u.rol)).map((r) => r.sec
          ? `<div class="nav-sec">${esc(r.sec)}</div>`
          : `<a href="#/${r.id}" data-r="${r.id}"><span class="ico">${icon(r.id)}</span>${esc(r.t)}</a>`).join('')}
        <div class="nav-foot">MULAN POS v1.0<br>${esc(u.nombre)} · ${u.rol === 'ADMIN' ? 'Administrador' : 'Cajero'}</div>
      </nav>
      <div class="main">
        <header class="topbar">
          <button class="icon-btn menu-btn" id="menu-btn" aria-label="Menú">${icon('menu')}</button>
          <h1 id="page-title">MULAN</h1>
          <button class="sync-pill" id="sync-pill" title="Estado de conexión">En línea</button>
          <button class="user-chip" id="user-chip"><span class="av">${esc(u.nombre.charAt(0).toUpperCase())}</span><span class="nm">${esc(u.nombre)}</span></button>
        </header>
        <main class="content" id="view"></main>
      </div>
    </div>`;
  $('#menu-btn').onclick = () => $('#nav').classList.toggle('open');
  $('#nav').addEventListener('click', (e) => { if (e.target === $('#nav') || e.target.closest('a')) $('#nav').classList.remove('open'); });
  $('#user-chip').onclick = menuUsuario;
  $('#sync-pill').onclick = panelSync;
  api.onEstado(pintarSync);
  api.refrescarContadores();
  api.sincronizar();
  window.onhashchange = navegar;
  navegar();
  if (u.debe_cambiar) setTimeout(() => cambiarClave(true), 300);
}

function pintarSync(st) {
  const p = $('#sync-pill');
  if (!p) return;
  p.className = 'sync-pill' + (!st.online ? ' off' : (st.pendientes || st.errores ? ' pend' : ''));
  let t = st.online ? 'En línea' : 'Sin conexión';
  if (st.pendientes) t += ` · ${st.pendientes} pendiente${st.pendientes > 1 ? 's' : ''}`;
  if (st.errores) t += ` · ${st.errores} con error`;
  p.textContent = t;
}

async function navegar() {
  const id = (location.hash.replace(/^#\/?/, '').split('?')[0]) || 'inicio';
  const ruta = RUTAS.find((r) => r.id === id && r.roles.includes(app.user.rol));
  if (!ruta) { app.ir('inicio'); return; }
  $$('#nav a').forEach((a) => a.classList.toggle('active', a.dataset.r === id));
  app.limpiezas.splice(0).forEach((fn) => { try { fn(); } catch (e) { /* noop */ } });
  app.titulo(ruta.t);
  const view = $('#view');
  view.innerHTML = '<div class="loading"><span class="spinner"></span>Cargando…</div>';
  try {
    const m = await import(`./views/${id}.js`);
    await m.render(view, app);
  } catch (e) {
    console.error(e);
    view.innerHTML = `<div class="alert">${esc(errorMsg(e))}</div><button class="btn" onclick="location.reload()">Reintentar</button>`;
  }
}

async function menuUsuario() {
  const v = await modal({
    title: app.user.nombre,
    body: `<p class="muted">Usuario: <b>${esc(app.user.usuario)}</b> · ${app.user.rol === 'ADMIN' ? 'Administrador' : 'Cajero'}</p>`,
    actions: [
      { label: 'Cambiar clave / PIN', cls: 'btn-ghost', value: 'clave' },
      { label: 'Cerrar sesión', cls: 'btn-danger', value: 'salir' }
    ]
  });
  if (v === 'clave') cambiarClave(false);
  if (v === 'salir') salir();
}

async function cambiarClave(obligatorio) {
  await modal({
    title: obligatorio ? 'Cree su clave personal' : 'Cambiar clave',
    dismissable: !obligatorio,
    body: `${obligatorio ? '<div class="alert alert-warn">Por seguridad, cambie la clave asignada antes de continuar.</div>' : ''}
      <form class="form" onsubmit="return false">
        <label>Clave actual<input type="password" name="actual" required autocomplete="current-password"></label>
        <label>Nueva clave (mínimo 6 caracteres)<input type="password" name="nueva" minlength="6" required autocomplete="new-password"></label>
        <label>Repita la nueva clave<input type="password" name="nueva2" minlength="6" required autocomplete="new-password"></label>
        ${app.esAdmin ? '<label>PIN de autorización (4 a 6 dígitos, opcional)<input name="pin" inputmode="numeric" pattern="\\d{4,6}" autocomplete="off"></label>' : ''}
      </form>`,
    actions: [{
      label: 'Guardar', cls: 'btn-primary', onClick: async (close, el) => {
        const f = formData($('form', el));
        if (f.nueva !== f.nueva2) { toast('Las claves no coinciden', 'error'); return false; }
        app.user = await api.call('auth.cambiarClave', { actual: f.actual, nueva: f.nueva, pin: f.pin || undefined });
        await kv.set('usuario', app.user);
        toast('Clave actualizada');
      }
    }]
  });
}

async function salir(vencida) {
  const pend = await import('./store.js').then((s) => s.cola.count());
  if (pend && !vencida) {
    toast(`Hay ${pend} operación(es) sin sincronizar. Conéctese a internet antes de cerrar sesión.`, 'error', 6000);
    return;
  }
  if (!vencida) { try { await api.call('auth.logout'); } catch (e) { /* sin red */ } }
  api.setToken('');
  await kv.del('usuario');
  app.user = null;
  window.onhashchange = null;
  location.hash = '';
  mostrarLogin();
}

async function panelSync() {
  const [pend, errs] = await Promise.all([api.listarPendientes(), api.listarErrores()]);
  const desc = (op) => op.action === 'venta.guardar'
    ? `Venta ${op.data.tipo === 'MESA' ? op.data.mesa : op.data.tipo} · ${op.data.pagos ? 'cobrada' : 'comanda'}`
    : `Movimiento de caja ${op.data.tipo} ${op.data.concepto || ''}`;
  await modal({
    title: 'Sincronización',
    wide: true,
    body: `<p>${api.estado.online ? 'Conectado al servidor.' : '<b>Sin conexión.</b> Las ventas se guardan en este dispositivo y se enviarán automáticamente al volver el internet.'}</p>
      <h3>Pendientes de enviar (${pend.length})</h3>
      ${pend.length ? `<ul>${pend.map((o) => `<li>${esc(desc(o))} · ${esc(new Date(o.creado).toLocaleString('es-CO'))}</li>`).join('')}</ul>` : '<p class="muted">Ninguna.</p>'}
      <h3>Con error (${errs.length})</h3>
      ${errs.length ? errs.map((o) => `<div class="alert"><b>${esc(desc(o))}</b><br>${esc(o.error)}<div class="toolbar" style="margin:.5rem 0 0"><button class="btn btn-sm" data-re="${esc(o.op_id)}">Reintentar</button><button class="btn btn-sm btn-danger" data-de="${esc(o.op_id)}">Descartar</button></div></div>`).join('') : '<p class="muted">Ninguna.</p>'}`,
    actions: [{ label: 'Sincronizar ahora', cls: 'btn-primary', onClick: async () => { await api.sincronizar(); toast(api.estado.pendientes ? 'Aún hay pendientes' : 'Sincronizado'); } }],
    onOpen: (el, close) => {
      $$('[data-re]', el).forEach((b) => { b.onclick = async () => { await api.reintentarError(errs.find((o) => o.op_id === b.dataset.re)); close(); panelSync(); }; });
      $$('[data-de]', el).forEach((b) => {
        b.onclick = async () => {
          if (!confirm('¿Descartar esta operación? No se registrará en el sistema.')) return;
          await api.descartarError(errs.find((o) => o.op_id === b.dataset.de)); close(); panelSync();
        };
      });
    }
  });
}

iniciar();
