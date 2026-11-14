/**
 * MULAN POS - Reportes e indicadores (diario, semanal, mensual, anual).
 */
var Reportes = {
  claveGrupo_: function (ymd, agrupar) {
    if (agrupar === 'semana') return lunes_(ymd);
    if (agrupar === 'mes') return ymd.substring(0, 7);
    return ymd;
  },

  claves_: function (desde, hasta, agrupar) {
    var keys = [], vistos = {};
    var n = diasEntre_(desde, hasta);
    if (n > 800) return keys;
    for (var i = 0; i <= n; i++) {
      var k = Reportes.claveGrupo_(sumarDias_(desde, i), agrupar);
      if (!vistos[k]) { vistos[k] = 1; keys.push(k); }
    }
    return keys;
  },

  /** Cálculos base sobre ventas cobradas en el rango. */
  base_: function (desde, hasta) {
    var hastaF = hasta + ' 99';
    var ventas = Db.where('Ventas', function (v) {
      var f = v.fecha_pago || v.fecha;
      return (v.estado === 'PAGADA' || v.estado === 'DEVUELTA') && f >= desde && f <= hastaF;
    });
    var ids = indexBy_(ventas);
    var items = Db.where('VentaItems', function (i) { return !!ids[i.venta_id]; });
    var costoNeto = 0;
    items.forEach(function (i) { costoNeto += i.cantidad > 0 ? i.costo * (i.cantidad - i.devuelto) / i.cantidad : 0; });
    var brutas = sum_(ventas, function (v) { return v.total; });
    var devol = sum_(ventas, function (v) { return v.devuelto; });
    var netas = brutas - devol;
    var impuestos = sum_(ventas, function (v) { return v.total > 0 ? v.impuesto * (v.total - v.devuelto) / v.total : 0; });
    var ganancia = netas - impuestos - costoNeto;
    return {
      ventas: ventas, items: items,
      kpis: {
        ventas_brutas: round_(brutas), devoluciones: round_(devol), ventas_netas: round_(netas),
        num_ventas: ventas.length, ticket_promedio: ventas.length ? round_(netas / ventas.length) : 0,
        descuentos: round_(sum_(ventas, function (v) { return v.descuento; })),
        domicilios: round_(sum_(ventas, function (v) { return v.domicilio; })),
        impuestos: round_(impuestos), costo: round_(costoNeto), ganancia_bruta: round_(ganancia),
        margen: netas > 0 ? round_(ganancia / netas * 100, 1) : 0
      }
    };
  },

  ventas: function (d) {
    var desde = str_(d.desde) || hoy_().substring(0, 8) + '01';
    var hasta = str_(d.hasta) || hoy_();
    if (hasta < desde) throw AppError('Rango de fechas inválido');
    var agrupar = ['dia', 'semana', 'mes'].indexOf(d.agrupar) >= 0 ? d.agrupar : (diasEntre_(desde, hasta) > 62 ? 'mes' : 'dia');
    var b = Reportes.base_(desde, hasta);
    var hastaF = hasta + ' 99';

    // período anterior de igual duración
    var dur = diasEntre_(desde, hasta);
    var antHasta = sumarDias_(desde, -1), antDesde = sumarDias_(antHasta, -dur);
    var ant = Reportes.base_(antDesde, antHasta).kpis;

    // serie temporal
    var serie = {};
    Reportes.claves_(desde, hasta, agrupar).forEach(function (k) { serie[k] = { periodo: k, ventas: 0, num: 0, ganancia: 0 }; });
    var ventaIdx = indexBy_(b.ventas);
    var costoVenta = {};
    b.items.forEach(function (i) { costoVenta[i.venta_id] = (costoVenta[i.venta_id] || 0) + (i.cantidad > 0 ? i.costo * (i.cantidad - i.devuelto) / i.cantidad : 0); });
    var horas = []; for (var h = 0; h < 24; h++) horas.push({ hora: h, ventas: 0, num: 0 });
    var tipos = {}, cajeros = {};
    var users = indexBy_(Db.all('Usuarios'));
    b.ventas.forEach(function (v) {
      var f = v.fecha_pago || v.fecha;
      var k = Reportes.claveGrupo_(f.substring(0, 10), agrupar);
      var neto = v.total - v.devuelto;
      var imp = v.total > 0 ? v.impuesto * neto / v.total : 0;
      if (!serie[k]) serie[k] = { periodo: k, ventas: 0, num: 0, ganancia: 0 };
      serie[k].ventas += neto; serie[k].num++; serie[k].ganancia += neto - imp - (costoVenta[v.id] || 0);
      var hr = parseInt(f.substring(11, 13), 10) || 0;
      horas[hr].ventas += neto; horas[hr].num++;
      tipos[v.tipo] = tipos[v.tipo] || { tipo: v.tipo, ventas: 0, num: 0 };
      tipos[v.tipo].ventas += neto; tipos[v.tipo].num++;
      var cn = users[v.usuario_id] ? users[v.usuario_id].nombre : '—';
      cajeros[cn] = cajeros[cn] || { cajero: cn, ventas: 0, num: 0 };
      cajeros[cn].ventas += neto; cajeros[cn].num++;
    });

    // productos y categorías
    var prods = {};
    var cats = indexBy_(Db.all('Categorias'));
    Db.all('Productos').forEach(function (p) {
      if (p.activo) prods[p.id] = { producto_id: p.id, nombre: p.nombre, categoria: cats[p.categoria_id] ? cats[p.categoria_id].nombre : '', cantidad: 0, ventas: 0, costo: 0 };
    });
    var prodIdx = indexBy_(Db.all('Productos'));
    b.items.forEach(function (i) {
      var v = ventaIdx[i.venta_id];
      if (!prods[i.producto_id]) {
        var pp = prodIdx[i.producto_id];
        prods[i.producto_id] = { producto_id: i.producto_id, nombre: i.nombre, categoria: pp && cats[pp.categoria_id] ? cats[pp.categoria_id].nombre : '', cantidad: 0, ventas: 0, costo: 0 };
      }
      var q = i.cantidad - i.devuelto;
      var pr = prods[i.producto_id];
      pr.cantidad += q;
      pr.ventas += i.cantidad > 0 ? i.total * q / i.cantidad : 0;
      pr.costo += i.cantidad > 0 ? i.costo * q / i.cantidad : 0;
    });
    var listaProd = Object.keys(prods).map(function (k) {
      var p = prods[k];
      p.ventas = round_(p.ventas); p.costo = round_(p.costo); p.utilidad = round_(p.ventas - p.costo);
      return p;
    });
    var porCant = listaProd.slice().sort(function (a, b2) { return b2.cantidad - a.cantidad || b2.ventas - a.ventas; });
    var catAgg = {};
    listaProd.forEach(function (p) {
      var c = p.categoria || 'Sin categoría';
      catAgg[c] = catAgg[c] || { categoria: c, cantidad: 0, ventas: 0 };
      catAgg[c].cantidad += p.cantidad; catAgg[c].ventas += p.ventas;
    });

    // medios de pago (netos de anulaciones y devoluciones)
    var metodos = {};
    Db.where('Pagos', function (p) { return p.fecha >= desde && p.fecha <= hastaF; }).forEach(function (p) {
      metodos[p.metodo] = metodos[p.metodo] || { metodo: p.metodo, valor: 0, num: 0 };
      metodos[p.metodo].valor += p.valor;
      if (p.tipo === 'VENTA') metodos[p.metodo].num++;
    });

    // compras y gastos
    var compras = Db.where('Compras', function (c) { return c.fecha >= desde && c.fecha <= hastaF; });
    var provs = indexBy_(Db.all('Proveedores'));
    var porProv = {};
    compras.forEach(function (c) {
      var n = provs[c.proveedor_id] ? provs[c.proveedor_id].nombre : 'Sin proveedor';
      porProv[n] = porProv[n] || { proveedor: n, total: 0, num: 0 };
      porProv[n].total += c.total; porProv[n].num++;
    });
    var compraIds = indexBy_(Db.all('Compras'));
    var gastos = Db.where('MovCaja', function (m) { return m.tipo === 'EGRESO' && m.fecha >= desde && m.fecha <= hastaF && !compraIds[m.referencia]; });
    var totalCompras = round_(sum_(compras, function (c) { return c.total; }));
    var totalGastos = round_(sum_(gastos, function (g) { return g.valor; }));

    // inventario disponible
    var insumos = Db.where('Insumos', function (i) { return i.activo; });
    var anuladas = Db.where('Ventas', function (v) { return v.estado === 'ANULADA' && v.fecha >= desde && v.fecha <= hastaF; });

    var r2 = function (o) { Object.keys(o).forEach(function (k) { if (typeof o[k] === 'number') o[k] = round_(o[k]); }); return o; };
    return {
      desde: desde, hasta: hasta, agrupar: agrupar,
      kpis: b.kpis,
      anterior: { desde: antDesde, hasta: antHasta, ventas_netas: ant.ventas_netas, num_ventas: ant.num_ventas, ganancia_bruta: ant.ganancia_bruta, ticket_promedio: ant.ticket_promedio },
      anuladas: { num: anuladas.length, valor: round_(sum_(anuladas, function (v) { return v.total; })) },
      serie: Object.keys(serie).sort().map(function (k) { return r2(serie[k]); }),
      horas: horas.map(r2),
      tipos: Object.keys(tipos).map(function (k) { return r2(tipos[k]); }),
      cajeros: Object.keys(cajeros).map(function (k) { return r2(cajeros[k]); }).sort(function (a, c) { return c.ventas - a.ventas; }),
      mas_vendidos: porCant.slice(0, 10),
      menos_vendidos: porCant.slice().reverse().slice(0, 10),
      productos: porCant,
      categorias: Object.keys(catAgg).map(function (k) { return r2(catAgg[k]); }).sort(function (a, c) { return c.ventas - a.ventas; }),
      metodos: Object.keys(metodos).map(function (k) { return r2(metodos[k]); }).sort(function (a, c) { return c.valor - a.valor; }),
      compras: { total: totalCompras, num: compras.length, por_proveedor: Object.keys(porProv).map(function (k) { return r2(porProv[k]); }) },
      gastos: { total: totalGastos, detalle: gastos.map(function (g) { return { fecha: g.fecha, concepto: g.concepto, valor: g.valor }; }) },
      utilidad_operativa: round_(b.kpis.ganancia_bruta - totalGastos),
      inventario: {
        valor: round_(sum_(insumos, function (i) { return Math.max(0, i.stock) * i.costo_unitario; })),
        items: insumos.length,
        bajos: insumos.filter(function (i) { return i.stock <= i.stock_minimo; }).length,
        detalle: insumos.map(function (i) {
          return { nombre: i.nombre, unidad: i.unidad, stock: i.stock, stock_minimo: i.stock_minimo, costo_unitario: i.costo_unitario, valor: round_(Math.max(0, i.stock) * i.costo_unitario) };
        }).sort(function (a, c) { return c.valor - a.valor; })
      }
    };
  },

  dashboard: function (d, user) {
    var h = hoy_();
    var b = Reportes.base_(h, h);
    var cant = {};
    b.items.forEach(function (i) { cant[i.nombre] = (cant[i.nombre] || 0) + i.cantidad - i.devuelto; });
    var top = Object.keys(cant).map(function (k) { return { nombre: k, cantidad: cant[k] }; }).sort(function (a, c) { return c.cantidad - a.cantidad; }).slice(0, 5);
    var caja = Caja.estado({}, user);
    return {
      fecha: h,
      kpis: user.rol === 'ADMIN' ? b.kpis : { ventas_netas: b.kpis.ventas_netas, num_ventas: b.kpis.num_ventas, ticket_promedio: b.kpis.ticket_promedio },
      top: top,
      alertas: Inventario.alertas(),
      abiertas: Db.where('Ventas', function (v) { return v.estado === 'ABIERTA'; }).length,
      caja: caja.abierta ? { id: caja.caja.id, turno: caja.caja.turno, apertura: caja.caja.apertura, resumen: caja.caja.resumen } : null
    };
  },

  auditoria: function (d) {
    var users = indexBy_(Db.all('Usuarios'));
    var desde = str_(d.desde) || '0000', hasta = (str_(d.hasta) || '9999') + ' 99';
    return Db.where('Auditoria', function (a) { return a.fecha >= desde && a.fecha <= hasta; })
      .slice(-1000).reverse().map(function (a) {
        var o = pub_(a);
        o.usuario = users[a.usuario_id] ? users[a.usuario_id].nombre : '';
        return o;
      });
  }
};
