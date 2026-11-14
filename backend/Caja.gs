/**
 * MULAN POS - Control de caja por cajero y turno: apertura, movimientos, arqueo y cierre.
 * Efectivo esperado = base + pagos en efectivo (netos de anulaciones/devoluciones) + ingresos - egresos - retiros.
 */
var TIPOS_MOV_CAJA = ['INGRESO', 'EGRESO', 'RETIRO'];

var Caja = {
  abiertaDe_: function (user) {
    var c = Db.where('Cajas', function (x) { return x.estado === 'ABIERTA' && x.cajero_id === user.id; });
    return c.length ? c[0] : null;
  },

  resumen_: function (caja) {
    var pagos = Db.where('Pagos', function (p) { return p.caja_id === caja.id; });
    var movs = Db.where('MovCaja', function (m) { return m.caja_id === caja.id; });
    var porMetodo = {};
    pagos.forEach(function (p) { porMetodo[p.metodo] = round_((porMetodo[p.metodo] || 0) + p.valor, 2); });
    var ventasIds = {};
    pagos.forEach(function (p) { if (p.tipo === 'VENTA') ventasIds[p.venta_id] = 1; });
    var tot = function (t) { return round_(sum_(movs.filter(function (m) { return m.tipo === t; }), function (m) { return m.valor; }), 2); };
    var r = {
      base: caja.base,
      ventas_por_metodo: porMetodo,
      ventas_total: round_(sum_(pagos, function (p) { return p.valor; }), 2),
      reversos: round_(sum_(pagos.filter(function (p) { return p.tipo !== 'VENTA'; }), function (p) { return p.valor; }), 2),
      num_ventas: Object.keys(ventasIds).length,
      ingresos: tot('INGRESO'),
      egresos: tot('EGRESO'),
      retiros: tot('RETIRO')
    };
    r.efectivo_esperado = round_(caja.base + (porMetodo.EFECTIVO || 0) + r.ingresos - r.egresos - r.retiros, 2);
    return r;
  },

  conNombres_: function (c) {
    var users = indexBy_(Db.all('Usuarios'));
    var o = pub_(c);
    o.cajero = users[c.cajero_id] ? users[c.cajero_id].nombre : '';
    o.cerrado_por_nombre = users[c.cerrado_por] ? users[c.cerrado_por].nombre : '';
    return o;
  },

  estado: function (d, user) {
    var c = Caja.abiertaDe_(user);
    if (!c) return { abierta: false };
    var o = Caja.conNombres_(c);
    o.resumen = Caja.resumen_(c);
    o.movimientos = Db.where('MovCaja', function (m) { return m.caja_id === c.id; }).map(function (m) { return pub_(m); }).reverse();
    return { abierta: true, caja: o };
  },

  abrir: function (d, user) {
    if (Caja.abiertaDe_(user)) throw AppError('Ya tiene una caja abierta. Ciérrela antes de abrir otra.');
    var base = num_(d.base);
    if (base < 0) throw AppError('La base no puede ser negativa');
    var c = Db.insert('Cajas', {
      id: uuid_(), cajero_id: user.id, turno: str_(d.turno), apertura: fecha_(), base: base, cierre: '',
      esperado: 0, real: 0, diferencia: 0, ventas: 0, estado: 'ABIERTA', notas: str_(d.notas), cerrado_por: ''
    });
    auditar_(user, 'ABRIR_CAJA', 'Cajas', c.id, { base: base, turno: c.turno });
    return Caja.estado(d, user);
  },

  movimiento: function (d, user) {
    if (d.id && Db.find('MovCaja', d.id)) return { duplicado: true, id: d.id }; // idempotente (sincronización)
    if (TIPOS_MOV_CAJA.indexOf(d.tipo) < 0) throw AppError('Tipo de movimiento inválido');
    if (num_(d.valor) <= 0) throw AppError('El valor debe ser mayor a cero');
    req_(d, ['concepto']);
    var c = d.caja_id ? Db.find('Cajas', d.caja_id) : Caja.abiertaDe_(user);
    if (!c || c.estado !== 'ABIERTA') throw AppError('No hay una caja abierta');
    if (c.cajero_id !== user.id && user.rol !== 'ADMIN') throw AppError('La caja pertenece a otro cajero', 403);
    if (d.tipo !== 'INGRESO') {
      var disp = Caja.resumen_(c).efectivo_esperado;
      if (num_(d.valor) > disp) throw AppError('El valor supera el efectivo disponible en caja ($' + disp + ')');
    }
    var m = Db.insert('MovCaja', {
      id: d.id || uuid_(), caja_id: c.id, fecha: fecha_(d.fecha), tipo: d.tipo, valor: round_(d.valor, 2),
      concepto: str_(d.concepto), usuario_id: user.id, referencia: str_(d.referencia)
    });
    auditar_(user, 'MOV_CAJA', 'MovCaja', m.id, { tipo: m.tipo, valor: m.valor, concepto: m.concepto });
    return pub_(m);
  },

  cerrar: function (d, user) {
    var c = d.caja_id ? Db.find('Cajas', d.caja_id) : Caja.abiertaDe_(user);
    if (!c || c.estado !== 'ABIERTA') throw AppError('No hay una caja abierta para cerrar');
    if (c.cajero_id !== user.id && user.rol !== 'ADMIN') throw AppError('Solo el cajero o un administrador pueden cerrar esta caja', 403);
    if (d.real === undefined || d.real === '' || num_(d.real) < 0) throw AppError('Ingrese el efectivo contado');
    var abiertas = Db.where('Ventas', function (v) { return v.estado === 'ABIERTA' && v.caja_id === c.id; });
    if (abiertas.length && !d.forzar) {
      throw AppError('Hay ' + abiertas.length + ' pedido(s) abierto(s) asociados a esta caja. Cóbrelos o anúlelos antes de cerrar.');
    }
    var r = Caja.resumen_(c);
    var real = round_(d.real, 2);
    Db.update('Cajas', c.id, {
      cierre: fecha_(), esperado: r.efectivo_esperado, real: real, diferencia: round_(real - r.efectivo_esperado, 2),
      ventas: r.ventas_total, estado: 'CERRADA', notas: [c.notas, str_(d.notas)].filter(String).join(' | '), cerrado_por: user.id
    });
    auditar_(user, 'CERRAR_CAJA', 'Cajas', c.id, { esperado: r.efectivo_esperado, real: real });
    return Caja.detalle({ id: c.id }, user);
  },

  detalle: function (d, user) {
    var c = Db.find('Cajas', d.id);
    if (!c) throw AppError('Caja no encontrada', 404);
    if (user.rol !== 'ADMIN' && c.cajero_id !== user.id) throw AppError('No autorizado', 403);
    var o = Caja.conNombres_(c);
    o.resumen = Caja.resumen_(c);
    o.movimientos = Db.where('MovCaja', function (m) { return m.caja_id === c.id; }).map(function (m) { return pub_(m); });
    return o;
  },

  historial: function (d, user) {
    var desde = str_(d.desde) || '0000', hasta = (str_(d.hasta) || '9999') + ' 99';
    return Db.where('Cajas', function (c) {
      if (user.rol !== 'ADMIN' && c.cajero_id !== user.id) return false;
      if (d.cajero_id && c.cajero_id !== d.cajero_id) return false;
      if (d.turno && c.turno !== d.turno) return false;
      return c.apertura >= desde && c.apertura <= hasta;
    }).map(function (c) {
      var o = Caja.conNombres_(c);
      if (c.estado === 'ABIERTA') {
        var r = Caja.resumen_(c);
        o.ventas = r.ventas_total;
        o.esperado = r.efectivo_esperado;
      }
      return o;
    }).sort(function (a, b) { return a.apertura < b.apertura ? 1 : -1; });
  }
};
