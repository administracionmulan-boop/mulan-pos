// Reportes e indicadores: ventas diarias/semanales/mensuales/anuales, productos, ganancia, compras, gastos,
// inventario y medios de pago.
import * as api from '../api.js';
import { $, $$, esc, money, num, pct, tabla, badge, errorMsg, loading, rangoPreset } from '../ui.js';

const ROJO = '#c62828', NEGRO = '#111111';
const PALETA = [ROJO, NEGRO, '#8e8e8e', '#e57373', '#4a4a4a', '#ffb3b3', '#bdbdbd'];
let charts = [];
let preset = 'mes';

export async function render(root, app) {
  const r = rangoPreset(preset);
  root.innerHTML = `
    <div class="card">
      <div class="toolbar" style="margin:0">
        <div class="seg" id="presets">
          <button data-p="hoy">Hoy</button><button data-p="semana">Semana</button><button data-p="mes">Mes</button><button data-p="anio">Año</button>
        </div>
        <form class="toolbar" id="fr" style="margin:0">
          <label class="small">Desde <input type="date" name="desde" value="${r.desde}"></label>
          <label class="small">Hasta <input type="date" name="hasta" value="${r.hasta}"></label>
          <select name="agrupar" aria-label="Agrupar por"><option value="dia">Por día</option><option value="semana">Por semana</option><option value="mes">Por mes</option></select>
          <button class="btn btn-dark">Ver</button>
        </form>
        <span class="grow"></span>
        <button class="btn btn-sm" id="csv">Exportar CSV</button>
      </div>
    </div>
    <div id="rep" style="margin-top:1rem"></div>`;
  const f = $('#fr');
  f.agrupar.value = r.agrupar;
  const marcar = () => $$('#presets button').forEach((b) => b.classList.toggle('active', b.dataset.p === preset));
  marcar();
  $$('#presets button').forEach((b) => {
    b.onclick = () => {
      preset = b.dataset.p;
      const x = rangoPreset(preset);
      f.desde.value = x.desde; f.hasta.value = x.hasta; f.agrupar.value = x.agrupar;
      marcar(); cargar();
    };
  });
  f.onsubmit = (e) => { e.preventDefault(); preset = ''; marcar(); cargar(); };
  let ultimo = null;
  $('#csv').onclick = () => ultimo && exportar(ultimo);
  app.limpiezas.push(() => { charts.forEach((c) => c.destroy()); charts = []; });

  async function cargar() {
    loading($('#rep'));
    try {
      ultimo = await api.call('reporte.ventas', Object.fromEntries(new FormData(f)));
      if (!$('#rep')) return;
      pintar(ultimo);
    } catch (e) {
      if (!$('#rep')) return;
      $('#rep').innerHTML = `<div class="alert">${esc(errorMsg(e))}</div>`;
    }
  }
  cargar();
}

function variacion(act, ant) {
  if (!ant) return act ? '<span class="muted">sin datos del período anterior</span>' : '';
  const v = ((act - ant) / Math.abs(ant)) * 100;
  return `<span class="${v >= 0 ? 'text-ok' : 'text-bad'}">${v >= 0 ? '▲' : '▼'} ${num(Math.abs(v), 1)} %</span> <span class="muted">vs. período anterior</span>`;
}

function barras(lista, campo, etiqueta, fmt = money, dark) {
  if (!lista.length) return '<p class="muted">Sin datos</p>';
  const max = Math.max(...lista.map((x) => Math.abs(x[campo]))) || 1;
  return `<div class="bar-list ${dark ? 'dark' : ''}">${lista.map((x) => `<div class="it"><span>${esc(x[etiqueta])}</span><b>${fmt(x[campo])}</b><div class="bar"><i style="width:${(Math.abs(x[campo]) / max) * 100}%"></i></div></div>`).join('')}</div>`;
}

function pintar(d) {
  charts.forEach((c) => c.destroy());
  charts = [];
  const k = d.kpis, a = d.anterior;
  const etqGrupo = { dia: 'día', semana: 'semana', mes: 'mes' }[d.agrupar];
  $('#rep').innerHTML = `
    <div class="grid grid-4">
      <div class="kpi red"><div class="lbl">Ventas netas</div><div class="val">${money(k.ventas_netas)}</div><div class="sub">${variacion(k.ventas_netas, a.ventas_netas)}</div></div>
      <div class="kpi"><div class="lbl">Número de ventas</div><div class="val">${num(k.num_ventas, 0)}</div><div class="sub">${variacion(k.num_ventas, a.num_ventas)}</div></div>
      <div class="kpi"><div class="lbl">Ticket promedio</div><div class="val">${money(k.ticket_promedio)}</div><div class="sub">${variacion(k.ticket_promedio, a.ticket_promedio)}</div></div>
      <div class="kpi red"><div class="lbl">Ganancia estimada</div><div class="val">${money(k.ganancia_bruta)}</div><div class="sub">Margen ${pct(k.margen)} · ${variacion(k.ganancia_bruta, a.ganancia_bruta)}</div></div>
      <div class="kpi"><div class="lbl">Costo de lo vendido</div><div class="val">${money(k.costo)}</div></div>
      <div class="kpi"><div class="lbl">Compras de insumos</div><div class="val">${money(d.compras.total)}</div><div class="sub muted">${d.compras.num} compra(s)</div></div>
      <div class="kpi"><div class="lbl">Otros gastos (caja)</div><div class="val">${money(d.gastos.total)}</div></div>
      <div class="kpi red"><div class="lbl">Utilidad operativa est.</div><div class="val">${money(d.utilidad_operativa)}</div><div class="sub muted">Ganancia − gastos</div></div>
    </div>
    <div class="toolbar" style="margin-top:.8rem">${badge('Descuentos ' + money(k.descuentos))} ${badge('Impuestos ' + money(k.impuestos))} ${badge('Domicilios ' + money(k.domicilios))} ${badge('Devoluciones ' + money(k.devoluciones), 'bad')} ${badge(d.anuladas.num + ' anuladas (' + money(d.anuladas.valor) + ')', 'bad')}</div>
    <div class="card"><div class="card-head"><h3>Ventas y ganancia por ${etqGrupo}</h3></div><div class="chart-box"><canvas id="ch-serie"></canvas></div></div>
    <div class="grid grid-2" style="margin-top:1rem">
      <div class="card"><div class="card-head"><h3>Productos más vendidos</h3></div>${tabla(d.mas_vendidos.filter((p) => p.cantidad > 0), [
        { t: 'Producto', k: 'nombre' }, { t: 'Cant.', cls: 'right', f: (p) => num(p.cantidad) }, { t: 'Ventas', cls: 'right', f: (p) => money(p.ventas) }, { t: 'Utilidad', cls: 'right', f: (p) => money(p.utilidad) }
      ], { vacio: 'Sin ventas en el período' })}</div>
      <div class="card"><div class="card-head"><h3>Productos menos vendidos</h3></div>${tabla(d.menos_vendidos, [
        { t: 'Producto', k: 'nombre' }, { t: 'Categoría', k: 'categoria' }, { t: 'Cant.', cls: 'right', f: (p) => (p.cantidad ? num(p.cantidad) : badge('0', 'bad')) }, { t: 'Ventas', cls: 'right', f: (p) => money(p.ventas) }
      ])}</div>
      <div class="card"><div class="card-head"><h3>Medios de pago</h3></div><div class="chart-box sm"><canvas id="ch-met"></canvas></div>${barras(d.metodos, 'valor', 'metodo')}</div>
      <div class="card"><div class="card-head"><h3>Ventas por hora</h3></div><div class="chart-box sm"><canvas id="ch-hora"></canvas></div></div>
      <div class="card"><div class="card-head"><h3>Por categoría</h3></div>${barras(d.categorias, 'ventas', 'categoria')}</div>
      <div class="card"><div class="card-head"><h3>Por tipo de pedido y cajero</h3></div>
        ${barras(d.tipos.map((t) => ({ ...t, n: { MESA: 'Mesa', LLEVAR: 'Para llevar', DOMICILIO: 'Domicilio' }[t.tipo] + ` (${t.num})` })), 'ventas', 'n', money, true)}
        <div style="height:1rem"></div>${barras(d.cajeros.map((c) => ({ ...c, n: `${c.cajero} (${c.num})` })), 'ventas', 'n')}</div>
      <div class="card"><div class="card-head"><h3>Compras por proveedor</h3></div>${tabla(d.compras.por_proveedor, [
        { t: 'Proveedor', k: 'proveedor' }, { t: 'Compras', cls: 'right', k: 'num' }, { t: 'Total', cls: 'right', f: (p) => money(p.total) }
      ], { vacio: 'Sin compras' })}</div>
      <div class="card"><div class="card-head"><h3>Gastos registrados en caja</h3></div>${tabla(d.gastos.detalle, [
        { t: 'Fecha', f: (g) => esc(g.fecha.substring(0, 16)) }, { t: 'Concepto', k: 'concepto' }, { t: 'Valor', cls: 'right', f: (g) => money(g.valor) }
      ], { vacio: 'Sin gastos' })}</div>
    </div>
    <div class="card"><div class="card-head"><h3>Inventario disponible</h3><span>${badge('Valor ' + money(d.inventario.valor), 'dark')} ${badge(d.inventario.bajos + ' en alerta', d.inventario.bajos ? 'bad' : 'ok')}</span></div>
      ${tabla(d.inventario.detalle, [
        { t: 'Insumo', k: 'nombre' }, { t: 'Stock', cls: 'right', f: (i) => `<span class="${i.stock <= i.stock_minimo ? 'text-bad' : ''}">${num(i.stock)} ${esc(i.unidad)}</span>` },
        { t: 'Mínimo', cls: 'right', f: (i) => num(i.stock_minimo) }, { t: 'Valor', cls: 'right', f: (i) => money(i.valor) }
      ])}</div>`;
  $$('.table', $('#rep')).forEach((t) => t.classList.add('stack'));

  if (!window.Chart) return;
  Chart.defaults.font.family = getComputedStyle(document.body).fontFamily;
  const fmtEje = (v) => '$' + (Math.abs(v) >= 1e6 ? num(v / 1e6, 1) + 'M' : Math.abs(v) >= 1e3 ? num(v / 1e3, 0) + 'k' : v);
  const etiqueta = (p) => (d.agrupar === 'mes' ? p : p.substring(5).split('-').reverse().join('/'));
  charts.push(new Chart($('#ch-serie'), {
    type: 'bar',
    data: {
      labels: d.serie.map((s) => (d.agrupar === 'semana' ? 'Sem. ' : '') + etiqueta(s.periodo)),
      datasets: [
        { label: 'Ventas netas', data: d.serie.map((s) => s.ventas), backgroundColor: ROJO, borderRadius: 4, order: 2 },
        { label: 'Ganancia estimada', data: d.serie.map((s) => s.ganancia), type: 'line', borderColor: NEGRO, backgroundColor: NEGRO, tension: 0, pointRadius: 2, order: 1 }
      ]
    },
    options: { maintainAspectRatio: false, interaction: { mode: 'index', intersect: false }, scales: { y: { ticks: { callback: fmtEje } }, x: { grid: { display: false } } }, plugins: { tooltip: { callbacks: { label: (c) => `${c.dataset.label}: ${money(c.parsed.y)}` } } } }
  }));
  if (d.metodos.length) {
    charts.push(new Chart($('#ch-met'), {
      type: 'doughnut',
      data: { labels: d.metodos.map((m) => m.metodo), datasets: [{ data: d.metodos.map((m) => Math.max(0, m.valor)), backgroundColor: PALETA }] },
      options: { maintainAspectRatio: false, plugins: { legend: { position: 'right' }, tooltip: { callbacks: { label: (c) => `${c.label}: ${money(c.parsed)}` } } } }
    }));
  }
  const horas = d.horas.filter((h) => h.hora >= 6 && h.hora <= 23);
  charts.push(new Chart($('#ch-hora'), {
    type: 'bar',
    data: { labels: horas.map((h) => h.hora + 'h'), datasets: [{ label: 'Ventas', data: horas.map((h) => h.ventas), backgroundColor: NEGRO, borderRadius: 3 }] },
    options: { maintainAspectRatio: false, plugins: { legend: { display: false }, tooltip: { callbacks: { label: (c) => money(c.parsed.y) } } }, scales: { y: { ticks: { callback: fmtEje } }, x: { grid: { display: false } } } }
  }));
}

function exportar(d) {
  const filas = [['Reporte MULAN', d.desde, d.hasta], [], ['Indicador', 'Valor']];
  Object.keys(d.kpis).forEach((k) => filas.push([k, d.kpis[k]]));
  filas.push([], ['Periodo', 'Ventas netas', 'Num ventas', 'Ganancia']);
  d.serie.forEach((s) => filas.push([s.periodo, s.ventas, s.num, s.ganancia]));
  filas.push([], ['Producto', 'Categoria', 'Cantidad', 'Ventas', 'Costo', 'Utilidad']);
  d.productos.forEach((p) => filas.push([p.nombre, p.categoria, p.cantidad, p.ventas, p.costo, p.utilidad]));
  filas.push([], ['Medio de pago', 'Valor', 'Transacciones']);
  d.metodos.forEach((m) => filas.push([m.metodo, m.valor, m.num]));
  const csv = '﻿' + filas.map((r) => r.map((c) => `"${String(c ?? '').replace(/"/g, '""')}"`).join(';')).join('\r\n');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  a.download = `mulan-reporte-${d.desde}_${d.hasta}.csv`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
