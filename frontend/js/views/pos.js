// Vender: comandas por mesa, para llevar y domicilios. Total y cobro en un clic, pagos mixtos, comprobante.
import * as api from '../api.js';
import { kv } from '../store.js';
import { totales, promoDescuento, ymdLocal } from '../calc.js';
import { $, $$, esc, money, num, toast, modal, errorMsg, pedirAutorizacion, formData, debounce } from '../ui.js';
import { comprobanteHTML, comandaHTML, imprimir, enviarWhatsApp, compartir } from '../receipt.js';

let S; // estado de la vista

const nuevoPedido = (tipo = 'LLEVAR') => ({
  id: api.uuid(), tipo, mesa: '', cliente: '', telefono: '', direccion: '', domicilio: 0, descuento: 0, nota: '',
  items: [], existente: false, numero: null, enviados: {}
});

async function cargarAbiertas() {
  let server = [];
  try { server = await api.cacheado('abiertas', 'venta.abiertas'); } catch (e) { server = (await kv.get('abiertas')) || []; }
  const pend = (await kv.get('abiertas_pend')) || {};
  const map = new Map(server.map((v) => [v.id, v]));
  Object.keys(pend).forEach((id) => { if (pend[id]) map.set(id, pend[id]); else map.delete(id); });
  S.abiertas = Array.from(map.values());
}

async function marcarPendiente(id, venta) {
  const pend = (await kv.get('abiertas_pend')) || {};
  pend[id] = venta;
  await kv.set('abiertas_pend', pend);
}

async function cajaActual() {
  try {
    const e = await api.cacheado('caja', 'caja.estado');
    return e.abierta ? e.caja : null;
  } catch (e) {
    const c = await kv.get('caja');
    return c && c.abierta ? c.caja : null;
  }
}

export async function render(root, app) {
  const [cat, caja] = await Promise.all([app.catalogo(), cajaActual()]);
  S = { app, cat, caja, cfg: cat.config, catSel: '', q: '', pedido: nuevoPedido(), abiertas: [] };
  S.mesas = String(S.cfg.mesas || '').split(',').map((m) => m.trim()).filter(Boolean);
  S.metodos = String(S.cfg.metodos_pago || 'EFECTIVO').split(',').map((m) => m.trim()).filter(Boolean);
  S.cats = cat.categorias.filter((c) => c.activo);
  S.prods = cat.productos.filter((p) => p.activo);
  await cargarAbiertas();

  if (!caja) {
    root.innerHTML = `<div class="card" style="max-width:520px">
      <h2>Caja cerrada</h2><p>Para registrar ventas primero debe abrir su caja con la base inicial.</p>
      <a class="btn btn-primary btn-lg" href="#/caja">Abrir caja</a></div>`;
    return;
  }

  root.innerHTML = `
    <div class="pos">
      <section class="pos-left">
        <div class="toolbar" style="margin-bottom:.6rem">
          <input id="pos-q" class="grow" type="search" placeholder="Buscar producto…" aria-label="Buscar producto" style="max-width:340px">
          <div class="mesas" id="pos-abiertas" style="margin:0"></div>
        </div>
        <div class="pos-cat" id="pos-cat"></div>
        <div class="pos-grid" id="pos-grid"></div>
      </section>
      <aside class="ticket-panel" id="ticket"></aside>
    </div>
    <button class="btn btn-primary btn-lg pos-fab" id="pos-fab"></button>`;

  $('#pos-q').oninput = debounce((e) => { S.q = e.target.value.toLowerCase(); pintarProductos(); }, 150);
  $('#pos-fab').onclick = () => $('#ticket').classList.add('open');
  pintarCategorias();
  pintarProductos();
  pintarAbiertas();
  pintarTicket();

  const onSync = async (e) => {
    const { op, resultado } = e.detail;
    if (op.action !== 'venta.guardar') return;
    const pend = (await kv.get('abiertas_pend')) || {};
    if (op.data.id in pend) { delete pend[op.data.id]; await kv.set('abiertas_pend', pend); }
    if (resultado.ok) toast(`Venta sincronizada${resultado.data.venta ? ' #' + resultado.data.venta.numero : ''}`);
  };
  window.addEventListener('mulan:sincronizada', onSync);
  app.limpiezas.push(() => window.removeEventListener('mulan:sincronizada', onSync));
}

function pintarCategorias() {
  $('#pos-cat').innerHTML = `<button data-c="" class="${!S.catSel ? 'active' : ''}" style="--c:#111">Todo</button>` +
    S.cats.map((c) => `<button data-c="${esc(c.id)}" class="${S.catSel === c.id ? 'active' : ''}" style="--c:${esc(c.color)}">${esc(c.nombre)}</button>`).join('');
  $$('#pos-cat button').forEach((b) => { b.onclick = () => { S.catSel = b.dataset.c; pintarCategorias(); pintarProductos(); }; });
}

function pintarProductos() {
  const ymd = ymdLocal();
  const colores = Object.fromEntries(S.cats.map((c) => [c.id, c.color]));
  const lista = S.prods.filter((p) => (!S.catSel || p.categoria_id === S.catSel) && (!S.q || p.nombre.toLowerCase().includes(S.q)));
  $('#pos-grid').innerHTML = lista.length ? lista.map((p) => {
    const pr = promoDescuento(p, ymd, S.cat.promociones);
    return `<button class="prod" data-p="${esc(p.id)}" style="--c:${esc(colores[p.categoria_id] || '#c62828')}">
      ${pr.valor ? `<span class="promo">PROMO</span>` : ''}
      <b>${esc(p.nombre)}</b>
      <span class="pr">${pr.valor ? `<span class="old">${money(p.precio)}</span>` : ''}${money(p.precio - pr.valor)}</span>
    </button>`;
  }).join('') : `<div class="empty">No hay productos${S.prods.length ? ' con ese filtro' : '. Créelos en Productos y recetas.'}</div>`;
  $$('#pos-grid .prod').forEach((b) => { b.onclick = () => agregar(b.dataset.p); });
}

function pintarAbiertas() {
  const el = $('#pos-abiertas');
  const mesasOcup = Object.fromEntries(S.abiertas.filter((v) => v.tipo === 'MESA').map((v) => [v.mesa, v]));
  const otras = S.abiertas.filter((v) => v.tipo !== 'MESA');
  el.innerHTML = S.mesas.map((m) => {
    const v = mesasOcup[m];
    const actual = S.pedido.tipo === 'MESA' && S.pedido.mesa === m;
    return `<button class="mesa ${v ? 'ocupada' : ''} ${actual ? 'actual' : ''}" data-m="${esc(m)}" title="${v ? 'Pedido abierto ' + money(v.total) : 'Libre'}">${esc(m)}${v ? ' · ' + money(v.total) : ''}</button>`;
  }).join('') + otras.map((v) => `<button class="mesa ocupada" data-v="${esc(v.id)}">#${esc(v.numero || '…')} ${esc(v.cliente || v.tipo)}</button>`).join('');
  $$('[data-m]', el).forEach((b) => {
    b.onclick = () => {
      const v = mesasOcup[b.dataset.m];
      if (v) return cargarPedido(v);
      if (S.pedido.items.length && !S.pedido.existente) {
        S.pedido.tipo = 'MESA'; S.pedido.mesa = b.dataset.m;
      } else {
        S.pedido = nuevoPedido('MESA'); S.pedido.mesa = b.dataset.m;
      }
      pintarAbiertas(); pintarTicket();
    };
  });
  $$('[data-v]', el).forEach((b) => { b.onclick = () => cargarPedido(S.abiertas.find((v) => v.id === b.dataset.v)); });
}

function cargarPedido(v) {
  S.pedido = {
    id: v.id, tipo: v.tipo, mesa: v.mesa, cliente: v.cliente, telefono: v.telefono, direccion: v.direccion,
    domicilio: v.domicilio, descuento: 0, nota: v.nota, numero: v.numero, existente: true, enviados: {},
    items: v.items.map((i) => ({ key: i.id || i.key || api.uuid(), id: i.id, producto_id: i.producto_id, cantidad: i.cantidad, nota: String(i.nota || '').replace(/^Promo: [^·]*(· )?/, '').trim(), descuento_manual: 0 }))
  };
  // descuento global guardado = descuento total - descuentos de línea por promo
  const t = totales(S.pedido, S.cat);
  S.pedido.descuento = Math.max(0, Math.round(v.descuento - t.descuento));
  S.pedido.items.forEach((i) => { S.pedido.enviados[i.key] = i.cantidad; });
  pintarAbiertas(); pintarTicket();
  $('#ticket').classList.add('open');
}

function agregar(pid) {
  const it = S.pedido.items.find((i) => i.producto_id === pid && !i.nota && !i.descuento_manual);
  if (it) it.cantidad += 1;
  else S.pedido.items.push({ key: api.uuid(), producto_id: pid, cantidad: 1, nota: '', descuento_manual: 0 });
  pintarTicket();
  const p = S.prods.find((x) => x.id === pid);
  if (window.innerWidth <= 900) toast('+1 ' + (p ? p.nombre : ''), 'ok', 900);
}

function pintarTicket() {
  const P = S.pedido;
  const t = totales(P, S.cat);
  S.tot = t;
  const fab = $('#pos-fab');
  fab.innerHTML = `<span>Ver pedido (${num(t.unidades, 0)})</span><b>${money(t.total)}</b>`;
  fab.classList.toggle('hidden', !P.items.length && !P.existente);
  const mesaOpts = S.mesas.map((m) => `<option ${P.mesa === m ? 'selected' : ''}>${esc(m)}</option>`).join('');
  $('#ticket').innerHTML = `
    <div class="ticket-head">
      <div style="display:flex;align-items:center;gap:.5rem">
        <button class="icon-btn" id="t-cerrar" style="color:#fff;display:${window.innerWidth <= 900 ? 'inline-grid' : 'none'}" aria-label="Volver">←</button>
        <b style="flex:1">${P.existente ? 'Pedido #' + esc(P.numero || '…') : 'Nuevo pedido'}</b>
        <button class="btn btn-sm btn-dark" id="t-nuevo" style="border-color:#444">Nuevo</button>
      </div>
      <div class="seg" id="t-tipo">
        ${['MESA', 'LLEVAR', 'DOMICILIO'].map((k) => `<button data-t="${k}" class="${P.tipo === k ? 'active' : ''}" ${P.existente && P.tipo !== k ? 'disabled' : ''}>${{ MESA: 'Mesa', LLEVAR: 'Para llevar', DOMICILIO: 'Domicilio' }[k]}</button>`).join('')}
      </div>
      ${P.tipo === 'MESA' ? `<select id="t-mesa" ${P.existente ? 'disabled' : ''}><option value="">Seleccione la mesa…</option>${mesaOpts}</select>` : ''}
      ${P.tipo === 'LLEVAR' ? `<input id="t-cliente" placeholder="Nombre del cliente (opcional)" value="${esc(P.cliente)}">` : ''}
      ${P.tipo === 'DOMICILIO' ? `
        <input id="t-cliente" placeholder="Cliente" value="${esc(P.cliente)}">
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:.4rem"><input id="t-tel" placeholder="Teléfono" inputmode="tel" value="${esc(P.telefono)}"><input id="t-dom" placeholder="Valor domicilio" inputmode="numeric" value="${P.domicilio || ''}"></div>
        <input id="t-dir" placeholder="Dirección de entrega" value="${esc(P.direccion)}">` : ''}
    </div>
    <div class="ticket-items">
      ${t.lineas.length ? t.lineas.map((l, i) => `
        <div class="t-line">
          <div class="nm">${esc(l.nombre)}</div>
          <div class="qty"><button data-menos="${i}" aria-label="Menos">−</button><b>${num(l.cantidad)}</b><button data-mas="${i}" aria-label="Más">+</button></div>
          <div class="muted small">${money(l.precio)} c/u${l.descuento ? ` · <span class="text-bad">−${money(l.descuento)}${l.promo ? ' ' + esc(l.promo) : ''}</span>` : ''}</div>
          <div class="right"><b>${money(l.total)}</b></div>
          ${l.nota ? `<div class="nt">→ ${esc(l.nota)}</div>` : ''}
          <div class="acts"><button class="btn btn-sm btn-ghost" data-nota="${i}">Nota</button><button class="btn btn-sm btn-ghost" data-desc="${i}">Descuento</button><button class="btn btn-sm btn-ghost text-bad" data-del="${i}">Quitar</button></div>
        </div>`).join('') : '<div class="empty">Toque los productos para agregarlos.</div>'}
    </div>
    <div class="ticket-tot">
      <div class="r"><span>Subtotal</span><span>${money(t.subtotal)}</span></div>
      ${t.descuento ? `<div class="r text-bad"><span>Descuentos</span><span>−${money(t.descuento)}</span></div>` : ''}
      ${t.domicilio ? `<div class="r"><span>Domicilio</span><span>${money(t.domicilio)}</span></div>` : ''}
      ${t.impuesto ? `<div class="r muted small"><span>Incluye ${esc(S.cfg.impuesto_nombre)} ${esc(S.cfg.impuesto_pct)}%</span><span>${money(t.impuesto)}</span></div>` : ''}
      <div class="r big"><span>TOTAL</span><span id="t-total">${money(t.total)}</span></div>
    </div>
    <div class="ticket-btns">
      <button class="btn" id="t-descg" ${!t.lineas.length ? 'disabled' : ''}>Descuento</button>
      ${P.tipo === 'MESA' ? `<button class="btn btn-dark" id="t-guardar" ${!t.lineas.length ? 'disabled' : ''}>Guardar comanda</button>` : `<button class="btn" id="t-nota">Nota pedido</button>`}
      ${P.existente ? `<button class="btn btn-danger" id="t-anular">Anular pedido</button><button class="btn" id="t-comanda">Imprimir comanda</button>` : ''}
      <button class="btn btn-primary btn-lg cobrar" id="t-cobrar" ${!t.lineas.length ? 'disabled' : ''}>Cobrar ${money(t.total)}</button>
    </div>`;
  bindTicket();
}

function bindTicket() {
  const P = S.pedido;
  const el = $('#ticket');
  const on = (sel, ev, fn) => { const x = $(sel, el); if (x) x[ev] = fn; };
  on('#t-cerrar', 'onclick', () => el.classList.remove('open'));
  on('#t-nuevo', 'onclick', () => { S.pedido = nuevoPedido(P.tipo === 'MESA' ? 'LLEVAR' : P.tipo); pintarAbiertas(); pintarTicket(); });
  $$('#t-tipo button', el).forEach((b) => { b.onclick = () => { P.tipo = b.dataset.t; if (P.tipo === 'DOMICILIO' && !P.domicilio) P.domicilio = Number(S.cfg.domicilio_valor) || 0; pintarAbiertas(); pintarTicket(); }; });
  on('#t-mesa', 'onchange', (e) => { P.mesa = e.target.value; pintarAbiertas(); });
  on('#t-cliente', 'oninput', (e) => { P.cliente = e.target.value; });
  on('#t-tel', 'oninput', (e) => { P.telefono = e.target.value; });
  on('#t-dir', 'oninput', (e) => { P.direccion = e.target.value; });
  on('#t-dom', 'onchange', (e) => { P.domicilio = Number(e.target.value.replace(/\D/g, '')) || 0; pintarTicket(); });
  $$('[data-mas]', el).forEach((b) => { b.onclick = () => { P.items[+b.dataset.mas].cantidad += 1; pintarTicket(); }; });
  $$('[data-menos]', el).forEach((b) => {
    b.onclick = () => {
      const it = P.items[+b.dataset.menos];
      it.cantidad -= 1;
      if (it.cantidad <= 0) P.items.splice(+b.dataset.menos, 1);
      pintarTicket();
    };
  });
  $$('[data-del]', el).forEach((b) => { b.onclick = () => { P.items.splice(+b.dataset.del, 1); pintarTicket(); }; });
  $$('[data-nota]', el).forEach((b) => { b.onclick = () => editarNota(P.items[+b.dataset.nota]); });
  $$('[data-desc]', el).forEach((b) => { b.onclick = () => descuentoLinea(P.items[+b.dataset.desc]); });
  on('#t-descg', 'onclick', descuentoGlobal);
  on('#t-nota', 'onclick', notaPedido);
  on('#t-guardar', 'onclick', guardarComanda);
  on('#t-cobrar', 'onclick', cobrar);
  on('#t-anular', 'onclick', anularPedido);
  on('#t-comanda', 'onclick', () => imprimir(comandaHTML({ ...P, ...S.tot, items: S.tot.lineas, fecha: new Date().toISOString().replace('T', ' ') }, S.cfg)));
}

async function editarNota(it) {
  const p = S.prods.find((x) => x.id === it.producto_id) || {};
  const mods = String(p.modificadores || '').split(',').map((m) => m.trim()).filter(Boolean);
  const v = await modal({
    title: 'Nota para cocina · ' + (p.nombre || ''),
    body: `${mods.length ? `<div class="billetes" style="margin-bottom:.6rem">${mods.map((m) => `<button type="button" class="btn btn-sm" data-mod="${esc(m)}">${esc(m)}</button>`).join('')}</div>` : ''}
      <textarea id="nota-txt" placeholder="Ej: sin cebolla, término medio…">${esc(it.nota)}</textarea>`,
    actions: [{ label: 'Cancelar', cls: 'btn-ghost', value: null }, { label: 'Guardar', cls: 'btn-primary', onClick: (c, el) => { it.nota = $('#nota-txt', el).value.trim(); } }],
    onOpen: (el) => {
      $$('[data-mod]', el).forEach((b) => {
        b.onclick = () => { const t = $('#nota-txt', el); t.value = [t.value.trim(), b.dataset.mod].filter(Boolean).join(', '); };
      });
    }
  });
  if (v) pintarTicket();
}

async function pedirValor(titulo, actual, ayuda) {
  let val = null;
  const r = await modal({
    title: titulo,
    body: `<form class="form" onsubmit="return false"><p class="muted small">${esc(ayuda)}</p>
      <div class="seg" id="dv-mod"><button type="button" data-m="v" class="active">Valor $</button><button type="button" data-m="p">Porcentaje %</button></div>
      <input id="dv" inputmode="decimal" class="input-money" value="${actual || ''}" placeholder="0"></form>`,
    actions: [{ label: 'Quitar descuento', cls: 'btn-ghost', value: 'quitar' }, { label: 'Aplicar', cls: 'btn-primary', onClick: (c, el) => { val = { modo: $('#dv-mod .active', el).dataset.m, v: Number($('#dv', el).value.replace(',', '.')) || 0 }; } }],
    onOpen: (el) => { $$('#dv-mod button', el).forEach((b) => { b.onclick = () => { $$('#dv-mod button', el).forEach((x) => x.classList.toggle('active', x === b)); }; }); }
  });
  if (r === 'quitar') return { modo: 'v', v: 0 };
  return r ? val : null;
}

async function descuentoLinea(it) {
  const l = S.tot.lineas.find((x) => x.key === it.key);
  const r = await pedirValor('Descuento en ' + l.nombre, it.descuento_manual, `Valor de la línea: ${money(l.precio * l.cantidad)}`);
  if (!r) return;
  it.descuento_manual = Math.round(r.modo === 'p' ? (l.precio * l.cantidad * Math.min(r.v, 100)) / 100 : r.v);
  pintarTicket();
}

async function descuentoGlobal() {
  const r = await pedirValor('Descuento al pedido', S.pedido.descuento, `Tope sin autorización para cajeros: ${S.cfg.max_descuento_cajero}% del subtotal.`);
  if (!r) return;
  const base = S.tot.total - S.tot.domicilio + (Number(S.pedido.descuento) || 0);
  S.pedido.descuento = Math.round(r.modo === 'p' ? (base * Math.min(r.v, 100)) / 100 : r.v);
  pintarTicket();
}

async function notaPedido() {
  const v = await modal({
    title: 'Nota del pedido', body: `<textarea id="np">${esc(S.pedido.nota)}</textarea>`,
    actions: [{ label: 'Guardar', cls: 'btn-primary', onClick: (c, el) => { S.pedido.nota = $('#np', el).value.trim(); } }]
  });
  if (v) toast('Nota guardada');
}

function validarPedido() {
  const P = S.pedido;
  if (!P.items.length) { toast('Agregue productos', 'error'); return false; }
  if (P.tipo === 'MESA' && !P.mesa) { toast('Seleccione la mesa', 'error'); return false; }
  if (P.tipo === 'DOMICILIO' && !P.direccion.trim()) { toast('Ingrese la dirección del domicilio', 'error'); return false; }
  return true;
}

async function autorizacionSiRequiere() {
  if (S.app.esAdmin) return {};
  if (S.tot.manualPct <= Number(S.cfg.max_descuento_cajero || 0) + 1e-9) return {};
  const a = await pedirAutorizacion(`El descuento (${num(S.tot.manualPct, 1)}%) supera el tope de ${S.cfg.max_descuento_cajero}% para cajeros.`);
  return a ? { autorizacion: a } : null;
}

function payload(extra = {}) {
  const P = S.pedido;
  return {
    id: P.id, tipo: P.tipo, mesa: P.mesa, cliente: P.cliente, telefono: P.telefono, direccion: P.direccion,
    domicilio: P.domicilio, descuento: P.descuento, nota: P.nota, caja_id: S.caja.id, fecha: new Date().toISOString(),
    items: P.items.map((i) => ({ id: i.id, producto_id: i.producto_id, cantidad: i.cantidad, nota: i.nota, descuento_manual: i.descuento_manual })),
    ...extra
  };
}

/** Venta local (para comprobante/lista) cuando la operación quedó en cola. */
function ventaLocal(data) {
  const t = S.tot;
  return {
    ...data, numero: S.pedido.numero, fecha: new Date().toISOString().replace('T', ' ').substring(0, 19), cajero: S.app.user.nombre,
    items: t.lineas.map((l) => ({ ...l, nota: [l.promo ? 'Promo: ' + l.promo : '', l.nota].filter(Boolean).join(' · ') })),
    subtotal: t.subtotal, descuento: t.descuento, domicilio: t.domicilio, impuesto: t.impuesto, total: t.total,
    estado: data.pagos ? 'PAGADA' : 'ABIERTA', _pendiente: true
  };
}

async function guardarComanda() {
  if (!validarPedido()) return;
  const aut = await autorizacionSiRequiere();
  if (aut === null) return;
  const nuevos = S.tot.lineas
    .map((l) => ({ ...l, cantidad: l.cantidad - (S.pedido.enviados[l.key] || 0) }))
    .filter((l) => l.cantidad > 0);
  const data = payload(aut);
  try {
    const r = await api.callOrQueue('venta.guardar', data);
    const v = r.encolada ? ventaLocal(data) : r.data.venta;
    if (r.encolada) { await marcarPendiente(data.id, v); toast('Sin conexión: comanda guardada en el dispositivo', 'warn'); } else toast(`Comanda #${v.numero} guardada`);
    await cargarAbiertas();
    const imprimirSi = await modal({
      title: 'Comanda guardada',
      body: `<p>${esc(v.mesa || '')} · ${nuevos.length} producto(s) nuevo(s) para cocina.</p><div class="ticket-preview">${comandaHTML(v, S.cfg, nuevos)}</div>`,
      actions: [{ label: 'Cerrar', cls: 'btn-ghost', value: false }, { label: 'Imprimir comanda', cls: 'btn-dark', value: true }]
    });
    if (imprimirSi) imprimir(comandaHTML(v, S.cfg, nuevos));
    S.pedido = nuevoPedido('MESA');
    $('#ticket').classList.remove('open');
    pintarAbiertas(); pintarTicket();
  } catch (e) { toast(errorMsg(e), 'error'); }
}

async function anularPedido() {
  const P = S.pedido;
  const motivo = await modal({
    title: 'Anular pedido #' + (P.numero || ''),
    body: '<label class="form">Motivo<textarea id="mot" required></textarea></label>',
    actions: [{ label: 'Cancelar', cls: 'btn-ghost', value: null }, { label: 'Anular', cls: 'btn-danger', onClick: (c, el) => { const m = $('#mot', el).value.trim(); if (!m) { toast('Indique el motivo', 'error'); return false; } c(m); return false; } }]
  });
  if (!motivo) return;
  const aut = S.app.esAdmin ? {} : await pedirAutorizacion('Anular un pedido requiere autorización.');
  if (!aut) return;
  try {
    await api.call('venta.anular', { id: P.id, motivo, autorizacion: aut });
    toast('Pedido anulado');
    S.pedido = nuevoPedido();
    await cargarAbiertas();
    pintarAbiertas(); pintarTicket();
  } catch (e) { toast(errorMsg(e), 'error'); }
}

async function cobrar() {
  if (!validarPedido()) return;
  const aut = await autorizacionSiRequiere();
  if (aut === null) return;
  const total = S.tot.total;
  const pagos = [];
  let metodo = S.metodos[0];

  const restante = () => total - pagos.reduce((a, p) => a + p.valor, 0);
  const res = await modal({
    title: 'Cobrar',
    body: `<div class="total-grande" id="c-total">${money(total)}</div>
      <div id="c-pagos" style="margin:.6rem 0"></div>
      <div id="c-form">
        <p class="muted small" style="margin:.6rem 0 .3rem">Medio de pago</p>
        <div class="pagos-grid" id="c-met">${S.metodos.map((m) => `<button type="button" data-met="${esc(m)}">${esc(m.charAt(0) + m.slice(1).toLowerCase())}</button>`).join('')}</div>
        <form class="form" style="margin-top:.8rem" onsubmit="return false">
          <div class="row">
            <label>Valor a pagar con este medio<input id="c-valor" class="input-money" inputmode="numeric"></label>
            <label id="c-rec-l">Recibido en efectivo<input id="c-rec" class="input-money" inputmode="numeric"></label>
            <label id="c-ref-l" class="hidden">Referencia / comprobante<input id="c-ref" placeholder="Opcional"></label>
          </div>
          <div class="billetes" id="c-bill"></div>
          <div class="cambio" id="c-cambio"></div>
          <button type="button" class="btn btn-sm" id="c-add">+ Pagar parte con otro medio</button>
        </form>
      </div>`,
    actions: [{ label: 'Cancelar', cls: 'btn-ghost', value: null }, {
      label: 'Confirmar pago', cls: 'btn-primary btn-lg', onClick: (close, el) => {
        if (!agregarPagoActual(el, true)) return false;
        if (Math.abs(restante()) > 0) { toast('Falta ' + money(restante()), 'error'); return false; }
        close('ok');
        return false;
      }
    }],
    onOpen: (el) => {
      const pintar = () => {
        $$('#c-met button', el).forEach((b) => b.classList.toggle('active', b.dataset.met === metodo));
        const ef = metodo === 'EFECTIVO';
        $('#c-rec-l', el).classList.toggle('hidden', !ef);
        $('#c-ref-l', el).classList.toggle('hidden', ef);
        $('#c-valor', el).value = restante();
        $('#c-rec', el).value = '';
        const r = restante();
        const sug = [r, ...[2000, 5000, 10000, 20000, 50000, 100000].map((b) => Math.ceil(r / b) * b)].filter((x, i, a) => x >= r && a.indexOf(x) === i).slice(0, 5);
        $('#c-bill', el).innerHTML = ef ? sug.map((x) => `<button type="button" class="btn btn-sm" data-b="${x}">${x === r ? 'Exacto' : money(x)}</button>`).join('') : '';
        $$('[data-b]', el).forEach((b) => { b.onclick = () => { $('#c-rec', el).value = b.dataset.b; calcCambio(); }; });
        $('#c-pagos', el).innerHTML = pagos.map((p, i) => `<div class="t-row" style="padding:.3rem 0;border-bottom:1px dashed #ddd"><span>${esc(p.metodo)} ${p.referencia ? '· ' + esc(p.referencia) : ''}</span><span><b>${money(p.valor)}</b> <button class="btn btn-sm btn-ghost" data-rm="${i}">✕</button></span></div>`).join('') +
          (pagos.length ? `<div class="t-row"><span>Restante</span><b>${money(restante())}</b></div>` : '');
        $$('[data-rm]', el).forEach((b) => { b.onclick = () => { pagos.splice(+b.dataset.rm, 1); pintar(); }; });
        calcCambio();
      };
      const calcCambio = () => {
        const v = Number($('#c-valor', el).value.replace(/\D/g, '')) || 0;
        const rec = Number($('#c-rec', el).value.replace(/\D/g, '')) || 0;
        $('#c-cambio', el).textContent = metodo === 'EFECTIVO' && rec > v ? 'Cambio: ' + money(rec - v) : '';
      };
      $$('#c-met button', el).forEach((b) => { b.onclick = () => { metodo = b.dataset.met; pintar(); }; });
      $('#c-rec', el).oninput = calcCambio;
      $('#c-valor', el).oninput = calcCambio;
      $('#c-add', el).onclick = () => { if (agregarPagoActual(el, false)) { metodo = S.metodos.find((m) => m !== metodo) || metodo; pintar(); } };
      el._pintar = pintar;
      pintar();
    }
  });

  function agregarPagoActual(el, final) {
    const r = restante();
    if (r <= 0) return true;
    const v = Number($('#c-valor', el).value.replace(/\D/g, '')) || 0;
    if (v <= 0) { if (final && pagos.length) return true; toast('Ingrese el valor', 'error'); return false; }
    if (v > r) { toast('El valor supera lo que falta por pagar (' + money(r) + ')', 'error'); return false; }
    const p = { metodo, valor: v };
    if (metodo === 'EFECTIVO') {
      const rec = Number($('#c-rec', el).value.replace(/\D/g, '')) || v;
      if (rec < v) { toast('El efectivo recibido es menor al valor', 'error'); return false; }
      p.recibido = rec;
    } else {
      p.referencia = $('#c-ref', el).value.trim();
    }
    pagos.push(p);
    return true;
  }

  if (res !== 'ok') return;
  const data = payload({ ...aut, pagos });
  try {
    const r = await api.callOrQueue('venta.guardar', data);
    let v;
    if (r.encolada) {
      v = ventaLocal(data);
      v.pagos = pagos.map((p) => ({ ...p, tipo: 'VENTA', cambio: p.metodo === 'EFECTIVO' ? (p.recibido || p.valor) - p.valor : 0 }));
      if (S.pedido.existente) await marcarPendiente(data.id, null);
      toast('Sin conexión: venta guardada en el dispositivo; se enviará al volver el internet', 'warn', 5000);
    } else {
      v = r.data.venta;
      toast(`Venta #${v.numero} registrada`);
    }
    S.pedido = nuevoPedido('LLEVAR');
    $('#ticket').classList.remove('open');
    await cargarAbiertas();
    pintarAbiertas(); pintarTicket();
    mostrarComprobante(v);
  } catch (e) {
    toast(errorMsg(e), 'error', 6000);
  }
}

export async function mostrarComprobante(v, cfg) {
  cfg = cfg || S.cfg;
  const cambio = (v.pagos || []).reduce((a, p) => a + (Number(p.cambio) || 0), 0);
  await modal({
    title: v.numero ? `Venta #${v.numero}` : 'Venta registrada',
    body: `${cambio > 0 ? `<div class="cambio" style="margin-bottom:.6rem">Cambio: ${money(cambio)}</div>` : ''}<div class="ticket-preview">${comprobanteHTML(v, cfg)}</div>`,
    actions: [
      { label: 'WhatsApp', cls: 'btn-ghost', onClick: async () => {
        let tel = v.telefono;
        if (!tel) {
          const r = await modal({ title: 'Enviar por WhatsApp', body: '<label class="form">Celular del cliente<input id="wa" inputmode="tel" placeholder="3001234567"></label>', actions: [{ label: 'Enviar', cls: 'btn-primary', onClick: (c, el) => { c($('#wa', el).value); return false; } }] });
          if (!r) return false;
          tel = r;
        }
        enviarWhatsApp(v, cfg, tel);
        return false;
      } },
      { label: 'Compartir', cls: 'btn-ghost', onClick: async () => { const r = await compartir(v, cfg); if (r === 'copiado') toast('Comprobante copiado'); return false; } },
      { label: 'Imprimir', cls: 'btn-dark', onClick: () => { imprimir(comprobanteHTML(v, cfg)); return false; } },
      { label: 'Nueva venta', cls: 'btn-primary', value: true }
    ]
  });
}
