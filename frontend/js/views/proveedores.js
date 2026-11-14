// Registro de proveedores.
import * as api from '../api.js';
import { $, esc, toast, modal, tabla, bindRows, badge, formData, validar } from '../ui.js';

export async function render(root, app) {
  const cat = await app.catalogo(true);
  const recargar = async () => { await api.invalidarCatalogo(); render(root, app); };
  const insumosDe = (id) => cat.insumos.filter((i) => i.proveedor_id === id).map((i) => i.nombre);
  const rows = [...cat.proveedores].sort((a, b) => (b.activo - a.activo) || a.nombre.localeCompare(b.nombre));
  root.innerHTML = `<div class="card"><div class="toolbar"><span class="grow"></span><button class="btn btn-primary" id="np">+ Proveedor</button></div><div id="lp"></div></div>`;
  $('#lp').innerHTML = tabla(rows, [
    { t: 'Proveedor', f: (p) => `<b>${esc(p.nombre)}</b>${p.nit ? `<div class="small muted">NIT ${esc(p.nit)}</div>` : ''}` },
    { t: 'Contacto', f: (p) => esc(p.contacto) },
    { t: 'Teléfono', f: (p) => (p.telefono ? `<a href="tel:${esc(p.telefono)}">${esc(p.telefono)}</a>` : '') },
    { t: 'Correo', k: 'email' },
    { t: 'Insumos', f: (p) => esc(insumosDe(p.id).join(', ')) },
    { t: 'Estado', f: (p) => (p.activo ? badge('Activo', 'ok') : badge('Inactivo')) }
  ], { onRow: true, vacio: 'Sin proveedores registrados' });
  $('.table', $('#lp'))?.classList.add('stack');
  bindRows($('#lp'), rows, (p) => editar(p, recargar));
  $('#np').onclick = () => editar(null, recargar);
}

async function editar(p, recargar) {
  const ok = await modal({
    title: p ? 'Editar proveedor' : 'Nuevo proveedor',
    body: `<form class="form" onsubmit="return false">
      <label>Nombre / razón social<input name="nombre" required value="${esc(p?.nombre || '')}"></label>
      <div class="row"><label>NIT / documento<input name="nit" value="${esc(p?.nit || '')}"></label><label>Persona de contacto<input name="contacto" value="${esc(p?.contacto || '')}"></label></div>
      <div class="row"><label>Teléfono<input name="telefono" inputmode="tel" value="${esc(p?.telefono || '')}"></label><label>Correo<input name="email" type="email" value="${esc(p?.email || '')}"></label></div>
      <label>Dirección<input name="direccion" value="${esc(p?.direccion || '')}"></label>
      ${p ? `<label class="check"><input type="checkbox" name="activo" ${p.activo ? 'checked' : ''}> Activo</label>` : ''}</form>`,
    actions: [{ label: 'Cancelar', cls: 'btn-ghost', value: false }, {
      label: 'Guardar', cls: 'btn-primary', onClick: async (c, el) => {
        const f = $('form', el);
        if (!validar(f)) return false;
        const d = { ...formData(f), id: p?.id };
        if (!p) d.activo = true;
        await api.call('proveedor.guardar', d);
      }
    }]
  });
  if (ok) { toast('Proveedor guardado'); recargar(); }
}
