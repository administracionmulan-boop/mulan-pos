/**
 * MULAN POS - Inventario de insumos: entradas por compras, salidas por ventas, ajustes, kardex y alertas.
 * Toda variación de stock pasa por Inventario.mover_ y queda registrada en MovInventario.
 */
var TIPOS_AJUSTE = {
  DESPERDICIO: -1,     // salida por desperdicio
  DANO: -1,            // salida por daño / vencimiento
  AJUSTE_SALIDA: -1,
  AJUSTE_ENTRADA: 1,
  CONTEO: 0            // conteo físico: fija el stock al valor indicado
};

var Inventario = {
  /**
   * Aplica movimientos de stock. items: [{insumo_id, cantidad (con signo), costo_unitario?}]
   * En COMPRA/INICIAL recalcula el costo promedio ponderado del insumo.
   */
  mover_: function (items, tipo, referencia, user, nota, fecha) {
    var agg = {}, orden = [];
    items.forEach(function (it) {
      if (!agg[it.insumo_id]) { agg[it.insumo_id] = { cantidad: 0, valor: 0 }; orden.push(it.insumo_id); }
      agg[it.insumo_id].cantidad += num_(it.cantidad);
      agg[it.insumo_id].valor += num_(it.cantidad) * num_(it.costo_unitario);
    });
    var movs = [];
    var f = fecha_(fecha);
    orden.forEach(function (id) {
      var ins = Db.find('Insumos', id);
      if (!ins) throw AppError('Insumo no encontrado', 404);
      var a = agg[id];
      if (a.cantidad === 0) return;
      var nuevoStock = round_(ins.stock + a.cantidad, 4);
      var patch = { stock: nuevoStock };
      var costoMov = ins.costo_unitario;
      if ((tipo === 'COMPRA' || tipo === 'INICIAL') && a.cantidad > 0) {
        costoMov = round_(a.valor / a.cantidad, 4);
        patch.costo_unitario = ins.stock > 0
          ? round_((ins.stock * ins.costo_unitario + a.valor) / (ins.stock + a.cantidad), 4)
          : costoMov;
      }
      Db.update('Insumos', id, patch);
      movs.push({
        id: uuid_(), fecha: f, insumo_id: id, tipo: tipo, cantidad: round_(a.cantidad, 4), costo_unitario: costoMov,
        stock_resultante: nuevoStock, referencia: referencia || '', usuario_id: user ? user.id : '', nota: nota || ''
      });
    });
    Db.insertMany('MovInventario', movs);
    return movs;
  },

  compra: function (d, user) {
    if (!Array.isArray(d.items) || !d.items.length) throw AppError('Agregue al menos un insumo a la compra');
    if (d.proveedor_id && !Db.find('Proveedores', d.proveedor_id)) throw AppError('Proveedor inválido');
    var items = d.items.map(function (it) {
      if (!Db.find('Insumos', it.insumo_id)) throw AppError('Insumo inválido');
      if (num_(it.cantidad) <= 0) throw AppError('Las cantidades deben ser mayores a cero');
      if (num_(it.costo_unitario) < 0) throw AppError('Costo inválido');
      return { insumo_id: it.insumo_id, cantidad: num_(it.cantidad), costo_unitario: num_(it.costo_unitario) };
    });
    var total = round_(sum_(items, function (i) { return i.cantidad * i.costo_unitario; }), 2);
    var caja = null;
    if (d.pagado_caja) {
      caja = Caja.abiertaDe_(user);
      if (!caja) throw AppError('Para pagar la compra desde caja debe tener una caja abierta');
    }
    var id = uuid_();
    var prov = d.proveedor_id ? Db.find('Proveedores', d.proveedor_id) : null;
    Db.insert('Compras', {
      id: id, fecha: fecha_(), proveedor_id: str_(d.proveedor_id), factura: str_(d.factura), total: total,
      pagado_caja: !!caja, caja_id: caja ? caja.id : '', usuario_id: user.id, nota: str_(d.nota)
    });
    Inventario.mover_(items, 'COMPRA', id, user, 'Compra ' + (prov ? prov.nombre : '') + (d.factura ? ' Fact. ' + d.factura : ''));
    if (caja) {
      Db.insert('MovCaja', {
        id: uuid_(), caja_id: caja.id, fecha: fecha_(), tipo: 'EGRESO', valor: total,
        concepto: 'Compra de insumos' + (prov ? ' - ' + prov.nombre : ''), usuario_id: user.id, referencia: id
      });
    }
    auditar_(user, 'COMPRA', 'Compras', id, { total: total, items: items.length });
    return { id: id, total: total };
  },

  ajuste: function (d, user) {
    req_(d, ['insumo_id', 'tipo']);
    if (!(d.tipo in TIPOS_AJUSTE)) throw AppError('Tipo de ajuste inválido');
    var ins = Db.find('Insumos', d.insumo_id);
    if (!ins) throw AppError('Insumo no encontrado', 404);
    var cant = num_(d.cantidad);
    if (d.tipo === 'CONTEO') {
      if (cant < 0) throw AppError('El conteo no puede ser negativo');
      cant = round_(cant - ins.stock, 4);
      if (cant === 0) return { sin_cambios: true };
    } else {
      if (cant <= 0) throw AppError('La cantidad debe ser mayor a cero');
      cant = cant * TIPOS_AJUSTE[d.tipo];
    }
    if (TIPOS_AJUSTE[d.tipo] < 0 && !str_(d.nota)) throw AppError('Indique el motivo del ajuste');
    var movs = Inventario.mover_([{ insumo_id: ins.id, cantidad: cant }], d.tipo, 'Ajuste', user, str_(d.nota));
    auditar_(user, 'AJUSTE_INVENTARIO', 'Insumos', ins.id, { tipo: d.tipo, cantidad: cant });
    return movs[0];
  },

  kardex: function (d) {
    var desde = str_(d.desde) || '0000', hasta = (str_(d.hasta) || '9999') + ' 99';
    var users = indexBy_(Db.all('Usuarios'));
    var ins = indexBy_(Db.all('Insumos'));
    return Db.where('MovInventario', function (m) {
      return (!d.insumo_id || m.insumo_id === d.insumo_id) && m.fecha >= desde && m.fecha <= hasta && (!d.tipo || m.tipo === d.tipo);
    }).map(function (m) {
      var o = pub_(m);
      o.usuario = users[m.usuario_id] ? users[m.usuario_id].nombre : '';
      o.insumo = ins[m.insumo_id] ? ins[m.insumo_id].nombre : '';
      o.unidad = ins[m.insumo_id] ? ins[m.insumo_id].unidad : '';
      return o;
    }).sort(function (a, b) { return a.fecha < b.fecha ? 1 : -1; }).slice(0, num_(d.limite) || 500);
  },

  alertas: function () {
    return Db.where('Insumos', function (i) { return i.activo && i.stock <= i.stock_minimo; }).map(function (i) {
      var o = pub_(i);
      o.alerta = i.stock <= 0 ? 'AGOTADO' : 'BAJO';
      return o;
    }).sort(function (a, b) { return (a.stock - a.stock_minimo) - (b.stock - b.stock_minimo); });
  },

  compras: function (d) {
    var desde = str_(d.desde) || '0000', hasta = (str_(d.hasta) || '9999') + ' 99';
    var prov = indexBy_(Db.all('Proveedores'));
    var ins = indexBy_(Db.all('Insumos'));
    var movs = {};
    Db.where('MovInventario', function (m) { return m.tipo === 'COMPRA'; }).forEach(function (m) {
      (movs[m.referencia] = movs[m.referencia] || []).push({
        insumo: ins[m.insumo_id] ? ins[m.insumo_id].nombre : '', unidad: ins[m.insumo_id] ? ins[m.insumo_id].unidad : '',
        cantidad: m.cantidad, costo_unitario: m.costo_unitario
      });
    });
    return Db.where('Compras', function (c) { return c.fecha >= desde && c.fecha <= hasta; }).map(function (c) {
      var o = pub_(c);
      o.proveedor = prov[c.proveedor_id] ? prov[c.proveedor_id].nombre : '';
      o.items = movs[c.id] || [];
      return o;
    }).sort(function (a, b) { return a.fecha < b.fecha ? 1 : -1; });
  }
};
