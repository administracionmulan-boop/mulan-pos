// Cálculo de totales en el dispositivo (misma lógica que el backend: Ventas.guardar y promoDescuento_).
// Permite mostrar totales y emitir comprobantes también sin conexión. El servidor recalcula al guardar.

export function ymdLocal(d = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function diaSemana(ymd) {
  const [y, m, d] = ymd.split('-').map(Number);
  return ((new Date(Date.UTC(y, m - 1, d)).getUTCDay() + 6) % 7) + 1;
}

export function promoDescuento(producto, ymd, promociones) {
  const dia = String(diaSemana(ymd));
  let mejor = { valor: 0, promo: '' };
  for (const p of promociones || []) {
    if (!p.activo) continue;
    if (p.desde && ymd < p.desde) continue;
    if (p.hasta && ymd > p.hasta) continue;
    if (p.dias && !String(p.dias).split(',').map((x) => x.trim()).includes(dia)) continue;
    if (p.alcance === 'PRODUCTO' && p.ref_id !== producto.id) continue;
    if (p.alcance === 'CATEGORIA' && p.ref_id !== producto.categoria_id) continue;
    const v = Math.round(p.tipo === 'PORCENTAJE' ? (producto.precio * p.valor) / 100 : Math.min(p.valor, producto.precio));
    if (v > mejor.valor) mejor = { valor: v, promo: p.nombre };
  }
  return mejor;
}

const r2 = (v) => Math.round(v * 100) / 100;

/**
 * pedido: {tipo, items:[{producto_id, cantidad, descuento_manual, nota}], descuento, domicilio}
 * Devuelve líneas calculadas y totales.
 */
export function totales(pedido, catalogo, ymd = ymdLocal()) {
  const prods = Object.fromEntries(catalogo.productos.map((p) => [p.id, p]));
  const lineas = pedido.items.map((it) => {
    const p = prods[it.producto_id] || { precio: it.precio || 0, nombre: it.nombre || '?', costo: 0 };
    const bruto = r2(p.precio * it.cantidad);
    const promo = promoDescuento(p, ymd, catalogo.promociones);
    const desc = Math.min(bruto, r2(promo.valor * it.cantidad + Math.max(0, Number(it.descuento_manual) || 0)));
    return { ...it, nombre: p.nombre, precio: p.precio, descuento: desc, promo: promo.promo, total: r2(bruto - desc), costo: r2((p.costo || 0) * it.cantidad) };
  });
  const subtotal = r2(lineas.reduce((a, l) => a + l.precio * l.cantidad, 0));
  const netoLineas = r2(lineas.reduce((a, l) => a + l.total, 0));
  const descGlobal = Math.min(Math.max(0, Number(pedido.descuento) || 0), netoLineas);
  const domicilio = pedido.tipo === 'DOMICILIO' ? Math.max(0, Number(pedido.domicilio) || 0) : 0;
  const total = Math.round(netoLineas - descGlobal + domicilio);
  const pct = Number(catalogo.config.impuesto_pct) || 0;
  const gravable = total - domicilio;
  const impuesto = pct > 0 ? Math.round(gravable - gravable / (1 + pct / 100)) : 0;
  const manual = lineas.reduce((a, l) => a + (Number(l.descuento_manual) || 0), 0) + descGlobal;
  return {
    lineas, subtotal, descuento: r2(subtotal - netoLineas + descGlobal), domicilio, impuesto, total,
    manual, manualPct: subtotal > 0 ? (manual / subtotal) * 100 : 0,
    unidades: lineas.reduce((a, l) => a + l.cantidad, 0)
  };
}
