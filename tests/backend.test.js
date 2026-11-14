/**
 * Pruebas del backend por etapas (ejecuta el código real de /backend sobre el simulador de Apps Script).
 * node --test tests/
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { createRuntime } = require('../dev/gas-runtime');

function nuevo(now = '2026-11-09T15:00:00Z') {
  const rt = createRuntime({ now });
  const ok = (action, data, token) => {
    const r = rt.call(action, data, token);
    if (!r.ok) throw new Error(`${action}: ${r.error}`);
    return r.data;
  };
  const fail = (action, data, token) => {
    const r = rt.call(action, data, token);
    assert.equal(r.ok, false, `${action} debía fallar`);
    return r;
  };
  return { rt, ok, fail };
}

/** Escenario base: admin, cajero, insumos, productos con receta. */
function escenario() {
  const t = nuevo();
  const { ok } = t;
  const adm = ok('auth.login', { usuario: 'admin', password: 'mulan2026' });
  const A = adm.token;
  ok('auth.cambiarClave', { actual: 'mulan2026', nueva: 'clave-admin', pin: '4321' }, A);
  ok('usuario.guardar', { nombre: 'Caro Cajera', usuario: 'caro', rol: 'CAJERO', password: 'cajera1' }, A);
  const C = ok('auth.login', { usuario: 'caro', password: 'cajera1' }).token;
  const cat = ok('catalogo.get', {}, A);
  const platos = cat.categorias.find((c) => c.nombre === 'Platos');
  const bebidas = cat.categorias.find((c) => c.nombre === 'Bebidas');
  const prov = ok('proveedor.guardar', { nombre: 'Carnes El Toro', telefono: '3001234567' }, A);
  const pollo = ok('insumo.guardar', { nombre: 'Pollo', unidad: 'g', stock_minimo: 1000, costo_unitario: 12, stock_inicial: 5000, proveedor_id: prov.id }, A);
  const arroz = ok('insumo.guardar', { nombre: 'Arroz', unidad: 'g', stock_minimo: 500, costo_unitario: 4, stock_inicial: 3000 }, A);
  const gaseosa = ok('insumo.guardar', { nombre: 'Gaseosa 400ml', unidad: 'und', stock_minimo: 6, costo_unitario: 1800, stock_inicial: 24 }, A);
  const arrozPollo = ok('producto.guardar', {
    nombre: 'Arroz con pollo', categoria_id: platos.id, precio: 18000, modificadores: 'Sin cebolla,Extra salsa',
    receta: [{ insumo_id: pollo.id, cantidad: 250 }, { insumo_id: arroz.id, cantidad: 200 }]
  }, A);
  const coca = ok('producto.guardar', { nombre: 'Gaseosa', categoria_id: bebidas.id, precio: 4000, receta: [{ insumo_id: gaseosa.id, cantidad: 1 }] }, A);
  return { ...t, A, C, platos, bebidas, prov, pollo, arroz, gaseosa, arrozPollo, coca };
}

const stock = (ok, A, id) => ok('catalogo.get', {}, A).insumos.find((i) => i.id === id).stock;

// ---------------- Etapa 0 ----------------
test('Etapa 0 · setup crea hojas, config y admin; login y permisos', () => {
  const { rt, ok, fail } = nuevo();
  ['Config', 'Usuarios', 'Ventas', 'VentaItems', 'Pagos', 'Cajas', 'MovInventario', 'Recetas', 'Auditoria'].forEach((h) => assert.ok(rt.ss.getSheetByName(h), h));
  fail('auth.login', { usuario: 'admin', password: 'mala' });
  const s = ok('auth.login', { usuario: 'ADMIN', password: 'mulan2026' });
  assert.equal(s.usuario.rol, 'ADMIN');
  assert.equal(s.usuario.debe_cambiar, true);
  assert.equal(fail('catalogo.get', {}).code, 401);
  assert.equal(fail('catalogo.get', {}, 'token-falso').code, 401);
  ok('usuario.guardar', { nombre: 'Juan', usuario: 'juan', rol: 'CAJERO', password: '123456' }, s.token);
  fail('usuario.guardar', { nombre: 'Juan2', usuario: 'juan', rol: 'CAJERO', password: '123456' }, s.token); // duplicado
  const c = ok('auth.login', { usuario: 'juan', password: '123456' });
  assert.equal(fail('usuario.listar', {}, c.token).code, 403);
  assert.equal(fail('producto.guardar', { nombre: 'x' }, c.token).code, 403);
  assert.equal(fail('reporte.ventas', {}, c.token).code, 403);
  // clave y PIN
  fail('auth.cambiarClave', { actual: 'mala', nueva: 'nuevaclave' }, s.token);
  ok('auth.cambiarClave', { actual: 'mulan2026', nueva: 'nuevaclave', pin: '9999' }, s.token);
  fail('auth.login', { usuario: 'admin', password: 'mulan2026' });
  ok('auth.login', { usuario: 'admin', password: 'nuevaclave' });
  // desactivar usuario cierra sus sesiones
  const juan = ok('usuario.listar', {}, s.token).find((u) => u.usuario === 'juan');
  ok('usuario.guardar', { id: juan.id, activo: false }, s.token);
  assert.equal(fail('caja.estado', {}, c.token).code, 401);
  fail('usuario.guardar', { id: s.usuario.id, activo: false }, s.token); // no se desactiva a sí mismo
  ok('auth.logout', {}, s.token);
  assert.equal(fail('auth.yo', {}, s.token).code, 401);
  assert.ok(ok('auditoria.listar', {}, ok('auth.login', { usuario: 'admin', password: 'nuevaclave' }).token).length > 0);
});

test('Etapa 0 · primera apertura de /exec crea la base automáticamente', () => {
  const { rt } = nuevo();
  // simula un Sheet vacío recién creado
  Object.keys(rt.ss.sheets).forEach((n) => delete rt.ss.sheets[n]);
  rt.ctx.Db.reset();
  const out = rt.ctx.doGet().getContent();
  assert.match(out, /servidor activo/);
  assert.match(out, /mulan2026/);
  assert.ok(rt.ss.getSheetByName('Ventas'));
  assert.doesNotMatch(rt.ctx.doGet().getContent(), /mulan2026/); // la segunda vez no muestra la clave
  // y también si la primera petición es directamente de la API
  Object.keys(rt.ss.sheets).forEach((n) => delete rt.ss.sheets[n]);
  rt.ctx.Db.reset();
  assert.equal(rt.call('auth.login', { usuario: 'admin', password: 'mulan2026' }).ok, true);
});

test('Etapa 0 · acción desconocida y petición inválida', () => {
  const { rt } = nuevo();
  assert.equal(JSON.parse(rt.post('no-json')).ok, false);
  assert.equal(rt.call('nada', {}).code, 404);
  assert.equal(JSON.parse(rt.post(JSON.stringify({ action: 'ping' }))).data.app, 'MULAN POS');
});

// ---------------- Etapas 1-3 ----------------
test('Etapa 1 · catálogo: categorías, productos, insumos, proveedores, promociones', () => {
  const s = escenario();
  const { ok, fail, A } = s;
  fail('categoria.guardar', { nombre: 'platos' }, A); // duplicada
  const cat = ok('categoria.guardar', { nombre: 'Corrientazo', color: '#000000' }, A);
  ok('categoria.guardar', { id: cat.id, nombre: 'Almuerzos', color: '#111111', orden: 1 }, A);
  fail('producto.guardar', { nombre: 'X', categoria_id: 'nope', precio: 1 }, A);
  fail('producto.guardar', { nombre: 'X', categoria_id: cat.id, precio: -5 }, A);
  fail('insumo.guardar', { nombre: 'pollo', unidad: 'g' }, A);
  const c = ok('catalogo.get', {}, A);
  assert.equal(c.categorias.find((x) => x.id === cat.id).nombre, 'Almuerzos');
  assert.equal(c.productos.length, 2);
  assert.equal(c.config.negocio_nombre, 'MULAN');
  fail('promocion.guardar', { nombre: 'P', tipo: 'PORCENTAJE', valor: 150, alcance: 'TODO' }, A);
  fail('promocion.guardar', { nombre: 'P', tipo: 'VALOR', valor: 1000, alcance: 'PRODUCTO' }, A);
  ok('promocion.guardar', { nombre: '2x', tipo: 'VALOR', valor: 1000, alcance: 'PRODUCTO', ref_id: s.coca.id }, A);
  ok('config.guardar', { negocio_nombre: 'MULAN Comidas', impuesto_pct: 8, clave_rara: 'x' }, A);
  const cfg = ok('catalogo.get', {}, A).config;
  assert.equal(cfg.negocio_nombre, 'MULAN Comidas');
  assert.equal(cfg.clave_rara, undefined);
});

test('Etapa 2 · recetas: costo de preparación y margen', () => {
  const s = escenario();
  const { ok, fail, A } = s;
  const p = ok('catalogo.get', {}, A).productos.find((x) => x.id === s.arrozPollo.id);
  assert.equal(p.costo, 250 * 12 + 200 * 4); // 3800
  assert.equal(p.utilidad, 18000 - 3800);
  assert.equal(p.margen, 78.9);
  assert.equal(p.receta.length, 2);
  // receta reemplazable y validación de duplicados
  fail('producto.guardar', { ...s.arrozPollo, receta: [{ insumo_id: s.pollo.id, cantidad: 1 }, { insumo_id: s.pollo.id, cantidad: 2 }] }, A);
  const p2 = ok('producto.guardar', { id: s.arrozPollo.id, nombre: 'Arroz con pollo', categoria_id: s.platos.id, precio: 20000, receta: [{ insumo_id: s.pollo.id, cantidad: 300 }] }, A);
  assert.equal(p2.costo, 3600);
  assert.equal(p2.receta.length, 1);
});

test('Etapa 3 · inventario: compra con costo promedio, ajustes, kardex y alertas', () => {
  const s = escenario();
  const { ok, fail, A } = s;
  // compra 5000 g de pollo a $14 -> promedio (5000*12 + 5000*14)/10000 = 13
  const compra = ok('inventario.compra', { proveedor_id: s.prov.id, factura: 'F-1', items: [{ insumo_id: s.pollo.id, cantidad: 5000, costo_unitario: 14 }] }, A);
  assert.equal(compra.total, 70000);
  let ins = ok('catalogo.get', {}, A).insumos.find((i) => i.id === s.pollo.id);
  assert.equal(ins.stock, 10000);
  assert.equal(ins.costo_unitario, 13);
  // el costo del plato se actualiza con el costo promedio
  assert.equal(ok('catalogo.get', {}, A).productos.find((p) => p.id === s.arrozPollo.id).costo, 250 * 13 + 200 * 4);
  fail('inventario.compra', { items: [] }, A);
  fail('inventario.compra', { items: [{ insumo_id: s.pollo.id, cantidad: 0, costo_unitario: 1 }] }, A);
  fail('inventario.compra', { pagado_caja: true, items: [{ insumo_id: s.pollo.id, cantidad: 1, costo_unitario: 1 }] }, A); // sin caja
  // ajustes
  fail('inventario.ajuste', { insumo_id: s.pollo.id, tipo: 'DESPERDICIO', cantidad: 100 }, A); // requiere motivo
  ok('inventario.ajuste', { insumo_id: s.pollo.id, tipo: 'DESPERDICIO', cantidad: 500, nota: 'Se dañó' }, A);
  assert.equal(stock(ok, A, s.pollo.id), 9500);
  ok('inventario.ajuste', { insumo_id: s.pollo.id, tipo: 'CONTEO', cantidad: 9000, nota: 'Conteo físico' }, A);
  assert.equal(stock(ok, A, s.pollo.id), 9000);
  const k = ok('inventario.kardex', { insumo_id: s.pollo.id }, A);
  assert.deepEqual(k.map((m) => m.tipo).sort(), ['COMPRA', 'CONTEO', 'DESPERDICIO', 'INICIAL']);
  // alertas: arroz bajo mínimo
  ok('inventario.ajuste', { insumo_id: s.arroz.id, tipo: 'AJUSTE_SALIDA', cantidad: 2600, nota: 'Prueba' }, A);
  const al = ok('inventario.alertas', {}, s.C);
  assert.equal(al.length, 1);
  assert.equal(al[0].nombre, 'Arroz');
  assert.equal(al[0].alerta, 'BAJO');
  assert.equal(ok('inventario.compras', {}, A)[0].items[0].insumo, 'Pollo');
  assert.equal(s.fail('inventario.compra', { items: [] }, s.C).code, 403);
});

// ---------------- Etapas 4-5 ----------------
test('Etapa 4 · caja: apertura, movimientos, arqueo y cierre', () => {
  const s = escenario();
  const { ok, fail, C, A } = s;
  assert.equal(ok('caja.estado', {}, C).abierta, false);
  fail('venta.guardar', { tipo: 'LLEVAR', items: [{ producto_id: s.coca.id, cantidad: 1 }] }, C); // sin caja
  ok('caja.abrir', { base: 100000, turno: 'Mañana' }, C);
  fail('caja.abrir', { base: 1 }, C);
  ok('caja.movimiento', { tipo: 'INGRESO', valor: 20000, concepto: 'Sencillo' }, C);
  ok('caja.movimiento', { tipo: 'EGRESO', valor: 15000, concepto: 'Hielo' }, C);
  ok('caja.movimiento', { tipo: 'RETIRO', valor: 50000, concepto: 'Retiro a caja fuerte' }, C);
  fail('caja.movimiento', { tipo: 'RETIRO', valor: 999999, concepto: 'Demasiado' }, C);
  fail('caja.movimiento', { tipo: 'RETIRO', valor: 10, concepto: '' }, C);
  // movimiento idempotente
  ok('caja.movimiento', { id: 'mov-1', tipo: 'INGRESO', valor: 1000, concepto: 'x' }, C);
  assert.equal(ok('caja.movimiento', { id: 'mov-1', tipo: 'INGRESO', valor: 1000, concepto: 'x' }, C).duplicado, true);
  ok('venta.guardar', { tipo: 'LLEVAR', items: [{ producto_id: s.coca.id, cantidad: 2 }], pagos: [{ metodo: 'EFECTIVO', valor: 8000, recibido: 10000 }] }, C);
  ok('venta.guardar', { tipo: 'LLEVAR', items: [{ producto_id: s.arrozPollo.id, cantidad: 1 }], pagos: [{ metodo: 'TARJETA', valor: 18000 }] }, C);
  const e = ok('caja.estado', {}, C).caja;
  assert.equal(e.resumen.efectivo_esperado, 100000 + 20000 - 15000 - 50000 + 1000 + 8000); // 64000
  assert.equal(e.resumen.ventas_por_metodo.TARJETA, 18000);
  assert.equal(e.resumen.num_ventas, 2);
  const cierre = ok('caja.cerrar', { real: 63000, notas: 'Faltan 1000' }, C);
  assert.equal(cierre.estado, 'CERRADA');
  assert.equal(cierre.esperado, 64000);
  assert.equal(cierre.diferencia, -1000);
  assert.equal(cierre.ventas, 26000);
  // historial: cajera ve lo suyo, admin ve todo
  assert.equal(ok('caja.historial', {}, C).length, 1);
  ok('caja.abrir', { base: 0, turno: 'Tarde' }, A);
  assert.equal(ok('caja.historial', {}, C).length, 1);
  assert.equal(ok('caja.historial', {}, A).length, 2);
  assert.equal(fail('caja.detalle', { id: ok('caja.historial', {}, A).find((c) => c.cajero === 'Administrador').id }, C).code, 403);
});

test('Etapa 5 · POS: comanda de mesa, cobro mixto, impuesto, promociones e inventario', () => {
  const s = escenario();
  const { ok, fail, C, A } = s;
  ok('config.guardar', { impuesto_pct: 8 }, A);
  ok('promocion.guardar', { nombre: 'Gaseosa -$1000', tipo: 'VALOR', valor: 1000, alcance: 'PRODUCTO', ref_id: s.coca.id }, A);
  ok('caja.abrir', { base: 50000 }, C);
  // comanda en mesa
  const id = 'venta-mesa-1';
  const v1 = ok('venta.guardar', { id, tipo: 'MESA', mesa: 'Mesa 1', items: [{ producto_id: s.arrozPollo.id, cantidad: 2, nota: 'Sin cebolla' }] }, C).venta;
  assert.equal(v1.estado, 'ABIERTA');
  assert.equal(v1.numero, 1);
  assert.equal(stock(ok, A, s.pollo.id), 5000); // aún no descuenta
  fail('venta.guardar', { tipo: 'MESA', mesa: 'Mesa 1', items: [{ producto_id: s.coca.id, cantidad: 1 }] }, C); // mesa ocupada
  fail('venta.guardar', { tipo: 'MESA', items: [{ producto_id: s.coca.id, cantidad: 1 }] }, C);
  fail('venta.guardar', { tipo: 'DOMICILIO', items: [{ producto_id: s.coca.id, cantidad: 1 }] }, C);
  assert.equal(ok('venta.abiertas', {}, C).length, 1);
  // agregar productos a la comanda
  ok('venta.guardar', { id, tipo: 'MESA', mesa: 'Mesa 1', items: [{ producto_id: s.arrozPollo.id, cantidad: 2, nota: 'Sin cebolla' }, { producto_id: s.coca.id, cantidad: 2 }] }, C);
  // pagos que no cuadran
  fail('venta.guardar', { id, tipo: 'MESA', mesa: 'Mesa 1', items: [{ producto_id: s.arrozPollo.id, cantidad: 2 }, { producto_id: s.coca.id, cantidad: 2 }], pagos: [{ metodo: 'EFECTIVO', valor: 1000 }] }, C);
  fail('venta.guardar', { id, tipo: 'MESA', mesa: 'Mesa 1', items: [{ producto_id: s.arrozPollo.id, cantidad: 2 }, { producto_id: s.coca.id, cantidad: 2 }], pagos: [{ metodo: 'BITCOIN', valor: 42000 }] }, C);
  // total = 2*18000 + 2*(4000-1000) = 42000; cobro mixto
  const v = ok('venta.guardar', {
    id, tipo: 'MESA', mesa: 'Mesa 1',
    items: [{ producto_id: s.arrozPollo.id, cantidad: 2, nota: 'Sin cebolla' }, { producto_id: s.coca.id, cantidad: 2 }],
    pagos: [{ metodo: 'TRANSFERENCIA', valor: 20000, referencia: 'Nequi 123' }, { metodo: 'EFECTIVO', valor: 22000, recibido: 50000 }]
  }, C).venta;
  assert.equal(v.estado, 'PAGADA');
  assert.equal(v.subtotal, 44000);
  assert.equal(v.descuento, 2000);
  assert.equal(v.total, 42000);
  assert.equal(v.impuesto, Math.round(42000 - 42000 / 1.08)); // 3111
  assert.equal(v.costo, 2 * 3800 + 2 * 1800);
  assert.equal(v.pagos.find((p) => p.metodo === 'EFECTIVO').cambio, 28000);
  assert.ok(v.items[1].nota.includes('Promo'));
  // inventario descontado por receta
  assert.equal(stock(ok, A, s.pollo.id), 5000 - 500);
  assert.equal(stock(ok, A, s.arroz.id), 3000 - 400);
  assert.equal(stock(ok, A, s.gaseosa.id), 22);
  // reenvío idempotente (sincronización): no duplica
  const dup = ok('venta.guardar', { id, tipo: 'MESA', mesa: 'Mesa 1', items: [{ producto_id: s.coca.id, cantidad: 9 }], pagos: [{ metodo: 'EFECTIVO', valor: 1 }] }, C);
  assert.equal(dup.duplicado, true);
  assert.equal(stock(ok, A, s.gaseosa.id), 22);
  // domicilio con valor de envío
  const d = ok('venta.guardar', { tipo: 'DOMICILIO', cliente: 'Ana', telefono: '300', direccion: 'Cra 1 # 2-3', domicilio: 3000, items: [{ producto_id: s.arrozPollo.id, cantidad: 1 }], pagos: [{ metodo: 'EFECTIVO', valor: 21000, recibido: 21000 }] }, C).venta;
  assert.equal(d.total, 21000);
  assert.equal(d.numero, 2);
  assert.equal(ok('venta.listar', {}, C).length, 2);
});

test('Etapa 5 · descuentos manuales sobre el tope requieren PIN de administrador', () => {
  const s = escenario();
  const { ok, fail, C } = s;
  ok('caja.abrir', { base: 0 }, C);
  const base = { tipo: 'LLEVAR', items: [{ producto_id: s.arrozPollo.id, cantidad: 1 }] };
  // 10% permitido al cajero
  ok('venta.guardar', { ...base, descuento: 1800, pagos: [{ metodo: 'EFECTIVO', valor: 16200 }] }, C);
  const r = fail('venta.guardar', { ...base, descuento: 5000, pagos: [{ metodo: 'EFECTIVO', valor: 13000 }] }, C);
  assert.equal(r.code, 403);
  fail('venta.guardar', { ...base, descuento: 5000, autorizacion: { usuario: 'admin', pin: '0000' }, pagos: [{ metodo: 'EFECTIVO', valor: 13000 }] }, C);
  const v = ok('venta.guardar', { ...base, descuento: 5000, autorizacion: { usuario: 'admin', pin: '4321' }, pagos: [{ metodo: 'EFECTIVO', valor: 13000 }] }, C).venta;
  assert.equal(v.autorizado_por_nombre, 'Administrador');
  // descuento por línea
  const v2 = ok('venta.guardar', { tipo: 'LLEVAR', items: [{ producto_id: s.coca.id, cantidad: 2, descuento_manual: 500 }], pagos: [{ metodo: 'EFECTIVO', valor: 7500 }] }, C).venta;
  assert.equal(v2.total, 7500);
});

test('Etapa 5 · anulación y devolución con autorización', () => {
  const s = escenario();
  const { ok, fail, C, A } = s;
  ok('caja.abrir', { base: 100000 }, C);
  const v = ok('venta.guardar', { tipo: 'LLEVAR', items: [{ producto_id: s.arrozPollo.id, cantidad: 2 }, { producto_id: s.coca.id, cantidad: 1 }], pagos: [{ metodo: 'EFECTIVO', valor: 40000 }] }, C).venta;
  assert.equal(stock(ok, A, s.pollo.id), 4500);
  // anular sin autorización falla
  assert.equal(fail('venta.anular', { id: v.id, motivo: 'Error' }, C).code, 403);
  fail('venta.anular', { id: v.id, motivo: 'Error', autorizacion: { usuario: 'caro', pin: '4321' } }, C);
  fail('venta.anular', { id: v.id, autorizacion: { usuario: 'admin', pin: '4321' } }, C); // sin motivo
  const an = ok('venta.anular', { id: v.id, motivo: 'Cliente se fue', autorizacion: { usuario: 'admin', pin: '4321' } }, C);
  assert.equal(an.estado, 'ANULADA');
  assert.equal(stock(ok, A, s.pollo.id), 5000); // inventario restaurado
  assert.equal(ok('caja.estado', {}, C).caja.resumen.efectivo_esperado, 100000); // dinero revertido
  fail('venta.anular', { id: v.id, motivo: 'otra vez', autorizacion: { usuario: 'admin', pin: '4321' } }, C);

  // devolución parcial
  const v2 = ok('venta.guardar', { tipo: 'LLEVAR', items: [{ producto_id: s.arrozPollo.id, cantidad: 2 }, { producto_id: s.coca.id, cantidad: 2 }], descuento: 4400, pagos: [{ metodo: 'EFECTIVO', valor: 39600 }] }, C).venta;
  const itCoca = v2.items.find((i) => i.producto_id === s.coca.id);
  fail('venta.devolver', { id: v2.id, motivo: 'x', metodo: 'EFECTIVO', items: [{ item_id: itCoca.id, cantidad: 3 }], autorizacion: { usuario: 'admin', pin: '4321' } }, C);
  const dv = ok('venta.devolver', { id: v2.id, motivo: 'Gaseosa sin gas', metodo: 'EFECTIVO', reintegrar: true, items: [{ item_id: itCoca.id, cantidad: 1 }], autorizacion: { usuario: 'admin', pin: '4321' } }, C);
  // 4000 * (39600/44000) = 3600
  assert.equal(dv.devuelto, 3600);
  assert.equal(dv.estado, 'PAGADA');
  assert.equal(stock(ok, A, s.gaseosa.id), 24 - 2 + 1);
  assert.equal(ok('caja.estado', {}, C).caja.resumen.efectivo_esperado, 100000 + 39600 - 3600);
  fail('venta.anular', { id: v2.id, motivo: 'x', autorizacion: { usuario: 'admin', pin: '4321' } }, C);
  // comanda abierta anulada no toca inventario
  const ab = ok('venta.guardar', { tipo: 'MESA', mesa: 'Mesa 2', items: [{ producto_id: s.coca.id, cantidad: 1 }] }, C).venta;
  ok('venta.anular', { id: ab.id, motivo: 'Pedido duplicado' }, A); // admin no necesita PIN
  assert.equal(stock(ok, A, s.gaseosa.id), 23);
});

// ---------------- Etapas 6-7 ----------------
test('Etapa 6 · sincronización de ventas offline (ordenada e idempotente)', () => {
  const s = escenario();
  const { ok, C, A } = s;
  const caja = ok('caja.abrir', { base: 0 }, C).caja;
  const ops = [
    { op_id: 'o1', action: 'venta.guardar', data: { id: 'off-1', origen: 'OFFLINE', caja_id: caja.id, fecha: '2026-11-09T14:00:00Z', tipo: 'LLEVAR', items: [{ producto_id: s.coca.id, cantidad: 1 }], pagos: [{ metodo: 'EFECTIVO', valor: 4000 }] } },
    { op_id: 'o2', action: 'caja.movimiento', data: { id: 'm-off', tipo: 'INGRESO', valor: 500, concepto: 'Propina' } },
    { op_id: 'o3', action: 'venta.guardar', data: { id: 'off-2', tipo: 'LLEVAR', items: [{ producto_id: 'no-existe', cantidad: 1 }], pagos: [{ metodo: 'EFECTIVO', valor: 1 }] } },
    { op_id: 'o4', action: 'usuario.guardar', data: {} }
  ];
  const r = ok('sync', { ops }, C);
  assert.deepEqual(r.map((x) => x.ok), [true, true, false, false]);
  assert.equal(ok('venta.detalle', { id: 'off-1' }, C).fecha, '2026-11-09 09:00:00'); // hora local Bogotá
  assert.equal(ok('venta.detalle', { id: 'off-1' }, C).origen, 'OFFLINE');
  const r2 = ok('sync', { ops: ops.slice(0, 2) }, C);
  assert.equal(r2[0].data.duplicado, true);
  assert.equal(r2[1].data.duplicado, true);
  assert.equal(stock(ok, A, s.gaseosa.id), 23);
});

test('Etapa 7 · reportes: KPIs, series, más/menos vendidos, medios de pago, compras y gastos', () => {
  const s = escenario();
  const { ok, C, A, rt } = s;
  ok('caja.abrir', { base: 0 }, C);
  ok('venta.guardar', { tipo: 'LLEVAR', items: [{ producto_id: s.arrozPollo.id, cantidad: 3 }], pagos: [{ metodo: 'EFECTIVO', valor: 54000 }] }, C);
  ok('venta.guardar', { tipo: 'LLEVAR', items: [{ producto_id: s.coca.id, cantidad: 1 }], pagos: [{ metodo: 'TRANSFERENCIA', valor: 4000 }] }, C);
  ok('caja.movimiento', { tipo: 'EGRESO', valor: 5000, concepto: 'Gas' }, C);
  ok('inventario.compra', { items: [{ insumo_id: s.arroz.id, cantidad: 1000, costo_unitario: 4 }] }, A);
  // venta en otro mes
  rt.ctx.__setNow('2026-10-15T18:00:00Z');
  ok('venta.guardar', { tipo: 'LLEVAR', items: [{ producto_id: s.coca.id, cantidad: 5 }], pagos: [{ metodo: 'EFECTIVO', valor: 20000 }] }, C);
  rt.ctx.__setNow('2026-11-09T15:00:00Z');

  const m = ok('reporte.ventas', { desde: '2026-11-01', hasta: '2026-11-30' }, A);
  assert.equal(m.kpis.ventas_netas, 58000);
  assert.equal(m.kpis.num_ventas, 2);
  assert.equal(m.kpis.ticket_promedio, 29000);
  assert.equal(m.kpis.costo, 3 * 3800 + 1800);
  assert.equal(m.kpis.ganancia_bruta, 58000 - 13200);
  assert.equal(m.mas_vendidos[0].nombre, 'Arroz con pollo');
  assert.equal(m.metodos.find((x) => x.metodo === 'EFECTIVO').valor, 54000);
  assert.equal(m.compras.total, 4000);
  assert.equal(m.gastos.total, 5000);
  assert.equal(m.utilidad_operativa, 58000 - 13200 - 5000);
  assert.equal(m.serie.length, 30);
  assert.equal(m.anterior.ventas_netas, 20000);
  assert.ok(m.inventario.valor > 0);

  const anual = ok('reporte.ventas', { desde: '2026-01-01', hasta: '2026-12-31', agrupar: 'mes' }, A);
  assert.equal(anual.serie.length, 12);
  assert.equal(anual.serie.find((x) => x.periodo === '2026-10').ventas, 20000);
  assert.equal(anual.mas_vendidos[0].nombre, 'Gaseosa');
  const sem = ok('reporte.ventas', { desde: '2026-11-09', hasta: '2026-11-15', agrupar: 'semana' }, A);
  assert.equal(sem.serie.length, 1);
  assert.equal(sem.serie[0].periodo, '2026-11-09');

  const dash = ok('reporte.dashboard', {}, C);
  assert.equal(dash.kpis.ventas_netas, 58000);
  assert.equal(dash.kpis.ganancia_bruta, undefined); // el cajero no ve ganancias
  assert.equal(dash.caja.resumen.num_ventas, 3); // la venta simulada de octubre quedó en la misma caja
});

test('Datos: la hoja crece más allá de su tamaño inicial', () => {
  const s = escenario();
  const { ok, C, rt } = s;
  rt.ss.getSheetByName('Pagos').maxRows = 3;
  rt.ss.getSheetByName('VentaItems').maxRows = 3;
  ok('caja.abrir', { base: 0 }, C);
  for (let i = 0; i < 5; i++) ok('venta.guardar', { tipo: 'LLEVAR', items: [{ producto_id: s.coca.id, cantidad: 1 }], pagos: [{ metodo: 'EFECTIVO', valor: 4000 }] }, C);
  assert.equal(ok('venta.listar', {}, C).length, 5);
});
