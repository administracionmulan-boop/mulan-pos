/**
 * MULAN POS - Ventas / comandas.
 * Una venta nace ABIERTA (comanda de mesa) o se cobra de inmediato (para llevar / domicilio).
 * Al cobrarse (PAGADA) se registran los pagos en la caja del cajero y se descuentan los insumos según las recetas.
 * venta.guardar es idempotente por id: permite sincronizar ventas hechas sin conexión sin duplicarlas.
 */
var TIPOS_VENTA = ['MESA', 'LLEVAR', 'DOMICILIO'];

var Ventas = {
  guardar: function (d, user) {
    if (!d.id) d.id = uuid_();
    var existente = Db.find('Ventas', d.id);
    if (existente && existente.estado !== 'ABIERTA') {
      return { duplicado: true, venta: Ventas.detalle({ id: d.id }) };
    }
    if (TIPOS_VENTA.indexOf(d.tipo) < 0) throw AppError('Tipo de pedido inválido');
    if (d.tipo === 'MESA' && !str_(d.mesa)) throw AppError('Seleccione la mesa');
    if (d.tipo === 'DOMICILIO' && !str_(d.direccion)) throw AppError('Ingrese la dirección del domicilio');
    if (!Array.isArray(d.items) || !d.items.length) throw AppError('El pedido no tiene productos');
    if (d.tipo === 'MESA' && !existente) {
      var ocupada = Db.where('Ventas', function (v) { return v.estado === 'ABIERTA' && v.tipo === 'MESA' && v.mesa === str_(d.mesa) && v.id !== d.id; });
      if (ocupada.length) throw AppError(str_(d.mesa) + ' ya tiene un pedido abierto (#' + ocupada[0].numero + ')');
    }

    var cfg = config_();
    var fechaVenta = existente ? existente.fecha : fecha_(d.fecha);
    var ymd = fechaVenta.substring(0, 10);
    var promos = Db.all('Promociones');
    var prods = indexBy_(Db.all('Productos'));
    var insIdx = indexBy_(Db.all('Insumos'));
    var recetas = {};
    Db.all('Recetas').forEach(function (r) { (recetas[r.producto_id] = recetas[r.producto_id] || []).push(r); });

    var manual = 0;
    var lineas = d.items.map(function (it) {
      var p = prods[it.producto_id];
      if (!p) throw AppError('Producto no encontrado en el catálogo');
      var cant = num_(it.cantidad);
      if (cant <= 0) throw AppError('Cantidad inválida para ' + p.nombre);
      var bruto = round_(p.precio * cant, 2);
      var promo = promoDescuento_(p, ymd, promos);
      var descManual = Math.max(0, num_(it.descuento_manual));
      manual += descManual;
      var desc = Math.min(bruto, round_(promo.valor * cant + descManual, 2));
      var costoUnit = sum_(recetas[p.id] || [], function (r) { return r.cantidad * (insIdx[r.insumo_id] ? insIdx[r.insumo_id].costo_unitario : 0); });
      return {
        id: it.id || uuid_(), venta_id: d.id, producto_id: p.id, nombre: p.nombre, cantidad: cant, precio: p.precio,
        descuento: desc, total: round_(bruto - desc, 2), costo: round_(costoUnit * cant, 2),
        nota: [promo.promo ? 'Promo: ' + promo.promo : '', str_(it.nota)].filter(String).join(' · '), devuelto: 0
      };
    });

    var subtotal = round_(sum_(lineas, function (l) { return l.precio * l.cantidad; }), 2);
    var netoLineas = round_(sum_(lineas, function (l) { return l.total; }), 2);
    var descGlobal = Math.min(Math.max(0, num_(d.descuento)), netoLineas);
    manual += descGlobal;
    var domicilio = d.tipo === 'DOMICILIO' ? Math.max(0, num_(d.domicilio)) : 0;
    var total = round_(netoLineas - descGlobal + domicilio, 0);
    var pct = num_(cfg.impuesto_pct);
    var gravable = total - domicilio;
    var impuesto = pct > 0 ? round_(gravable - gravable / (1 + pct / 100), 0) : 0;

    // Descuentos manuales por encima del tope del cajero requieren autorización
    var autorizadoPor = existente ? existente.autorizado_por : '';
    if (manual > 0 && subtotal > 0 && user.rol !== 'ADMIN' && manual / subtotal * 100 > num_(cfg.max_descuento_cajero)) {
      autorizadoPor = Auth.autorizar(d.autorizacion, user).id;
    }

    // Caja del cajero
    var caja = null;
    if (d.caja_id) {
      var cc = Db.find('Cajas', d.caja_id);
      if (cc && cc.estado === 'ABIERTA') caja = cc;
    }
    if (!caja) caja = Caja.abiertaDe_(user);
    if (!caja) throw AppError('Debe abrir caja antes de registrar ventas');

    var cobrar = Array.isArray(d.pagos) && d.pagos.length > 0;
    var pagos = [];
    var costoTotal = round_(sum_(lineas, function (l) { return l.costo; }), 2);
    if (cobrar) {
      var metodos = String(cfg.metodos_pago).split(',').map(function (m) { return m.trim(); });
      pagos = d.pagos.map(function (p) {
        if (metodos.indexOf(p.metodo) < 0) throw AppError('Medio de pago inválido: ' + p.metodo);
        var valor = round_(p.valor, 0);
        if (valor <= 0) throw AppError('Valor de pago inválido');
        var recibido = p.metodo === 'EFECTIVO' ? Math.max(num_(p.recibido) || valor, valor) : valor;
        return {
          id: uuid_(), venta_id: d.id, caja_id: caja.id, fecha: fecha_(d.fecha_pago || d.fecha), metodo: p.metodo, valor: valor,
          recibido: recibido, cambio: round_(recibido - valor, 0), referencia: str_(p.referencia), tipo: 'VENTA'
        };
      });
      var pagado = sum_(pagos, function (p) { return p.valor; });
      if (Math.abs(pagado - total) > 1) throw AppError('Los pagos ($' + pagado + ') no coinciden con el total ($' + total + ')');
    }

    var venta = {
      id: d.id, numero: existente ? existente.numero : Ventas.siguienteNumero_(), fecha: fechaVenta,
      fecha_pago: cobrar ? fecha_(d.fecha_pago || d.fecha) : '', caja_id: caja.id,
      usuario_id: existente ? existente.usuario_id : user.id, tipo: d.tipo, mesa: d.tipo === 'MESA' ? str_(d.mesa) : '',
      cliente: str_(d.cliente), telefono: str_(d.telefono), direccion: str_(d.direccion),
      subtotal: subtotal, descuento: round_(subtotal - netoLineas + descGlobal, 2), domicilio: domicilio, impuesto: impuesto,
      total: total, costo: costoTotal, devuelto: 0, estado: cobrar ? 'PAGADA' : 'ABIERTA', nota: str_(d.nota),
      motivo: '', autorizado_por: autorizadoPor, origen: d.origen === 'OFFLINE' ? 'OFFLINE' : 'ONLINE'
    };

    if (existente) {
      Db.removeWhere('VentaItems', function (i) { return i.venta_id === d.id; });
      Db.update('Ventas', d.id, venta);
    } else {
      Db.insert('Ventas', venta);
    }
    Db.insertMany('VentaItems', lineas);

    if (cobrar) {
      Db.insertMany('Pagos', pagos);
      var consumo = [];
      lineas.forEach(function (l) {
        (recetas[l.producto_id] || []).forEach(function (r) {
          consumo.push({ insumo_id: r.insumo_id, cantidad: -r.cantidad * l.cantidad });
        });
      });
      if (consumo.length) Inventario.mover_(consumo, 'VENTA', d.id, user, 'Venta #' + venta.numero, venta.fecha_pago);
      auditar_(user, 'VENTA', 'Ventas', d.id, { numero: venta.numero, total: total, origen: venta.origen });
    } else {
      auditar_(user, existente ? 'EDITAR_COMANDA' : 'COMANDA', 'Ventas', d.id, { numero: venta.numero, mesa: venta.mesa, total: total });
    }
    return { venta: Ventas.detalle({ id: d.id }) };
  },

  siguienteNumero_: function () {
    var max = 0;
    Db.all('Ventas').forEach(function (v) { if (v.numero > max) max = v.numero; });
    return max + 1;
  },

  detalle: function (d) {
    var v = Db.find('Ventas', d.id);
    if (!v) throw AppError('Venta no encontrada', 404);
    var users = indexBy_(Db.all('Usuarios'));
    var o = pub_(v);
    o.cajero = users[v.usuario_id] ? users[v.usuario_id].nombre : '';
    o.autorizado_por_nombre = users[v.autorizado_por] ? users[v.autorizado_por].nombre : '';
    o.items = Db.where('VentaItems', function (i) { return i.venta_id === v.id; }).map(function (i) { return pub_(i); });
    o.pagos = Db.where('Pagos', function (p) { return p.venta_id === v.id; }).map(function (p) { return pub_(p); });
    return o;
  },

  abiertas: function () {
    return Db.where('Ventas', function (v) { return v.estado === 'ABIERTA'; }).map(function (v) { return Ventas.detalle({ id: v.id }); });
  },

  listar: function (d, user) {
    var desde = str_(d.desde) || hoy_(), hasta = (str_(d.hasta) || hoy_()) + ' 99';
    var users = indexBy_(Db.all('Usuarios'));
    var q = str_(d.q).toLowerCase();
    return Db.where('Ventas', function (v) {
      if (v.fecha < desde || v.fecha > hasta) return false;
      if (d.estado && v.estado !== d.estado) return false;
      if (d.tipo && v.tipo !== d.tipo) return false;
      if (q && (String(v.numero) + ' ' + v.cliente + ' ' + v.mesa + ' ' + v.telefono).toLowerCase().indexOf(q) < 0) return false;
      return true;
    }).map(function (v) {
      var o = pub_(v);
      o.cajero = users[v.usuario_id] ? users[v.usuario_id].nombre : '';
      return o;
    }).sort(function (a, b) { return b.numero - a.numero; }).slice(0, 1000);
  },

  cajaParaReverso_: function (venta, user) {
    var orig = Db.find('Cajas', venta.caja_id);
    if (orig && orig.estado === 'ABIERTA') return orig;
    var c = Caja.abiertaDe_(user);
    if (!c) throw AppError('Abra una caja para registrar la salida del dinero');
    return c;
  },

  anular: function (d, user) {
    req_(d, ['id', 'motivo']);
    var v = Db.find('Ventas', d.id);
    if (!v) throw AppError('Venta no encontrada', 404);
    if (v.estado === 'ANULADA') throw AppError('La venta ya está anulada');
    if (v.estado === 'DEVUELTA' || v.devuelto > 0) throw AppError('La venta tiene devoluciones; no puede anularse completa');
    var aut = Auth.autorizar(d.autorizacion, user);
    if (v.estado === 'PAGADA') {
      var caja = Ventas.cajaParaReverso_(v, user);
      var reversos = Db.where('Pagos', function (p) { return p.venta_id === v.id && p.tipo === 'VENTA'; }).map(function (p) {
        return {
          id: uuid_(), venta_id: v.id, caja_id: caja.id, fecha: fecha_(), metodo: p.metodo, valor: -p.valor,
          recibido: 0, cambio: 0, referencia: 'Anulación #' + v.numero, tipo: 'ANULACION'
        };
      });
      Db.insertMany('Pagos', reversos);
      var consumo = Db.where('MovInventario', function (m) { return m.referencia === v.id && m.tipo === 'VENTA'; }).map(function (m) {
        return { insumo_id: m.insumo_id, cantidad: -m.cantidad };
      });
      if (consumo.length) Inventario.mover_(consumo, 'ANULACION', v.id, user, 'Anulación venta #' + v.numero);
    }
    Db.update('Ventas', v.id, { estado: 'ANULADA', motivo: str_(d.motivo), autorizado_por: aut.id });
    auditar_(user, 'ANULAR', 'Ventas', v.id, { numero: v.numero, total: v.total, motivo: d.motivo, autoriza: aut.usuario });
    return Ventas.detalle({ id: v.id });
  },

  devolver: function (d, user) {
    req_(d, ['id', 'motivo', 'metodo']);
    var v = Db.find('Ventas', d.id);
    if (!v) throw AppError('Venta no encontrada', 404);
    if (v.estado !== 'PAGADA') throw AppError('Solo se pueden devolver ventas pagadas');
    if (!Array.isArray(d.items) || !d.items.length) throw AppError('Seleccione los productos a devolver');
    var aut = Auth.autorizar(d.autorizacion, user);
    var items = indexBy_(Db.where('VentaItems', function (i) { return i.venta_id === v.id; }));
    var sumaLineas = sum_(Object.keys(items).map(function (k) { return items[k]; }), function (i) { return i.total; });
    var factor = sumaLineas > 0 ? (v.total - v.domicilio) / sumaLineas : 0; // reparte el descuento global
    var valor = 0, reintegro = [];
    var recetas = {};
    Db.all('Recetas').forEach(function (r) { (recetas[r.producto_id] = recetas[r.producto_id] || []).push(r); });
    d.items.forEach(function (x) {
      var it = items[x.item_id];
      if (!it) throw AppError('Producto de la venta no encontrado');
      var cant = num_(x.cantidad);
      if (cant <= 0) return;
      if (cant > it.cantidad - it.devuelto) throw AppError('No puede devolver más de lo vendido de ' + it.nombre);
      valor += it.total / it.cantidad * cant * factor;
      Db.update('VentaItems', it.id, { devuelto: it.devuelto + cant });
      if (d.reintegrar) {
        (recetas[it.producto_id] || []).forEach(function (r) { reintegro.push({ insumo_id: r.insumo_id, cantidad: r.cantidad * cant }); });
      }
    });
    valor = round_(valor, 0);
    if (valor <= 0) throw AppError('Nada para devolver');
    var caja = Ventas.cajaParaReverso_(v, user);
    if (d.metodo === 'EFECTIVO' && valor > Caja.resumen_(caja).efectivo_esperado) throw AppError('No hay suficiente efectivo en caja para la devolución');
    Db.insert('Pagos', {
      id: uuid_(), venta_id: v.id, caja_id: caja.id, fecha: fecha_(), metodo: d.metodo, valor: -valor,
      recibido: 0, cambio: 0, referencia: 'Devolución #' + v.numero + ': ' + str_(d.motivo), tipo: 'DEVOLUCION'
    });
    if (reintegro.length) Inventario.mover_(reintegro, 'DEVOLUCION', v.id, user, 'Devolución venta #' + v.numero);
    var todos = Db.where('VentaItems', function (i) { return i.venta_id === v.id; });
    var completa = todos.every(function (i) { return i.devuelto >= i.cantidad; });
    Db.update('Ventas', v.id, {
      devuelto: round_(v.devuelto + valor, 0), estado: completa ? 'DEVUELTA' : 'PAGADA',
      motivo: [v.motivo, 'Devolución: ' + str_(d.motivo)].filter(String).join(' | '), autorizado_por: aut.id
    });
    auditar_(user, 'DEVOLUCION', 'Ventas', v.id, { numero: v.numero, valor: valor, autoriza: aut.usuario });
    return Ventas.detalle({ id: v.id });
  }
};
