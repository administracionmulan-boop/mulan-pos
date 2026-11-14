// Comprobante de venta (tiquete 80 mm, no fiscal) y comanda de cocina: vista, impresión y envío por WhatsApp.
import { esc, money, fechaCorta, num } from './ui.js';

const LOGO = 'assets/logo.png';
const TIPO = { MESA: 'Mesa', LLEVAR: 'Para llevar', DOMICILIO: 'Domicilio' };

export function comprobanteHTML(v, cfg) {
  const pagos = (v.pagos || []).filter((p) => (p.tipo || 'VENTA') === 'VENTA');
  const cambio = pagos.reduce((a, p) => a + (Number(p.cambio) || 0), 0);
  const imp = Number(v.impuesto) || 0;
  return `<div class="ticket">
    <div class="t-center"><img src="${LOGO}" alt="" class="t-logo"></div>
    <div class="t-center t-strong t-big">${esc(cfg.negocio_nombre || 'MULAN')}</div>
    ${cfg.negocio_nit ? `<div class="t-center">NIT ${esc(cfg.negocio_nit)}</div>` : ''}
    ${cfg.negocio_direccion ? `<div class="t-center">${esc(cfg.negocio_direccion)}</div>` : ''}
    ${cfg.negocio_telefono ? `<div class="t-center">Tel. ${esc(cfg.negocio_telefono)}</div>` : ''}
    <div class="t-sep"></div>
    <div class="t-center t-strong">COMPROBANTE DE VENTA ${v.numero ? '#' + esc(v.numero) : '(provisional)'}</div>
    <div class="t-center t-small">Documento no fiscal</div>
    <div class="t-row"><span>Fecha</span><span>${esc(fechaCorta(v.fecha_pago || v.fecha))}</span></div>
    <div class="t-row"><span>Tipo</span><span>${esc(TIPO[v.tipo] || v.tipo)}${v.mesa ? ' · ' + esc(v.mesa) : ''}</span></div>
    ${v.cajero ? `<div class="t-row"><span>Atendió</span><span>${esc(v.cajero)}</span></div>` : ''}
    ${v.cliente ? `<div class="t-row"><span>Cliente</span><span>${esc(v.cliente)}</span></div>` : ''}
    ${v.telefono ? `<div class="t-row"><span>Teléfono</span><span>${esc(v.telefono)}</span></div>` : ''}
    ${v.direccion ? `<div class="t-row"><span>Dirección</span><span>${esc(v.direccion)}</span></div>` : ''}
    <div class="t-sep"></div>
    ${(v.items || []).map((i) => `
      <div class="t-item"><span>${num(i.cantidad, 2)} x ${esc(i.nombre)}</span><span>${money(i.precio * i.cantidad)}</span></div>
      ${i.descuento > 0 ? `<div class="t-row t-small"><span>&nbsp;&nbsp;Descuento</span><span>-${money(i.descuento)}</span></div>` : ''}
      ${i.nota ? `<div class="t-small">&nbsp;&nbsp;${esc(i.nota)}</div>` : ''}`).join('')}
    <div class="t-sep"></div>
    <div class="t-row"><span>Subtotal</span><span>${money(v.subtotal)}</span></div>
    ${v.descuento > 0 ? `<div class="t-row"><span>Descuentos</span><span>-${money(v.descuento)}</span></div>` : ''}
    ${v.domicilio > 0 ? `<div class="t-row"><span>Domicilio</span><span>${money(v.domicilio)}</span></div>` : ''}
    <div class="t-row t-strong t-big"><span>TOTAL</span><span>${money(v.total)}</span></div>
    ${imp > 0 ? `<div class="t-row t-small"><span>Incluye ${esc(cfg.impuesto_nombre || 'impuesto')} (${esc(cfg.impuesto_pct)}%)</span><span>${money(imp)}</span></div>` : ''}
    <div class="t-sep"></div>
    ${pagos.map((p) => `<div class="t-row"><span>${esc(p.metodo)}${p.referencia ? ' (' + esc(p.referencia) + ')' : ''}</span><span>${money(p.metodo === 'EFECTIVO' && p.recibido ? p.recibido : p.valor)}</span></div>`).join('')}
    ${cambio > 0 ? `<div class="t-row t-strong"><span>Cambio</span><span>${money(cambio)}</span></div>` : ''}
    ${v.devuelto > 0 ? `<div class="t-row"><span>Devuelto</span><span>-${money(v.devuelto)}</span></div>` : ''}
    ${v.estado === 'ANULADA' ? '<div class="t-center t-strong t-big">*** ANULADA ***</div>' : ''}
    ${v._pendiente ? '<div class="t-center t-small">Pendiente de sincronizar</div>' : ''}
    <div class="t-sep"></div>
    <div class="t-center">${esc(cfg.mensaje_comprobante || '')}</div>
  </div>`;
}

export function comandaHTML(v, cfg, soloNuevos) {
  const items = soloNuevos || v.items || [];
  return `<div class="ticket">
    <div class="t-center t-strong t-big">COMANDA ${v.numero ? '#' + esc(v.numero) : ''}</div>
    <div class="t-center t-strong">${esc(TIPO[v.tipo] || v.tipo)}${v.mesa ? ' · ' + esc(v.mesa) : ''}</div>
    <div class="t-center t-small">${esc(fechaCorta(v.fecha))}${v.cliente ? ' · ' + esc(v.cliente) : ''}</div>
    <div class="t-sep"></div>
    ${items.map((i) => `<div class="t-item t-big"><span><b>${num(i.cantidad, 2)}</b> ${esc(i.nombre)}</span></div>${i.nota ? `<div class="t-note">→ ${esc(i.nota)}</div>` : ''}`).join('')}
    ${v.nota ? `<div class="t-sep"></div><div class="t-note">Nota: ${esc(v.nota)}</div>` : ''}
  </div>`;
}

export function imprimir(html) {
  let area = document.getElementById('print-area');
  if (!area) { area = document.createElement('div'); area.id = 'print-area'; document.body.appendChild(area); }
  area.innerHTML = html;
  const imgs = Array.from(area.querySelectorAll('img'));
  Promise.all(imgs.map((i) => (i.complete ? 1 : new Promise((r) => { i.onload = i.onerror = r; })))).then(() => {
    window.print();
  });
}

export function textoComprobante(v, cfg) {
  const lineas = [
    `*${cfg.negocio_nombre || 'MULAN'}*`,
    `Comprobante ${v.numero ? '#' + v.numero : '(provisional)'} - ${fechaCorta(v.fecha_pago || v.fecha)}`,
    '',
    ...(v.items || []).map((i) => `${num(i.cantidad)} x ${i.nombre}  ${money(i.total)}`),
    ''
  ];
  if (v.descuento > 0) lineas.push(`Descuentos: -${money(v.descuento)}`);
  if (v.domicilio > 0) lineas.push(`Domicilio: ${money(v.domicilio)}`);
  lineas.push(`*TOTAL: ${money(v.total)}*`);
  if (cfg.mensaje_comprobante) lineas.push('', cfg.mensaje_comprobante);
  return lineas.join('\n');
}

export function enviarWhatsApp(v, cfg, telefono) {
  let tel = String(telefono || v.telefono || '').replace(/\D/g, '');
  if (tel.length === 10) tel = '57' + tel; // celular Colombia
  const url = `https://wa.me/${tel}?text=${encodeURIComponent(textoComprobante(v, cfg))}`;
  window.open(url, '_blank', 'noopener');
}

export async function compartir(v, cfg) {
  const text = textoComprobante(v, cfg);
  if (navigator.share) {
    try { await navigator.share({ title: 'Comprobante', text }); return true; } catch (e) { return false; }
  }
  await navigator.clipboard.writeText(text);
  return 'copiado';
}
