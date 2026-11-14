// Historial de ventas: consulta, reimpresión, anulación y devoluciones con autorización.
import * as api from '../api.js';
import { $, $$, esc, money, num, toast, modal, tabla, bindRows, badge, fechaCorta, errorMsg, pedirAutorizacion, loading, rangoPreset } from '../ui.js';
import { comprobanteHTML, imprimir, enviarWhatsApp } from '../receipt.js';

const EST = { PAGADA: 'ok', ABIERTA: 'warn', ANULADA: 'bad', DEVUELTA: 'dark' };
const TIPO = { MESA: 'Mesa', LLEVAR: 'Para llevar', DOMICILIO: 'Domicilio' };

export async function render(root, app) {
  const cat = await app.catalogo();
  const r = rangoPreset('hoy');
  root.innerHTML = `
    <div class="card">
      <form class="toolbar" id="f">
        <label class="small">Desde <input type="date" name="desde" value="${r.desde}"></label>
        <label class="small">Hasta <input type="date" name="hasta" value="${r.hasta}"></label>
        <select name="estado" aria-label="Estado"><option value="">Todos los estados</option><option>PAGADA</option><option>ABIERTA</option><option>ANULADA</option><option>DEVUELTA</option></select>
        <select name="tipo" aria-label="Tipo"><option value="">Todos los tipos</option><option value="MESA">Mesa</option><option value="LLEVAR">Para llevar</option><option value="DOMICILIO">Domicilio</option></select>
        <input name="q" placeholder="N.º, cliente, mesa…" class="grow" style="max-width:220px">
        <button class="btn btn-dark">Buscar</button>
      </form>
      <div id="resumen" class="toolbar"></div>
      <div id="lista"></div>
    </div>`;
  const cargar = async () => {
    loading($('#lista'));
    const f = Object.fromEntries(new FormData($('#f')));
    try {
      const rows = await api.call('venta.listar', f);
      if (!$('#lista')) return; // la vista cambió mientras se cargaba
      const pagadas = rows.filter((v) => v.estado === 'PAGADA' || v.estado === 'DEVUELTA');
      $('#resumen').innerHTML = `${badge(rows.length + ' ventas')} ${badge('Total ' + money(pagadas.reduce((a, v) => a + v.total - v.devuelto, 0)), 'ok')} ${badge(rows.filter((v) => v.estado === 'ANULADA').length + ' anuladas', 'bad')}`;
      $('#lista').innerHTML = tabla(rows, [
        { t: 'N.º', f: (v) => `<b>#${v.numero}</b>` },
        { t: 'Fecha', f: (v) => esc(fechaCorta(v.fecha_pago || v.fecha)) },
        { t: 'Tipo', f: (v) => esc(TIPO[v.tipo]) + (v.mesa ? ' · ' + esc(v.mesa) : '') + (v.cliente ? ' · ' + esc(v.cliente) : '') },
        { t: 'Cajero', k: 'cajero' },
        { t: 'Estado', f: (v) => badge(v.estado, EST[v.estado]) + (v.origen === 'OFFLINE' ? ' ' + badge('offline') : '') },
        { t: 'Total', cls: 'right', f: (v) => `<b>${money(v.total)}</b>${v.devuelto ? `<div class="small text-bad">−${money(v.devuelto)}</div>` : ''}` }
      ], { onRow: true, vacio: 'No hay ventas en este rango' });
      $('.table', $('#lista'))?.classList.add('stack');
      bindRows($('#lista'), rows, (v) => detalle(v.id, app, cat, cargar));
    } catch (e) {
      if (!$('#lista')) return;
      $('#lista').innerHTML = `<div class="alert">${esc(errorMsg(e))}</div>`;
    }
  };
  $('#f').onsubmit = (e) => { e.preventDefault(); cargar(); };
  cargar();
}

async function detalle(id, app, cat, recargar) {
  let v;
  try { v = await api.call('venta.detalle', { id }); } catch (e) { toast(errorMsg(e), 'error'); return; }
  const cfg = cat.config;
  const acciones = [
    { label: 'WhatsApp', cls: 'btn-ghost', onClick: () => { enviarWhatsApp(v, cfg, v.telefono || prompt('Celular del cliente:') || ''); return false; } },
    { label: 'Imprimir', cls: 'btn-dark', onClick: () => { imprimir(comprobanteHTML(v, cfg)); return false; } }
  ];
  if (v.estado === 'PAGADA') acciones.unshift({ label: 'Devolución', cls: 'btn-danger', value: 'devolver' });
  if (v.estado === 'PAGADA' && !v.devuelto || v.estado === 'ABIERTA') acciones.unshift({ label: 'Anular', cls: 'btn-danger', value: 'anular' });
  const r = await modal({
    title: `Venta #${v.numero}`,
    wide: true,
    body: `<div class="grid grid-2">
      <div class="ticket-preview">${comprobanteHTML(v, cfg)}</div>
      <div>
        <p>${badge(v.estado, EST[v.estado])} ${v.origen === 'OFFLINE' ? badge('Registrada sin conexión') : ''}</p>
        <p><b>Costo estimado:</b> ${money(v.costo)}<br><b>Utilidad estimada:</b> ${money(v.total - v.impuesto - v.costo)}</p>
        ${v.motivo ? `<p><b>Motivo:</b> ${esc(v.motivo)}</p>` : ''}
        ${v.autorizado_por_nombre ? `<p><b>Autorizó:</b> ${esc(v.autorizado_por_nombre)}</p>` : ''}
        <h3>Pagos</h3>
        ${v.pagos.map((p) => `<div class="t-row"><span>${esc(p.metodo)} ${p.tipo !== 'VENTA' ? badge(p.tipo, 'bad') : ''}<br><span class="small muted">${esc(fechaCorta(p.fecha))} ${esc(p.referencia)}</span></span><b>${money(p.valor)}</b></div>`).join('') || '<p class="muted">Sin pagos (pedido abierto)</p>'}
      </div></div>`,
    actions: acciones
  });
  if (r === 'anular') anular(v, app, recargar);
  if (r === 'devolver') devolver(v, app, cfg, recargar);
}

async function anular(v, app, recargar) {
  const motivo = await modal({
    title: `Anular venta #${v.numero}`,
    body: `<div class="alert">Se revertirá el dinero en caja${v.estado === 'PAGADA' ? ' y se reintegrarán los insumos al inventario' : ''}.</div><label class="form">Motivo de la anulación<textarea id="mot"></textarea></label>`,
    actions: [{ label: 'Cancelar', cls: 'btn-ghost', value: null }, { label: 'Anular venta', cls: 'btn-danger', onClick: (c, el) => { const m = $('#mot', el).value.trim(); if (!m) { toast('Indique el motivo', 'error'); return false; } c(m); return false; } }]
  });
  if (!motivo) return;
  const aut = app.esAdmin ? {} : await pedirAutorizacion('La anulación de ventas requiere autorización de un administrador.');
  if (!aut) return;
  try {
    await api.call('venta.anular', { id: v.id, motivo, autorizacion: aut });
    toast(`Venta #${v.numero} anulada`);
    recargar();
  } catch (e) { toast(errorMsg(e), 'error'); }
}

async function devolver(v, app, cfg, recargar) {
  const metodos = String(cfg.metodos_pago).split(',').map((m) => m.trim());
  const items = v.items.filter((i) => i.cantidad - i.devuelto > 0);
  let datos = null;
  const ok = await modal({
    title: `Devolución · venta #${v.numero}`,
    wide: true,
    body: `<form class="form" onsubmit="return false">
      ${items.map((i) => `<div class="receta-row" style="grid-template-columns:1fr 120px"><span>${esc(i.nombre)} <span class="muted small">(${num(i.cantidad - i.devuelto)} disponibles · ${money(i.total / i.cantidad)} c/u)</span></span>
        <input type="number" min="0" max="${i.cantidad - i.devuelto}" step="1" value="0" data-item="${esc(i.id)}" aria-label="Cantidad a devolver de ${esc(i.nombre)}"></div>`).join('')}
      <div class="row">
        <label>Devolver dinero por<select name="metodo">${metodos.map((m) => `<option>${esc(m)}</option>`).join('')}</select></label>
        <label>Motivo<input name="motivo" required></label>
      </div>
      <label class="check"><input type="checkbox" name="reintegrar"> Reintegrar insumos al inventario (el producto no se preparó o se puede reutilizar)</label>
    </form>`,
    actions: [{ label: 'Cancelar', cls: 'btn-ghost', value: false }, {
      label: 'Registrar devolución', cls: 'btn-danger', onClick: (c, el) => {
        const f = $('form', el);
        const sel = $$('[data-item]', el).map((x) => ({ item_id: x.dataset.item, cantidad: Number(x.value) || 0 })).filter((x) => x.cantidad > 0);
        if (!sel.length) { toast('Indique cantidades a devolver', 'error'); return false; }
        if (!f.motivo.value.trim()) { toast('Indique el motivo', 'error'); return false; }
        datos = { id: v.id, items: sel, metodo: f.metodo.value, motivo: f.motivo.value.trim(), reintegrar: f.reintegrar.checked };
      }
    }]
  });
  if (!ok || !datos) return;
  const aut = app.esAdmin ? {} : await pedirAutorizacion('Las devoluciones requieren autorización de un administrador.');
  if (!aut) return;
  try {
    const r = await api.call('venta.devolver', { ...datos, autorizacion: aut });
    toast(`Devolución registrada: ${money(r.devuelto)}`);
    recargar();
  } catch (e) { toast(errorMsg(e), 'error'); }
}
