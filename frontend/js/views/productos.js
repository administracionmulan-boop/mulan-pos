// Productos de venta con receta (costo de preparación y margen) y categorías.
import * as api from '../api.js';
import { $, $$, esc, money, num, pct, toast, modal, tabla, bindRows, badge, formData, validar, opciones } from '../ui.js';

let tab = 'productos';

export async function render(root, app) {
  const cat = await app.catalogo(true);
  root.innerHTML = `<div class="tabs" id="tabs"><button data-t="productos">Productos y recetas</button><button data-t="categorias">Categorías</button></div><div id="tab"></div>`;
  const recargar = async () => { await api.invalidarCatalogo(); render(root, app); };
  const pintar = () => {
    $$('#tabs button').forEach((b) => b.classList.toggle('active', b.dataset.t === tab));
    (tab === 'productos' ? productos : categorias)($('#tab'), cat, recargar);
  };
  $$('#tabs button').forEach((b) => { b.onclick = () => { tab = b.dataset.t; pintar(); }; });
  pintar();
}

const margenBadge = (m, costo) => (costo <= 0 ? badge('Sin receta', 'warn') : badge(pct(m), m >= 60 ? 'ok' : m >= 35 ? 'warn' : 'bad'));

function productos(el, cat, recargar) {
  const cats = Object.fromEntries(cat.categorias.map((c) => [c.id, c]));
  el.innerHTML = `<div class="card">
    <div class="toolbar">
      <input id="pq" placeholder="Buscar producto…" style="max-width:240px">
      <select id="pc"><option value="">Todas las categorías</option>${opciones(cat.categorias, '')}</select>
      <span class="grow"></span>
      <button class="btn btn-primary" id="np">+ Producto</button>
    </div>
    <div id="lp"></div></div>`;
  const pintar = () => {
    const q = $('#pq').value.toLowerCase(), c = $('#pc').value;
    const rows = cat.productos.filter((p) => (!q || p.nombre.toLowerCase().includes(q)) && (!c || p.categoria_id === c))
      .sort((a, b) => (b.activo - a.activo) || a.nombre.localeCompare(b.nombre));
    $('#lp').innerHTML = tabla(rows, [
      { t: 'Producto', f: (p) => `<b>${esc(p.nombre)}</b>${p.activo ? '' : ' ' + badge('inactivo')}` },
      { t: 'Categoría', f: (p) => esc(cats[p.categoria_id]?.nombre || '') },
      { t: 'Precio', cls: 'right', f: (p) => money(p.precio) },
      { t: 'Costo', cls: 'right', f: (p) => money(p.costo) },
      { t: 'Utilidad', cls: 'right', f: (p) => money(p.utilidad) },
      { t: 'Margen', f: (p) => margenBadge(p.margen, p.costo) },
      { t: 'Ingredientes', cls: 'right', f: (p) => p.receta.length }
    ], { onRow: true, vacio: 'Aún no hay productos. Cree el primero.' });
    $('.table', $('#lp'))?.classList.add('stack');
    bindRows($('#lp'), rows, (p) => editarProducto(p, cat, recargar));
  };
  $('#pq').oninput = pintar; $('#pc').onchange = pintar;
  $('#np').onclick = () => editarProducto(null, cat, recargar);
  pintar();
}

async function editarProducto(p, cat, recargar) {
  const ins = cat.insumos.filter((i) => i.activo || (p && p.receta.some((r) => r.insumo_id === i.id)));
  const insIdx = Object.fromEntries(cat.insumos.map((i) => [i.id, i]));
  const receta = p ? p.receta.map((r) => ({ insumo_id: r.insumo_id, cantidad: r.cantidad })) : [];
  if (!cat.categorias.length) { toast('Primero cree una categoría', 'error'); return; }
  const ok = await modal({
    title: p ? 'Editar producto' : 'Nuevo producto',
    wide: true,
    body: `<form class="form" onsubmit="return false">
      <div class="row">
        <label>Nombre<input name="nombre" required value="${esc(p?.nombre || '')}"></label>
        <label>Categoría<select name="categoria_id" required>${opciones(cat.categorias.filter((c) => c.activo || c.id === p?.categoria_id), p?.categoria_id)}</select></label>
        <label>Precio de venta (impuestos incluidos)<input name="precio" type="number" min="0" step="any" required value="${p?.precio ?? ''}"></label>
      </div>
      <label>Opciones rápidas para cocina (separadas por coma)<input name="modificadores" value="${esc(p?.modificadores || '')}" placeholder="Sin cebolla, Término medio, Extra salsa"></label>
      <label>Descripción<input name="descripcion" value="${esc(p?.descripcion || '')}"></label>
      ${p ? `<label class="check"><input type="checkbox" name="activo" ${p.activo ? 'checked' : ''}> Activo (visible en el POS)</label>` : ''}
      <h3 style="margin:.5rem 0 0">Receta · ingredientes por porción</h3>
      <p class="muted small" style="margin:0">Se descuentan del inventario automáticamente en cada venta. Para productos de reventa (ej. gaseosa) use 1 unidad del insumo.</p>
      <div class="receta-row muted small"><span>Insumo</span><span>Cantidad</span><span class="rc right">Costo</span><span></span></div>
      <div id="rec"></div>
      <button type="button" class="btn btn-sm" id="addr">+ Agregar ingrediente</button>
      <div class="grid grid-3" id="costeo"></div>
    </form>`,
    actions: [{ label: 'Cancelar', cls: 'btn-ghost', value: false }, {
      label: 'Guardar', cls: 'btn-primary', onClick: async (c, el) => {
        const f = $('form', el);
        if (!validar(f)) return false;
        const d = { ...formData(f), id: p?.id, receta: receta.filter((r) => r.insumo_id && Number(r.cantidad) > 0) };
        if (!p) d.activo = true;
        await api.call('producto.guardar', d);
      }
    }],
    onOpen: (el) => {
      const f = $('form', el);
      const costeo = () => {
        const costo = receta.reduce((a, r) => a + (Number(r.cantidad) || 0) * (insIdx[r.insumo_id]?.costo_unitario || 0), 0);
        const precio = Number(f.precio.value) || 0;
        const m = precio > 0 ? ((precio - costo) / precio) * 100 : 0;
        $('#costeo', el).innerHTML = `
          <div class="kpi"><div class="lbl">Costo de preparación</div><div class="val">${money(costo)}</div></div>
          <div class="kpi"><div class="lbl">Utilidad por plato</div><div class="val">${money(precio - costo)}</div></div>
          <div class="kpi red"><div class="lbl">Margen de ganancia</div><div class="val">${pct(m)}</div></div>`;
        receta.forEach((r, i) => {
          const s = $(`[data-cost="${i}"]`, el);
          if (s) s.textContent = money((Number(r.cantidad) || 0) * (insIdx[r.insumo_id]?.costo_unitario || 0));
        });
      };
      const pintar = () => {
        $('#rec', el).innerHTML = receta.map((r, i) => `<div class="receta-row" style="margin-bottom:.4rem">
          <select data-k="insumo_id" data-i="${i}" aria-label="Insumo">${opciones(ins.map((x) => ({ id: x.id, nombre: `${x.nombre} (${x.unidad})` })), r.insumo_id, { vacio: 'Seleccione…' })}</select>
          <input data-k="cantidad" data-i="${i}" type="number" step="any" min="0" value="${r.cantidad}" aria-label="Cantidad">
          <span class="rc right" data-cost="${i}"></span>
          <button type="button" class="icon-btn" data-rm="${i}" aria-label="Quitar">✕</button></div>`).join('') || '<p class="muted small">Sin ingredientes.</p>';
        $$('[data-k]', el).forEach((x) => { x.oninput = x.onchange = () => { receta[+x.dataset.i][x.dataset.k] = x.value; costeo(); }; });
        $$('[data-rm]', el).forEach((b) => { b.onclick = () => { receta.splice(+b.dataset.rm, 1); pintar(); }; });
        costeo();
      };
      $('#addr', el).onclick = () => {
        if (!ins.length) { toast('Primero cree insumos en Inventario', 'error'); return; }
        receta.push({ insumo_id: '', cantidad: '' }); pintar();
      };
      f.precio.oninput = costeo;
      pintar();
    }
  });
  if (ok) { toast('Producto guardado'); recargar(); }
}

function categorias(el, cat, recargar) {
  el.innerHTML = `<div class="card"><div class="toolbar"><span class="grow"></span><button class="btn btn-primary" id="nc">+ Categoría</button></div><div id="lc"></div></div>`;
  const cuenta = (id) => cat.productos.filter((p) => p.categoria_id === id).length;
  const rows = [...cat.categorias].sort((a, b) => a.orden - b.orden);
  $('#lc').innerHTML = tabla(rows, [
    { t: 'Orden', k: 'orden' },
    { t: 'Categoría', f: (c) => `<span style="display:inline-block;width:14px;height:14px;border-radius:4px;background:${esc(c.color)};vertical-align:middle"></span> <b>${esc(c.nombre)}</b>` },
    { t: 'Productos', f: (c) => cuenta(c.id) },
    { t: 'Estado', f: (c) => (c.activo ? badge('Activa', 'ok') : badge('Inactiva')) }
  ], { onRow: true });
  bindRows($('#lc'), rows, (c) => editarCategoria(c, recargar));
  $('#nc').onclick = () => editarCategoria(null, recargar);
}

async function editarCategoria(c, recargar) {
  const ok = await modal({
    title: c ? 'Editar categoría' : 'Nueva categoría',
    body: `<form class="form" onsubmit="return false">
      <label>Nombre<input name="nombre" required value="${esc(c?.nombre || '')}"></label>
      <div class="row"><label>Color<input name="color" type="color" value="${esc(c?.color || '#c62828')}"></label>
      <label>Orden en el POS<input name="orden" type="number" min="1" value="${c?.orden || ''}"></label></div>
      ${c ? `<label class="check"><input type="checkbox" name="activo" ${c.activo ? 'checked' : ''}> Activa</label>` : ''}</form>`,
    actions: [{ label: 'Cancelar', cls: 'btn-ghost', value: false }, {
      label: 'Guardar', cls: 'btn-primary', onClick: async (cl, el) => {
        const f = $('form', el);
        if (!validar(f)) return false;
        const d = { ...formData(f), id: c?.id };
        if (!c) d.activo = true;
        await api.call('categoria.guardar', d);
      }
    }]
  });
  if (ok) { toast('Categoría guardada'); recargar(); }
}
