// Promociones y descuentos automáticos por producto, categoría o toda la carta (por fechas y días de la semana).
import * as api from '../api.js';
import { $, $$, esc, money, toast, modal, tabla, bindRows, badge, formData, validar, opciones } from '../ui.js';

const DIAS = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'];

export async function render(root, app) {
  const cat = await app.catalogo(true);
  const recargar = async () => { await api.invalidarCatalogo(); render(root, app); };
  const ref = (p) => (p.alcance === 'TODO' ? 'Toda la carta' : p.alcance === 'CATEGORIA'
    ? 'Categoría: ' + (cat.categorias.find((c) => c.id === p.ref_id)?.nombre || '?')
    : 'Producto: ' + (cat.productos.find((c) => c.id === p.ref_id)?.nombre || '?'));
  root.innerHTML = `<div class="alert alert-info">Las promociones se aplican automáticamente en el POS. Si varias aplican a un producto, se usa la de mayor descuento. Los descuentos manuales del cajero se hacen desde el pedido.</div>
    <div class="card"><div class="toolbar"><span class="grow"></span><button class="btn btn-primary" id="np">+ Promoción</button></div><div id="lp"></div></div>`;
  const rows = cat.promociones;
  $('#lp').innerHTML = tabla(rows, [
    { t: 'Promoción', f: (p) => `<b>${esc(p.nombre)}</b>` },
    { t: 'Descuento', f: (p) => (p.tipo === 'PORCENTAJE' ? p.valor + ' %' : money(p.valor)) },
    { t: 'Aplica a', f: (p) => esc(ref(p)) },
    { t: 'Días', f: (p) => (p.dias ? String(p.dias).split(',').map((d) => DIAS[+d - 1]).join(', ') : 'Todos') },
    { t: 'Vigencia', f: (p) => esc((p.desde || '…') + ' → ' + (p.hasta || '…')) },
    { t: 'Estado', f: (p) => (p.activo ? badge('Activa', 'ok') : badge('Inactiva')) }
  ], { onRow: true, vacio: 'Sin promociones' });
  $('.table', $('#lp'))?.classList.add('stack');
  bindRows($('#lp'), rows, (p) => editar(p, cat, recargar));
  $('#np').onclick = () => editar(null, cat, recargar);
}

async function editar(p, cat, recargar) {
  const dias = String(p?.dias || '').split(',').filter(Boolean);
  const ok = await modal({
    title: p ? 'Editar promoción' : 'Nueva promoción',
    body: `<form class="form" onsubmit="return false">
      <label>Nombre<input name="nombre" required value="${esc(p?.nombre || '')}" placeholder="Ej: Martes de alitas"></label>
      <div class="row">
        <label>Tipo<select name="tipo"><option value="PORCENTAJE" ${p?.tipo === 'PORCENTAJE' ? 'selected' : ''}>Porcentaje %</option><option value="VALOR" ${p?.tipo === 'VALOR' ? 'selected' : ''}>Valor fijo $ por unidad</option></select></label>
        <label>Valor<input name="valor" type="number" min="0" step="any" required value="${p?.valor ?? ''}"></label>
      </div>
      <div class="row">
        <label>Aplica a<select name="alcance"><option value="PRODUCTO">Un producto</option><option value="CATEGORIA">Una categoría</option><option value="TODO">Toda la carta</option></select></label>
        <label id="ref-l">Seleccione<select name="ref_id"></select></label>
      </div>
      <div><span class="small"><b>Días</b> (ninguno = todos)</span><div class="billetes" style="margin-top:.3rem">${DIAS.map((d, i) => `<label class="check small"><input type="checkbox" data-dia="${i + 1}" ${dias.includes(String(i + 1)) ? 'checked' : ''}> ${d}</label>`).join('')}</div></div>
      <div class="row"><label>Desde<input name="desde" type="date" value="${esc(p?.desde || '')}"></label><label>Hasta<input name="hasta" type="date" value="${esc(p?.hasta || '')}"></label></div>
      <label class="check"><input type="checkbox" name="activo" ${!p || p.activo ? 'checked' : ''}> Activa</label></form>`,
    actions: [{ label: 'Cancelar', cls: 'btn-ghost', value: false }, {
      label: 'Guardar', cls: 'btn-primary', onClick: async (c, el) => {
        const f = $('form', el);
        if (!validar(f)) return false;
        const d = formData(f);
        d.dias = $$('[data-dia]', el).filter((x) => x.checked).map((x) => x.dataset.dia).join(',');
        d.id = p?.id;
        await api.call('promocion.guardar', d);
      }
    }],
    onOpen: (el) => {
      const f = $('form', el);
      f.alcance.value = p?.alcance || 'PRODUCTO';
      const refs = () => {
        const a = f.alcance.value;
        $('#ref-l', el).classList.toggle('hidden', a === 'TODO');
        f.ref_id.innerHTML = a === 'CATEGORIA' ? opciones(cat.categorias, p?.ref_id) : a === 'PRODUCTO' ? opciones(cat.productos.filter((x) => x.activo), p?.ref_id) : '';
      };
      f.alcance.onchange = refs;
      refs();
    }
  });
  if (ok) { toast('Promoción guardada'); recargar(); }
}
