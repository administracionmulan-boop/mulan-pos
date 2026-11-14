// Control de caja: apertura con base, ingresos/egresos/retiros, arqueo y cierre, historial por cajero y turno.
import * as api from '../api.js';
import { kv } from '../store.js';
import { $, $$, esc, money, toast, modal, tabla, bindRows, badge, fechaCorta, errorMsg, formData, validar, loading, opciones } from '../ui.js';

const DENOM = [100000, 50000, 20000, 10000, 5000, 2000, 1000, 500, 200, 100, 50];

export async function render(root, app) {
  const cat = await app.catalogo();
  const turnos = String(cat.config.turnos || '').split(',').map((t) => t.trim()).filter(Boolean);
  let est;
  try { est = await api.cacheado('caja', 'caja.estado'); } catch (e) { root.innerHTML = `<div class="alert">${esc(errorMsg(e))}</div>`; return; }

  root.innerHTML = `<div id="actual"></div>
    <div class="card"><div class="card-head"><h3>Historial de cajas</h3></div>
      <form class="toolbar" id="fh">
        <label class="small">Desde <input type="date" name="desde"></label>
        <label class="small">Hasta <input type="date" name="hasta"></label>
        <select name="turno"><option value="">Todos los turnos</option>${turnos.map((t) => `<option>${esc(t)}</option>`).join('')}</select>
        ${app.esAdmin ? '<select name="cajero_id" id="fh-cajero"><option value="">Todos los cajeros</option></select>' : ''}
        <button class="btn btn-dark">Filtrar</button>
      </form>
      <div id="hist"></div></div>`;

  pintarActual(est, app, turnos);
  const cargarHist = async () => {
    loading($('#hist'));
    try {
      const rows = await api.call('caja.historial', Object.fromEntries(new FormData($('#fh'))));
      if (!$('#hist')) return; // la vista cambió mientras se cargaba
      $('#hist').innerHTML = tabla(rows, [
        { t: 'Apertura', f: (c) => esc(fechaCorta(c.apertura)) },
        { t: 'Cierre', f: (c) => esc(fechaCorta(c.cierre)) || badge('ABIERTA', 'warn') },
        { t: 'Cajero', k: 'cajero' },
        { t: 'Turno', k: 'turno' },
        { t: 'Ventas', cls: 'right', f: (c) => money(c.ventas) },
        { t: 'Esperado', cls: 'right', f: (c) => money(c.esperado) },
        { t: 'Contado', cls: 'right', f: (c) => (c.estado === 'CERRADA' ? money(c.real) : '—') },
        { t: 'Diferencia', cls: 'right', f: (c) => (c.estado === 'CERRADA' ? `<b class="${c.diferencia < 0 ? 'text-bad' : c.diferencia > 0 ? 'text-warn' : 'text-ok'}">${money(c.diferencia)}</b>` : '—') }
      ], { onRow: true, vacio: 'Sin cajas en el rango' });
      $('.table', $('#hist'))?.classList.add('stack');
      bindRows($('#hist'), rows, (c) => detalleCaja(c.id));
    } catch (e) { if ($('#hist')) $('#hist').innerHTML = `<div class="alert">${esc(errorMsg(e))}</div>`; }
  };
  $('#fh').onsubmit = (e) => { e.preventDefault(); cargarHist(); };
  if (app.esAdmin) {
    api.call('usuario.listar').then((us) => { $('#fh-cajero').innerHTML = '<option value="">Todos los cajeros</option>' + opciones(us, ''); }).catch(() => {});
  }
  cargarHist();
  app._recargarCaja = async () => { const e = await api.cacheado('caja', 'caja.estado'); pintarActual(e, app, turnos); cargarHist(); };
}

function pintarActual(est, app, turnos) {
  const el = $('#actual');
  if (!est.abierta) {
    el.innerHTML = `<div class="card" style="max-width:560px">
      <div class="card-head"><h2>Abrir caja</h2></div>
      <form class="form" id="fa">
        <div class="row">
          <label>Base inicial en efectivo<input name="base" class="input-money" inputmode="numeric" required value="0"></label>
          <label>Turno<select name="turno">${turnos.map((t) => `<option>${esc(t)}</option>`).join('')}</select></label>
        </div>
        <label>Observaciones<input name="notas" placeholder="Opcional"></label>
        <button class="btn btn-primary btn-lg">Abrir caja</button>
      </form></div>`;
    $('#fa').onsubmit = async (e) => {
      e.preventDefault();
      const f = formData(e.target);
      f.base = Number(String(f.base).replace(/\D/g, '')) || 0;
      try {
        const r = await api.call('caja.abrir', f);
        await kv.set('caja', r);
        toast('Caja abierta');
        app._recargarCaja();
      } catch (err) { toast(errorMsg(err), 'error'); }
    };
    return;
  }
  const c = est.caja, r = c.resumen;
  el.innerHTML = `
    <div class="card">
      <div class="card-head"><h2>Caja abierta</h2><span class="muted">${esc(c.cajero)} · ${esc(fechaCorta(c.apertura))}${c.turno ? ' · ' + esc(c.turno) : ''}</span></div>
      <div class="grid grid-4">
        <div class="kpi"><div class="lbl">Base</div><div class="val">${money(r.base)}</div></div>
        <div class="kpi red"><div class="lbl">Ventas (${r.num_ventas})</div><div class="val">${money(r.ventas_total)}</div></div>
        <div class="kpi"><div class="lbl">Ingresos / Egresos / Retiros</div><div class="val" style="font-size:1.05rem">${money(r.ingresos)} / ${money(r.egresos)} / ${money(r.retiros)}</div></div>
        <div class="kpi red"><div class="lbl">Efectivo esperado</div><div class="val">${money(r.efectivo_esperado)}</div></div>
      </div>
      <h3 style="margin-top:1rem">Ventas por medio de pago</h3>
      <div class="toolbar">${Object.keys(r.ventas_por_metodo).map((m) => badge(`${m}: ${money(r.ventas_por_metodo[m])}`, 'dark')).join(' ') || '<span class="muted">Sin ventas</span>'}</div>
      <div class="toolbar">
        <button class="btn" data-mov="INGRESO">+ Ingreso</button>
        <button class="btn" data-mov="EGRESO">− Egreso / gasto</button>
        <button class="btn" data-mov="RETIRO">Retiro de efectivo</button>
        <span class="grow"></span>
        <button class="btn btn-primary" id="cerrar">Cerrar caja (arqueo)</button>
      </div>
      <h3>Movimientos</h3>
      ${tabla(c.movimientos, [
        { t: 'Hora', f: (m) => esc(fechaCorta(m.fecha)) },
        { t: 'Tipo', f: (m) => badge(m.tipo, m.tipo === 'INGRESO' ? 'ok' : 'bad') },
        { t: 'Concepto', k: 'concepto' },
        { t: 'Valor', cls: 'right', f: (m) => money(m.valor) }
      ], { vacio: 'Sin movimientos manuales' })}
    </div>`;
  $$('[data-mov]', el).forEach((b) => { b.onclick = () => movimiento(b.dataset.mov, app); });
  $('#cerrar').onclick = () => cerrar(c, app);
}

async function movimiento(tipo, app) {
  const titulos = { INGRESO: 'Ingreso de dinero', EGRESO: 'Egreso / gasto', RETIRO: 'Retiro de efectivo' };
  let datos;
  const ok = await modal({
    title: titulos[tipo],
    body: `<form class="form" onsubmit="return false">
      <label>Valor<input name="valor" class="input-money" inputmode="numeric" required></label>
      <label>Concepto<input name="concepto" required placeholder="${tipo === 'EGRESO' ? 'Ej: pago de gas, hielo…' : tipo === 'RETIRO' ? 'Ej: consignación, caja fuerte' : 'Ej: sencillo adicional'}"></label></form>`,
    actions: [{ label: 'Cancelar', cls: 'btn-ghost', value: false }, {
      label: 'Registrar', cls: 'btn-primary', onClick: (c, el) => {
        const f = $('form', el);
        if (!validar(f)) return false;
        datos = { id: api.uuid(), tipo, valor: Number(f.valor.value.replace(/\D/g, '')), concepto: f.concepto.value.trim() };
      }
    }]
  });
  if (!ok) return;
  try {
    const r = await api.callOrQueue('caja.movimiento', datos);
    toast(r.encolada ? 'Sin conexión: movimiento guardado, se enviará luego' : 'Movimiento registrado', r.encolada ? 'warn' : 'ok');
    app._recargarCaja().catch(() => {});
  } catch (e) { toast(errorMsg(e), 'error'); }
}

async function cerrar(c, app) {
  if (api.estado.pendientes) { toast('Hay operaciones sin sincronizar. Conéctese a internet antes de cerrar la caja.', 'error', 6000); return; }
  let est;
  try { est = await api.call('caja.estado'); } catch (e) { toast(errorMsg(e), 'error'); return; }
  const esp = est.caja.resumen.efectivo_esperado;
  let datos;
  const ok = await modal({
    title: 'Cierre de caja · arqueo',
    wide: true,
    body: `<div class="grid grid-2">
      <div>
        <p class="muted small">Cuente el efectivo por denominación (opcional) o escriba el total contado.</p>
        <div class="form">${DENOM.map((d) => `<div class="receta-row" style="grid-template-columns:1fr 100px 120px"><span>${money(d)}</span><input type="number" min="0" step="1" data-den="${d}" aria-label="Cantidad de ${money(d)}"><span class="right muted" data-sub="${d}">$ 0</span></div>`).join('')}</div>
      </div>
      <div class="form">
        <div class="kpi"><div class="lbl">Efectivo esperado</div><div class="val">${money(esp)}</div></div>
        <label>Efectivo contado<input id="real" class="input-money" inputmode="numeric" required></label>
        <div class="kpi red"><div class="lbl">Diferencia</div><div class="val" id="dif">—</div></div>
        <label>Observaciones<textarea id="obs"></textarea></label>
      </div></div>`,
    actions: [{ label: 'Cancelar', cls: 'btn-ghost', value: false }, {
      label: 'Cerrar caja', cls: 'btn-primary', onClick: (cl, el) => {
        const v = $('#real', el).value.replace(/\D/g, '');
        if (v === '') { toast('Ingrese el efectivo contado', 'error'); return false; }
        datos = { real: Number(v), notas: $('#obs', el).value.trim() };
      }
    }],
    onOpen: (el) => {
      const dif = () => {
        const v = $('#real', el).value.replace(/\D/g, '');
        if (v === '') { $('#dif', el).textContent = '—'; return; }
        const d = Number(v) - esp;
        $('#dif', el).innerHTML = `<span class="${d < 0 ? 'text-bad' : d > 0 ? 'text-warn' : 'text-ok'}">${money(d)} ${d < 0 ? '(faltante)' : d > 0 ? '(sobrante)' : '(cuadra)'}</span>`;
      };
      $$('[data-den]', el).forEach((i) => {
        i.oninput = () => {
          let tot = 0;
          $$('[data-den]', el).forEach((x) => {
            const s = (Number(x.value) || 0) * Number(x.dataset.den);
            tot += s;
            $(`[data-sub="${x.dataset.den}"]`, el).textContent = money(s);
          });
          $('#real', el).value = tot;
          dif();
        };
      });
      $('#real', el).oninput = dif;
    }
  });
  if (!ok || !datos) return;
  try {
    const r = await api.call('caja.cerrar', datos);
    await kv.set('caja', { abierta: false });
    toast('Caja cerrada');
    await mostrarCierre(r);
    app._recargarCaja();
  } catch (e) { toast(errorMsg(e), 'error', 6000); }
}

async function detalleCaja(id) {
  try { mostrarCierre(await api.call('caja.detalle', { id })); } catch (e) { toast(errorMsg(e), 'error'); }
}

async function mostrarCierre(c) {
  const r = c.resumen;
  const html = `<div class="ticket">
    <div class="t-center t-strong t-big">${c.estado === 'CERRADA' ? 'CIERRE DE CAJA' : 'ESTADO DE CAJA'}</div>
    <div class="t-row"><span>Cajero</span><span>${esc(c.cajero)}</span></div>
    <div class="t-row"><span>Turno</span><span>${esc(c.turno || '—')}</span></div>
    <div class="t-row"><span>Apertura</span><span>${esc(fechaCorta(c.apertura))}</span></div>
    <div class="t-row"><span>Cierre</span><span>${esc(fechaCorta(c.cierre) || '—')}</span></div>
    <div class="t-sep"></div>
    <div class="t-row"><span>Base</span><span>${money(r.base)}</span></div>
    ${Object.keys(r.ventas_por_metodo).map((m) => `<div class="t-row"><span>Ventas ${esc(m)}</span><span>${money(r.ventas_por_metodo[m])}</span></div>`).join('')}
    <div class="t-row t-strong"><span>Total ventas (${r.num_ventas})</span><span>${money(r.ventas_total)}</span></div>
    ${r.reversos ? `<div class="t-row"><span>Anulaciones/devoluciones</span><span>${money(r.reversos)}</span></div>` : ''}
    <div class="t-row"><span>Ingresos</span><span>${money(r.ingresos)}</span></div>
    <div class="t-row"><span>Egresos</span><span>-${money(r.egresos)}</span></div>
    <div class="t-row"><span>Retiros</span><span>-${money(r.retiros)}</span></div>
    <div class="t-sep"></div>
    <div class="t-row t-strong"><span>Efectivo esperado</span><span>${money(c.estado === 'CERRADA' ? c.esperado : r.efectivo_esperado)}</span></div>
    ${c.estado === 'CERRADA' ? `<div class="t-row t-strong"><span>Efectivo contado</span><span>${money(c.real)}</span></div>
    <div class="t-row t-strong t-big"><span>Diferencia</span><span>${money(c.diferencia)}</span></div>` : ''}
    ${c.notas ? `<div class="t-sep"></div><div>${esc(c.notas)}</div>` : ''}
    ${c.movimientos && c.movimientos.length ? `<div class="t-sep"></div>${c.movimientos.map((m) => `<div class="t-row t-small"><span>${esc(m.tipo)} ${esc(m.concepto)}</span><span>${money(m.valor)}</span></div>`).join('')}` : ''}
  </div>`;
  const { imprimir } = await import('../receipt.js');
  await modal({ title: 'Caja · ' + c.cajero, body: `<div class="ticket-preview">${html}</div>`, actions: [{ label: 'Imprimir', cls: 'btn-dark', onClick: () => { imprimir(html); return false; } }, { label: 'Cerrar', cls: 'btn-primary', value: true }] });
}
