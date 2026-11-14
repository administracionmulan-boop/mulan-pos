// Inventario de insumos: existencias y alertas, compras (entradas), ajustes/desperdicios y kardex.
import * as api from '../api.js';
import { $, $$, esc, money, num, toast, modal, tabla, bindRows, badge, fechaCorta, errorMsg, formData, validar, loading, opciones } from '../ui.js';

const TIPOS_AJ = { DESPERDICIO: 'Desperdicio (salida)', DANO: 'Daño / vencimiento (salida)', AJUSTE_SALIDA: 'Ajuste de salida', AJUSTE_ENTRADA: 'Ajuste de entrada', CONTEO: 'Conteo físico (fija el stock)' };
const TIPO_MOV = { COMPRA: 'ok', VENTA: 'dark', INICIAL: 'ok', AJUSTE_ENTRADA: 'ok', DEVOLUCION: 'ok', ANULACION: 'ok', DESPERDICIO: 'bad', DANO: 'bad', AJUSTE_SALIDA: 'bad', CONTEO: 'warn' };

let tab = 'existencias';

export async function render(root, app) {
  const cat = await app.catalogo(true);
  root.innerHTML = `
    <div class="tabs" id="tabs">
      <button data-t="existencias">Existencias</button>
      ${app.esAdmin ? '<button data-t="compras">Compras</button>' : ''}
      <button data-t="movimientos">Movimientos</button>
    </div>
    <div id="tab"></div>`;
  const pintar = () => {
    $$('#tabs button').forEach((b) => b.classList.toggle('active', b.dataset.t === tab));
    ({ existencias, compras, movimientos })[tab]($('#tab'), app, cat, async () => { const c = await app.catalogo(true); render(root, app, c); });
  };
  $$('#tabs button').forEach((b) => { b.onclick = () => { tab = b.dataset.t; pintar(); }; });
  if (tab === 'compras' && !app.esAdmin) tab = 'existencias';
  pintar();
}

function existencias(el, app, cat, recargar) {
  const ins = cat.insumos.filter((i) => i.activo);
  const provs = Object.fromEntries(cat.proveedores.map((p) => [p.id, p.nombre]));
  const alertas = ins.filter((i) => i.alerta);
  const valor = ins.reduce((a, i) => a + Math.max(0, i.stock) * i.costo_unitario, 0);
  el.innerHTML = `
    ${alertas.length ? `<div class="alert"><b>${alertas.length} insumo(s) en alerta:</b> ${alertas.map((a) => esc(a.nombre) + (a.alerta === 'AGOTADO' ? ' (agotado)' : '')).join(', ')}</div>` : ''}
    <div class="grid grid-3" style="margin-bottom:1rem">
      <div class="kpi"><div class="lbl">Insumos activos</div><div class="val">${ins.length}</div></div>
      <div class="kpi red"><div class="lbl">En alerta</div><div class="val">${alertas.length}</div></div>
      <div class="kpi"><div class="lbl">Valor del inventario</div><div class="val">${money(valor)}</div></div>
    </div>
    <div class="card">
      <div class="toolbar">
        <input id="iq" placeholder="Buscar insumo…" class="grow" style="max-width:260px">
        <label class="check small"><input type="checkbox" id="solo-alertas"> Solo alertas</label>
        <span class="grow"></span>
        ${app.esAdmin ? `<button class="btn" id="b-ajuste">Ajuste / desperdicio</button><button class="btn btn-dark" id="b-compra">Registrar compra</button><button class="btn btn-primary" id="b-nuevo">+ Insumo</button>` : ''}
      </div>
      <div id="tabla-ins"></div>
    </div>`;
  const pintarTabla = () => {
    const q = $('#iq').value.toLowerCase();
    const solo = $('#solo-alertas').checked;
    const rows = cat.insumos.filter((i) => (app.esAdmin || i.activo) && (!q || i.nombre.toLowerCase().includes(q)) && (!solo || i.alerta))
      .sort((a, b) => (b.alerta ? 1 : 0) - (a.alerta ? 1 : 0) || a.nombre.localeCompare(b.nombre));
    $('#tabla-ins').innerHTML = tabla(rows, [
      { t: 'Insumo', f: (i) => `<b>${esc(i.nombre)}</b>${i.activo ? '' : ' ' + badge('inactivo')}` },
      { t: 'Stock', cls: 'right', f: (i) => `<b class="${i.alerta ? 'text-bad' : ''}">${num(i.stock)}</b> ${esc(i.unidad)}` },
      { t: 'Mínimo', cls: 'right', f: (i) => `${num(i.stock_minimo)} ${esc(i.unidad)}` },
      { t: 'Estado', f: (i) => (i.alerta === 'AGOTADO' ? badge('Agotado', 'bad') : i.alerta === 'BAJO' ? badge('Bajo', 'warn') : badge('OK', 'ok')) },
      { t: 'Costo unit.', cls: 'right', f: (i) => money(i.costo_unitario) + (i.costo_unitario < 10 ? `<span class="small muted">${String(i.costo_unitario).includes('.') ? ' (' + num(i.costo_unitario, 4) + ')' : ''}</span>` : '') },
      { t: 'Valor', cls: 'right', f: (i) => money(Math.max(0, i.stock) * i.costo_unitario) },
      { t: 'Proveedor', f: (i) => esc(provs[i.proveedor_id] || '') }
    ], { onRow: true, vacio: 'No hay insumos. Cree el primero con “+ Insumo”.' });
    $('.table', $('#tabla-ins'))?.classList.add('stack');
    bindRows($('#tabla-ins'), rows, (i) => fichaInsumo(i, app, cat, recargar));
  };
  $('#iq').oninput = pintarTabla;
  $('#solo-alertas').onchange = pintarTabla;
  pintarTabla();
  if (app.esAdmin) {
    $('#b-nuevo').onclick = () => editarInsumo(null, cat, recargar);
    $('#b-compra').onclick = () => nuevaCompra(cat, recargar);
    $('#b-ajuste').onclick = () => ajuste(null, cat, recargar);
  }
}

export async function editarInsumo(i, cat, recargar) {
  let datos;
  const ok = await modal({
    title: i ? 'Editar insumo' : 'Nuevo insumo',
    body: `<form class="form" onsubmit="return false">
      <label>Nombre<input name="nombre" required value="${esc(i?.nombre || '')}" placeholder="Ej: Pechuga de pollo"></label>
      <div class="row">
        <label>Unidad de medida<select name="unidad">${cat.unidades.map((u) => `<option ${i?.unidad === u ? 'selected' : ''}>${u}</option>`).join('')}</select></label>
        <label>Stock mínimo (alerta)<input name="stock_minimo" type="number" step="any" min="0" value="${i?.stock_minimo ?? 0}"></label>
      </div>
      <div class="row">
        <label>Costo por unidad<input name="costo_unitario" type="number" step="any" min="0" value="${i?.costo_unitario ?? 0}"></label>
        ${i ? '' : '<label>Stock inicial<input name="stock_inicial" type="number" step="any" min="0" value="0"></label>'}
      </div>
      <label>Proveedor habitual<select name="proveedor_id">${opciones(cat.proveedores.filter((p) => p.activo), i?.proveedor_id, { vacio: '— Ninguno —' })}</select></label>
      ${i ? `<label class="check"><input type="checkbox" name="activo" ${i.activo ? 'checked' : ''}> Activo</label><p class="muted small">El stock se modifica con compras y ajustes para conservar la trazabilidad.</p>` : ''}
    </form>`,
    actions: [{ label: 'Cancelar', cls: 'btn-ghost', value: false }, {
      label: 'Guardar', cls: 'btn-primary', onClick: async (c, el) => {
        const f = $('form', el);
        if (!validar(f)) return false;
        datos = { ...formData(f), id: i?.id };
        if (!i) datos.activo = true;
        await api.call('insumo.guardar', datos);
      }
    }]
  });
  if (ok) { toast('Insumo guardado'); recargar(); }
}

async function fichaInsumo(i, app, cat, recargar) {
  let movs = [];
  try { movs = await api.call('inventario.kardex', { insumo_id: i.id, limite: 100 }); } catch (e) { toast(errorMsg(e), 'error'); }
  const acts = app.esAdmin ? [
    { label: 'Editar', cls: 'btn-ghost', value: 'editar' },
    { label: 'Ajuste', cls: 'btn', value: 'ajuste' },
    { label: 'Compra', cls: 'btn-dark', value: 'compra' }
  ] : [];
  const r = await modal({
    title: i.nombre,
    wide: true,
    body: `<div class="grid grid-3" style="margin-bottom:1rem">
        <div class="kpi"><div class="lbl">Stock</div><div class="val">${num(i.stock)} ${esc(i.unidad)}</div></div>
        <div class="kpi"><div class="lbl">Mínimo</div><div class="val">${num(i.stock_minimo)} ${esc(i.unidad)}</div></div>
        <div class="kpi red"><div class="lbl">Costo promedio</div><div class="val">${money(i.costo_unitario)}</div><div class="sub muted">${num(i.costo_unitario, 4)} por ${esc(i.unidad)}</div></div>
      </div>
      <h3>Kardex (últimos movimientos)</h3>
      ${tablaMovs(movs)}`,
    actions: acts
  });
  if (r === 'editar') editarInsumo(i, cat, recargar);
  if (r === 'ajuste') ajuste(i, cat, recargar);
  if (r === 'compra') nuevaCompra(cat, recargar, i);
}

function tablaMovs(movs, conInsumo) {
  return tabla(movs, [
    { t: 'Fecha', f: (m) => esc(fechaCorta(m.fecha)) },
    ...(conInsumo ? [{ t: 'Insumo', k: 'insumo' }] : []),
    { t: 'Tipo', f: (m) => badge(m.tipo, TIPO_MOV[m.tipo]) },
    { t: 'Cantidad', cls: 'right', f: (m) => `<b class="${m.cantidad < 0 ? 'text-bad' : 'text-ok'}">${m.cantidad > 0 ? '+' : ''}${num(m.cantidad)}</b> ${esc(m.unidad)}` },
    { t: 'Saldo', cls: 'right', f: (m) => num(m.stock_resultante) },
    { t: 'Detalle', f: (m) => esc(m.nota) },
    { t: 'Usuario', k: 'usuario' }
  ], { vacio: 'Sin movimientos' });
}

async function ajuste(ins, cat, recargar) {
  const activos = cat.insumos.filter((i) => i.activo);
  const ok = await modal({
    title: 'Ajuste de inventario',
    body: `<form class="form" onsubmit="return false">
      <label>Insumo<select name="insumo_id" required>${opciones(activos, ins?.id, { vacio: 'Seleccione…' })}</select></label>
      <div class="row">
        <label>Tipo<select name="tipo">${Object.keys(TIPOS_AJ).map((k) => `<option value="${k}">${TIPOS_AJ[k]}</option>`).join('')}</select></label>
        <label><span id="lbl-cant">Cantidad</span><input name="cantidad" type="number" step="any" min="0" required></label>
      </div>
      <p class="muted small" id="aj-info"></p>
      <label>Motivo / observación<input name="nota" placeholder="Obligatorio para salidas"></label>
    </form>`,
    actions: [{ label: 'Cancelar', cls: 'btn-ghost', value: false }, {
      label: 'Registrar ajuste', cls: 'btn-primary', onClick: async (c, el) => {
        const f = $('form', el);
        if (!validar(f)) return false;
        await api.call('inventario.ajuste', formData(f));
      }
    }],
    onOpen: (el) => {
      const f = $('form', el);
      const info = () => {
        const i = activos.find((x) => x.id === f.insumo_id.value);
        $('#aj-info', el).textContent = i ? `Stock actual: ${num(i.stock)} ${i.unidad}` : '';
        $('#lbl-cant', el).textContent = f.tipo.value === 'CONTEO' ? 'Cantidad contada (stock real)' : 'Cantidad';
      };
      f.insumo_id.onchange = info; f.tipo.onchange = info; info();
    }
  });
  if (ok) { toast('Ajuste registrado'); recargar(); }
}

async function nuevaCompra(cat, recargar, insInicial) {
  const activos = cat.insumos.filter((i) => i.activo);
  const filas = insInicial ? [{ insumo_id: insInicial.id, cantidad: '', costo_unitario: insInicial.costo_unitario, modo: 'unit' }] : [{ insumo_id: '', cantidad: '', costo_unitario: '', modo: 'unit' }];
  const ok = await modal({
    title: 'Registrar compra de insumos',
    wide: true,
    body: `<form class="form" onsubmit="return false">
      <div class="row">
        <label>Proveedor<select name="proveedor_id">${opciones(cat.proveedores.filter((p) => p.activo), '', { vacio: '— Sin proveedor —' })}</select></label>
        <label>N.º factura<input name="factura"></label>
      </div>
      <div class="receta-row muted small" style="grid-template-columns:1fr 110px 130px 36px"><span>Insumo</span><span>Cantidad</span><span>Valor total línea</span><span></span></div>
      <div id="lineas"></div>
      <button type="button" class="btn btn-sm" id="add">+ Agregar insumo</button>
      <div class="t-row" style="font-size:1.2rem"><b>Total compra</b><b id="tot">$ 0</b></div>
      <label class="check"><input type="checkbox" name="pagado_caja"> Pagada con efectivo de mi caja abierta (se registra como egreso)</label>
      <label>Observaciones<input name="nota"></label>
    </form>`,
    actions: [{ label: 'Cancelar', cls: 'btn-ghost', value: false }, {
      label: 'Registrar compra', cls: 'btn-primary', onClick: async (c, el) => {
        const f = formData($('form', el));
        const items = filas.filter((x) => x.insumo_id && Number(x.cantidad) > 0).map((x) => ({
          insumo_id: x.insumo_id, cantidad: Number(x.cantidad), costo_unitario: Number(x.total || 0) / Number(x.cantidad)
        }));
        if (!items.length) { toast('Agregue al menos un insumo con cantidad', 'error'); return false; }
        const r = await api.call('inventario.compra', { ...f, items });
        toast('Compra registrada por ' + money(r.total));
      }
    }],
    onOpen: (el) => {
      const pintar = () => {
        $('#lineas', el).innerHTML = filas.map((x, i) => `<div class="receta-row" style="grid-template-columns:1fr 110px 130px 36px;margin-bottom:.4rem">
          <select data-k="insumo_id" data-i="${i}" aria-label="Insumo">${opciones(activos.map((a) => ({ id: a.id, nombre: `${a.nombre} (${a.unidad})` })), x.insumo_id, { vacio: 'Seleccione…' })}</select>
          <input data-k="cantidad" data-i="${i}" type="number" step="any" min="0" value="${x.cantidad}" placeholder="Cant." aria-label="Cantidad">
          <input data-k="total" data-i="${i}" type="number" step="any" min="0" value="${x.total ?? ''}" placeholder="$ total" aria-label="Valor total">
          <button type="button" class="icon-btn" data-rm="${i}" aria-label="Quitar">✕</button></div>`).join('');
        $$('[data-k]', el).forEach((inp) => {
          inp.oninput = inp.onchange = () => { filas[+inp.dataset.i][inp.dataset.k] = inp.value; total(); };
        });
        $$('[data-rm]', el).forEach((b) => { b.onclick = () => { filas.splice(+b.dataset.rm, 1); if (!filas.length) filas.push({ insumo_id: '', cantidad: '' }); pintar(); }; });
        total();
      };
      const total = () => { $('#tot', el).textContent = money(filas.reduce((a, x) => a + (Number(x.total) || 0), 0)); };
      $('#add', el).onclick = () => { filas.push({ insumo_id: '', cantidad: '' }); pintar(); };
      pintar();
    }
  });
  if (ok) recargar();
}

async function compras(el, app, cat, recargar) {
  el.innerHTML = `<div class="card"><div class="toolbar">
      <form class="toolbar" id="fc" style="margin:0"><label class="small">Desde <input type="date" name="desde"></label><label class="small">Hasta <input type="date" name="hasta"></label><button class="btn btn-dark">Filtrar</button></form>
      <span class="grow"></span><button class="btn btn-primary" id="nc">Registrar compra</button></div><div id="lc"></div></div>`;
  $('#nc').onclick = () => nuevaCompra(cat, recargar);
  const cargar = async () => {
    loading($('#lc'));
    try {
      const rows = await api.call('inventario.compras', Object.fromEntries(new FormData($('#fc'))));
      if (!$('#lc')) return; // la vista cambió mientras se cargaba
      $('#lc').innerHTML = tabla(rows, [
        { t: 'Fecha', f: (c) => esc(fechaCorta(c.fecha)) },
        { t: 'Proveedor', k: 'proveedor' },
        { t: 'Factura', k: 'factura' },
        { t: 'Insumos', f: (c) => c.items.map((i) => `${esc(i.insumo)} ${num(i.cantidad)} ${esc(i.unidad)}`).join('<br>') },
        { t: 'Pago', f: (c) => (c.pagado_caja ? badge('Caja', 'dark') : badge('Externo')) },
        { t: 'Total', cls: 'right', f: (c) => `<b>${money(c.total)}</b>` }
      ], { vacio: 'Sin compras registradas' });
      $('.table', $('#lc'))?.classList.add('stack');
    } catch (e) { $('#lc').innerHTML = `<div class="alert">${esc(errorMsg(e))}</div>`; }
  };
  $('#fc').onsubmit = (e) => { e.preventDefault(); cargar(); };
  cargar();
}

async function movimientos(el, app, cat) {
  el.innerHTML = `<div class="card"><form class="toolbar" id="fm">
    <select name="insumo_id"><option value="">Todos los insumos</option>${opciones(cat.insumos, '')}</select>
    <select name="tipo"><option value="">Todos los tipos</option>${Object.keys(TIPO_MOV).map((t) => `<option>${t}</option>`).join('')}</select>
    <label class="small">Desde <input type="date" name="desde"></label><label class="small">Hasta <input type="date" name="hasta"></label>
    <button class="btn btn-dark">Filtrar</button></form><div id="lm"></div></div>`;
  const cargar = async () => {
    loading($('#lm'));
    try {
      const rows = await api.call('inventario.kardex', Object.fromEntries(new FormData($('#fm'))));
      if (!$('#lm')) return; // la vista cambió mientras se cargaba
      $('#lm').innerHTML = tablaMovs(rows, true);
      $('.table', $('#lm'))?.classList.add('stack');
    } catch (e) { $('#lm').innerHTML = `<div class="alert">${esc(errorMsg(e))}</div>`; }
  };
  $('#fm').onsubmit = (e) => { e.preventDefault(); cargar(); };
  cargar();
}
