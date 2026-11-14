import { cacheado } from '../api.js';
import { $, esc, money, num, fechaCorta, errorMsg } from '../ui.js';

export async function render(root, app) {
  let d;
  try {
    d = await cacheado('dashboard', 'reporte.dashboard');
  } catch (e) {
    root.innerHTML = `<div class="alert">${esc(errorMsg(e))}</div>`;
    return;
  }
  const k = d.kpis;
  root.innerHTML = `
    ${!d.caja ? `<div class="alert alert-warn">No tiene caja abierta. <a href="#/caja"><b>Abrir caja</b></a> para empezar a vender.</div>` : ''}
    <div class="grid grid-4">
      <div class="kpi red"><div class="lbl">Ventas de hoy</div><div class="val">${money(k.ventas_netas)}</div></div>
      <div class="kpi"><div class="lbl">Número de ventas</div><div class="val">${num(k.num_ventas, 0)}</div></div>
      <div class="kpi"><div class="lbl">Ticket promedio</div><div class="val">${money(k.ticket_promedio)}</div></div>
      ${k.ganancia_bruta !== undefined
        ? `<div class="kpi red"><div class="lbl">Ganancia estimada</div><div class="val">${money(k.ganancia_bruta)}</div><div class="sub muted">Margen ${num(k.margen, 1)} %</div></div>`
        : `<div class="kpi red"><div class="lbl">Pedidos abiertos</div><div class="val">${d.abiertas}</div></div>`}
    </div>
    <div class="grid grid-2" style="margin-top:1rem">
      <div class="card">
        <div class="card-head"><h3>Mi caja</h3>${d.caja ? `<a class="btn btn-sm" href="#/caja">Ver caja</a>` : `<a class="btn btn-sm btn-primary" href="#/caja">Abrir caja</a>`}</div>
        ${d.caja ? `
          <p class="muted">Abierta ${esc(fechaCorta(d.caja.apertura))}${d.caja.turno ? ' · Turno ' + esc(d.caja.turno) : ''}</p>
          <div class="grid grid-2">
            <div><div class="muted small">Ventas</div><b>${money(d.caja.resumen.ventas_total)}</b></div>
            <div><div class="muted small">Efectivo esperado</div><b>${money(d.caja.resumen.efectivo_esperado)}</b></div>
          </div>
          <div style="margin-top:1rem"><a class="btn btn-primary btn-lg btn-block" href="#/pos">Ir a vender</a></div>`
        : '<p class="muted">Sin caja abierta.</p>'}
      </div>
      <div class="card">
        <div class="card-head"><h3>Alertas de inventario</h3><a class="btn btn-sm" href="#/inventario">Inventario</a></div>
        ${d.alertas.length ? `<div class="list-alertas">${d.alertas.slice(0, 8).map((a) => `
          <div class="it ${a.alerta === 'BAJO' ? 'bajo' : ''}"><span><b>${esc(a.nombre)}</b> · ${a.alerta === 'AGOTADO' ? 'Agotado' : 'Bajo mínimo'}</span>
          <span class="nowrap">${num(a.stock)} / ${num(a.stock_minimo)} ${esc(a.unidad)}</span></div>`).join('')}</div>
          ${d.alertas.length > 8 ? `<p class="muted small">y ${d.alertas.length - 8} más…</p>` : ''}`
        : '<p class="muted">Todo el inventario está sobre el mínimo.</p>'}
      </div>
      <div class="card">
        <div class="card-head"><h3>Más vendidos hoy</h3></div>
        ${d.top.length ? `<div class="bar-list">${d.top.map((t) => `<div class="it"><span>${esc(t.nombre)}</span><b>${num(t.cantidad)}</b><div class="bar"><i style="width:${(t.cantidad / d.top[0].cantidad) * 100}%"></i></div></div>`).join('')}</div>` : '<p class="muted">Aún no hay ventas hoy.</p>'}
      </div>
      <div class="card">
        <div class="card-head"><h3>Pedidos abiertos</h3><a class="btn btn-sm" href="#/pos">Ver</a></div>
        <p style="font-size:2rem;font-weight:900;margin:0">${d.abiertas}</p>
        <p class="muted">Comandas de mesa pendientes por cobrar.</p>
      </div>
    </div>`;
}
