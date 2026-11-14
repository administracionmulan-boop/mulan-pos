// Usuarios y permisos (Administrador / Cajero) y bitácora de auditoría.
import * as api from '../api.js';
import { $, esc, toast, modal, tabla, bindRows, badge, formData, validar, fechaCorta, errorMsg, loading } from '../ui.js';

export async function render(root, app) {
  root.innerHTML = `<div class="card"><div class="card-head"><h3>Usuarios</h3><button class="btn btn-primary" id="nu">+ Usuario</button></div>
    <div class="alert alert-info"><b>Administrador:</b> acceso total, autoriza anulaciones, devoluciones y descuentos altos con su PIN.
    <b>Cajero:</b> vende, maneja su caja y consulta inventario.</div><div id="lu"></div></div>
    <div class="card"><div class="card-head"><h3>Bitácora de auditoría</h3></div><div id="la"></div></div>`;
  const cargar = async () => {
    loading($('#lu'));
    try {
      const rows = await api.call('usuario.listar');
      if (!$('#lu')) return; // la vista cambió mientras se cargaba
      $('#lu').innerHTML = tabla(rows, [
        { t: 'Nombre', f: (u) => `<b>${esc(u.nombre)}</b>` },
        { t: 'Usuario', k: 'usuario' },
        { t: 'Rol', f: (u) => badge(u.rol === 'ADMIN' ? 'Administrador' : 'Cajero', u.rol === 'ADMIN' ? 'dark' : '') },
        { t: 'PIN', f: (u) => (u.rol === 'ADMIN' ? (u.tiene_pin ? badge('Configurado', 'ok') : badge('Sin PIN', 'warn')) : '—') },
        { t: 'Estado', f: (u) => (u.activo ? badge('Activo', 'ok') : badge('Inactivo', 'bad')) }
      ], { onRow: true });
      $('.table', $('#lu'))?.classList.add('stack');
      bindRows($('#lu'), rows, (u) => editar(u, cargar));
    } catch (e) { $('#lu').innerHTML = `<div class="alert">${esc(errorMsg(e))}</div>`; }
    try {
      const au = await api.call('auditoria.listar', {});
      if (!$('#la')) return; // la vista cambió mientras se cargaba
      $('#la').innerHTML = tabla(au.slice(0, 200), [
        { t: 'Fecha', f: (a) => esc(fechaCorta(a.fecha)) },
        { t: 'Usuario', k: 'usuario' },
        { t: 'Acción', f: (a) => badge(a.accion) },
        { t: 'Entidad', k: 'entidad' },
        { t: 'Detalle', f: (a) => `<span class="small">${esc(String(a.detalle).substring(0, 140))}</span>` }
      ]);
      $('.table', $('#la'))?.classList.add('stack');
    } catch (e) { $('#la').innerHTML = `<div class="alert">${esc(errorMsg(e))}</div>`; }
  };
  $('#nu').onclick = () => editar(null, cargar);
  cargar();
}

async function editar(u, cargar) {
  const ok = await modal({
    title: u ? 'Editar usuario' : 'Nuevo usuario',
    body: `<form class="form" onsubmit="return false" autocomplete="off">
      <label>Nombre completo<input name="nombre" required value="${esc(u?.nombre || '')}"></label>
      <div class="row">
        <label>Usuario (para ingresar)<input name="usuario" required ${u ? 'disabled' : ''} value="${esc(u?.usuario || '')}" autocapitalize="none"></label>
        <label>Rol<select name="rol"><option value="CAJERO" ${u?.rol === 'CAJERO' ? 'selected' : ''}>Cajero</option><option value="ADMIN" ${u?.rol === 'ADMIN' ? 'selected' : ''}>Administrador</option></select></label>
      </div>
      <div class="row">
        <label>${u ? 'Nueva clave (dejar vacío para no cambiar)' : 'Clave inicial'}<input name="password" type="password" minlength="6" ${u ? '' : 'required'} autocomplete="new-password"></label>
        <label>PIN de autorización (solo administradores)<input name="pin" inputmode="numeric" pattern="\\d{4,6}" autocomplete="off" placeholder="4 a 6 dígitos"></label>
      </div>
      ${u ? `<label class="check"><input type="checkbox" name="activo" ${u.activo ? 'checked' : ''}> Activo</label>` : ''}
      <p class="muted small">El usuario deberá cambiar la clave en su primer ingreso.</p></form>`,
    actions: [{ label: 'Cancelar', cls: 'btn-ghost', value: false }, {
      label: 'Guardar', cls: 'btn-primary', onClick: async (c, el) => {
        const f = $('form', el);
        if (!validar(f)) return false;
        const d = formData(f);
        if (u) { d.id = u.id; delete d.usuario; }
        if (!d.password) delete d.password;
        if (!d.pin) delete d.pin;
        await api.call('usuario.guardar', d);
      }
    }]
  });
  if (ok) { toast('Usuario guardado'); cargar(); }
}
