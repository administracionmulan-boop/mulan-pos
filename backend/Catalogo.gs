/**
 * MULAN POS - Catálogo: categorías, productos de venta (con receta), insumos, proveedores y promociones.
 */
var UNIDADES = ['und', 'g', 'kg', 'ml', 'l', 'lb', 'porción'];

var Catalogo = {
  /** Costo de preparación de un producto según su receta y el costo actual de los insumos. */
  costoProducto: function (productoId, insumosIdx) {
    insumosIdx = insumosIdx || indexBy_(Db.all('Insumos'));
    return round_(sum_(Db.where('Recetas', function (r) { return r.producto_id === productoId; }), function (r) {
      var ins = insumosIdx[r.insumo_id];
      return ins ? r.cantidad * ins.costo_unitario : 0;
    }), 2);
  },

  productoCompleto_: function (p, insIdx, recetasPorProd) {
    var receta = (recetasPorProd[p.id] || []).map(function (r) {
      var ins = insIdx[r.insumo_id] || {};
      return {
        id: r.id, insumo_id: r.insumo_id, insumo: ins.nombre || '(insumo eliminado)', unidad: ins.unidad || '',
        cantidad: r.cantidad, costo_unitario: ins.costo_unitario || 0, costo: round_(r.cantidad * (ins.costo_unitario || 0), 2)
      };
    });
    var costo = round_(sum_(receta, function (r) { return r.costo; }), 2);
    var o = pub_(p);
    o.receta = receta;
    o.costo = costo;
    o.utilidad = round_(p.precio - costo, 2);
    o.margen = p.precio > 0 ? round_((p.precio - costo) / p.precio * 100, 1) : 0;
    return o;
  },

  /** Todo el catálogo (lo usa el POS y se guarda en el dispositivo para modo sin conexión). */
  get: function (d, user) {
    var insumos = Db.all('Insumos');
    var insIdx = indexBy_(insumos);
    var recetasPorProd = {};
    Db.all('Recetas').forEach(function (r) { (recetasPorProd[r.producto_id] = recetasPorProd[r.producto_id] || []).push(r); });
    var cfg = config_();
    return {
      generado: fecha_(),
      config: cfg,
      categorias: Db.all('Categorias').map(function (c) { return pub_(c); }).sort(function (a, b) { return a.orden - b.orden; }),
      productos: Db.all('Productos').map(function (p) { return Catalogo.productoCompleto_(p, insIdx, recetasPorProd); }),
      insumos: insumos.map(function (i) {
        var o = pub_(i);
        o.alerta = i.activo ? (i.stock <= 0 ? 'AGOTADO' : (i.stock <= i.stock_minimo ? 'BAJO' : '')) : '';
        return o;
      }),
      proveedores: Db.all('Proveedores').map(function (p) { return pub_(p); }),
      promociones: Db.all('Promociones').map(function (p) { return pub_(p); }),
      unidades: UNIDADES
    };
  },

  guardarCategoria: function (d, user) {
    req_(d, ['nombre']);
    var dup = Db.where('Categorias', function (c) { return c.nombre.toLowerCase() === str_(d.nombre).toLowerCase() && c.id !== d.id; });
    if (dup.length) throw AppError('Ya existe una categoría con ese nombre');
    var r = Db.upsert('Categorias', {
      id: d.id, nombre: str_(d.nombre), orden: num_(d.orden) || Db.all('Categorias').length + 1,
      color: str_(d.color) || '#C62828', activo: d.activo !== false
    });
    auditar_(user, d.id ? 'EDITAR' : 'CREAR', 'Categorias', r.id, r.nombre);
    return pub_(r);
  },

  guardarProducto: function (d, user) {
    req_(d, ['nombre', 'categoria_id']);
    if (!Db.find('Categorias', d.categoria_id)) throw AppError('Categoría inválida');
    if (num_(d.precio) < 0) throw AppError('El precio no puede ser negativo');
    var existente = d.id ? Db.find('Productos', d.id) : null;
    var r = Db.upsert('Productos', {
      id: d.id, nombre: str_(d.nombre), categoria_id: d.categoria_id, precio: round_(d.precio, 2),
      descripcion: str_(d.descripcion), modificadores: str_(d.modificadores),
      activo: d.activo !== false, creado: existente ? existente.creado : fecha_()
    });
    if (Array.isArray(d.receta)) {
      var vistos = {};
      var filas = d.receta.filter(function (x) { return x.insumo_id && num_(x.cantidad) > 0; }).map(function (x) {
        if (!Db.find('Insumos', x.insumo_id)) throw AppError('Insumo inválido en la receta');
        if (vistos[x.insumo_id]) throw AppError('Un insumo está repetido en la receta');
        vistos[x.insumo_id] = true;
        return { id: uuid_(), producto_id: r.id, insumo_id: x.insumo_id, cantidad: num_(x.cantidad) };
      });
      Db.removeWhere('Recetas', function (x) { return x.producto_id === r.id; });
      Db.insertMany('Recetas', filas);
    }
    auditar_(user, existente ? 'EDITAR' : 'CREAR', 'Productos', r.id, r.nombre + ' $' + r.precio);
    var insIdx = indexBy_(Db.all('Insumos'));
    var rp = {}; rp[r.id] = Db.where('Recetas', function (x) { return x.producto_id === r.id; });
    return Catalogo.productoCompleto_(r, insIdx, rp);
  },

  guardarInsumo: function (d, user) {
    req_(d, ['nombre', 'unidad']);
    var dup = Db.where('Insumos', function (c) { return c.nombre.toLowerCase() === str_(d.nombre).toLowerCase() && c.id !== d.id; });
    if (dup.length) throw AppError('Ya existe un insumo con ese nombre');
    var existente = d.id ? Db.find('Insumos', d.id) : null;
    var obj = {
      id: d.id, nombre: str_(d.nombre), unidad: str_(d.unidad), stock_minimo: num_(d.stock_minimo),
      costo_unitario: num_(d.costo_unitario), proveedor_id: str_(d.proveedor_id), activo: d.activo !== false
    };
    if (!existente) {
      obj.stock = 0;
      obj.creado = fecha_();
    }
    var r = Db.upsert('Insumos', obj);
    // stock inicial se registra como movimiento para conservar la trazabilidad
    if (!existente && num_(d.stock_inicial) > 0) {
      Inventario.mover_([{ insumo_id: r.id, cantidad: num_(d.stock_inicial), costo_unitario: r.costo_unitario }], 'INICIAL', 'Stock inicial', user, 'Creación del insumo');
    }
    auditar_(user, existente ? 'EDITAR' : 'CREAR', 'Insumos', r.id, r.nombre);
    return pub_(Db.find('Insumos', r.id));
  },

  guardarProveedor: function (d, user) {
    req_(d, ['nombre']);
    var r = Db.upsert('Proveedores', {
      id: d.id, nombre: str_(d.nombre), nit: str_(d.nit), telefono: str_(d.telefono), email: str_(d.email),
      direccion: str_(d.direccion), contacto: str_(d.contacto), activo: d.activo !== false
    });
    auditar_(user, d.id ? 'EDITAR' : 'CREAR', 'Proveedores', r.id, r.nombre);
    return pub_(r);
  },

  guardarPromocion: function (d, user) {
    req_(d, ['nombre', 'tipo', 'valor', 'alcance']);
    if (['PORCENTAJE', 'VALOR'].indexOf(d.tipo) < 0) throw AppError('Tipo de promoción inválido');
    if (['TODO', 'CATEGORIA', 'PRODUCTO'].indexOf(d.alcance) < 0) throw AppError('Alcance inválido');
    if (d.alcance !== 'TODO' && !d.ref_id) throw AppError('Seleccione la categoría o producto de la promoción');
    if (d.tipo === 'PORCENTAJE' && (num_(d.valor) <= 0 || num_(d.valor) > 100)) throw AppError('El porcentaje debe estar entre 1 y 100');
    var r = Db.upsert('Promociones', {
      id: d.id, nombre: str_(d.nombre), tipo: d.tipo, valor: num_(d.valor), alcance: d.alcance,
      ref_id: d.alcance === 'TODO' ? '' : str_(d.ref_id), dias: str_(d.dias), desde: str_(d.desde), hasta: str_(d.hasta),
      activo: d.activo !== false
    });
    auditar_(user, d.id ? 'EDITAR' : 'CREAR', 'Promociones', r.id, r.nombre);
    return pub_(r);
  },

  guardarConfig: function (d, user) {
    var permitidas = Object.keys(CONFIG_DEFAULT);
    Object.keys(d).forEach(function (k) {
      if (permitidas.indexOf(k) < 0) return;
      var v = str_(d[k]);
      if (k === 'impuesto_pct' && (num_(v) < 0 || num_(v) > 100)) throw AppError('Impuesto inválido');
      if (Db.find('Config', k, 'clave')) Db.update('Config', k, { valor: v }, 'clave');
      else Db.insert('Config', { clave: k, valor: v });
    });
    auditar_(user, 'EDITAR', 'Config', '', Object.keys(d).join(','));
    return config_();
  }
};

/**
 * Descuento unitario por promociones vigentes (la mejor aplica). Misma lógica en frontend (js/calc.js).
 * @return {{valor:number, promo:string}}
 */
function promoDescuento_(producto, ymd, promociones) {
  var dia = String(diaSemana_(ymd));
  var mejor = { valor: 0, promo: '' };
  promociones.forEach(function (p) {
    if (!p.activo) return;
    if (p.desde && ymd < p.desde) return;
    if (p.hasta && ymd > p.hasta) return;
    if (p.dias && String(p.dias).split(',').map(function (x) { return x.trim(); }).indexOf(dia) < 0) return;
    if (p.alcance === 'PRODUCTO' && p.ref_id !== producto.id) return;
    if (p.alcance === 'CATEGORIA' && p.ref_id !== producto.categoria_id) return;
    var v = p.tipo === 'PORCENTAJE' ? producto.precio * p.valor / 100 : Math.min(p.valor, producto.precio);
    v = round_(v, 0);
    if (v > mejor.valor) mejor = { valor: v, promo: p.nombre };
  });
  return mejor;
}
