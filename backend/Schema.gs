/**
 * MULAN POS - Esquema de la base de datos (una hoja por tabla).
 * Tipos: (sin sufijo) texto, :n número, :b booleano.
 * Para agregar un campo: añádalo al final de la lista y ejecute setup().
 */
var SCHEMA = {
  Config: 'clave,valor',
  Usuarios: 'id,nombre,usuario,rol,hash,salt,pin_hash,activo:b,debe_cambiar:b,creado',
  Sesiones: 'token,usuario_id,creado,expira,dispositivo',
  Categorias: 'id,nombre,orden:n,color,activo:b',
  Productos: 'id,nombre,categoria_id,precio:n,descripcion,modificadores,activo:b,creado',
  Insumos: 'id,nombre,unidad,stock:n,stock_minimo:n,costo_unitario:n,proveedor_id,activo:b,creado',
  Recetas: 'id,producto_id,insumo_id,cantidad:n',
  Proveedores: 'id,nombre,nit,telefono,email,direccion,contacto,activo:b',
  Promociones: 'id,nombre,tipo,valor:n,alcance,ref_id,dias,desde,hasta,activo:b',
  Compras: 'id,fecha,proveedor_id,factura,total:n,pagado_caja:b,caja_id,usuario_id,nota',
  MovInventario: 'id,fecha,insumo_id,tipo,cantidad:n,costo_unitario:n,stock_resultante:n,referencia,usuario_id,nota',
  Cajas: 'id,cajero_id,turno,apertura,base:n,cierre,esperado:n,real:n,diferencia:n,ventas:n,estado,notas,cerrado_por',
  MovCaja: 'id,caja_id,fecha,tipo,valor:n,concepto,usuario_id,referencia',
  Ventas: 'id,numero:n,fecha,fecha_pago,caja_id,usuario_id,tipo,mesa,cliente,telefono,direccion,subtotal:n,descuento:n,domicilio:n,impuesto:n,total:n,costo:n,devuelto:n,estado,nota,motivo,autorizado_por,origen',
  VentaItems: 'id,venta_id,producto_id,nombre,cantidad:n,precio:n,descuento:n,total:n,costo:n,nota,devuelto:n',
  Pagos: 'id,venta_id,caja_id,fecha,metodo,valor:n,recibido:n,cambio:n,referencia,tipo',
  Auditoria: 'id,fecha,usuario_id,accion,entidad,entidad_id,detalle'
};

var CONFIG_DEFAULT = {
  negocio_nombre: 'MULAN',
  negocio_nit: '',
  negocio_direccion: '',
  negocio_telefono: '',
  impuesto_nombre: 'Impoconsumo',
  impuesto_pct: '0',
  mesas: 'Mesa 1,Mesa 2',
  metodos_pago: 'EFECTIVO,TRANSFERENCIA,TARJETA,OTRO',
  turnos: 'Mañana,Tarde,Noche',
  max_descuento_cajero: '10',
  domicilio_valor: '0',
  mensaje_comprobante: '¡Gracias por su compra!',
  moneda: 'COP'
};

var _schemaCache = {};
function cols_(tabla) {
  if (_schemaCache[tabla]) return _schemaCache[tabla];
  var def = SCHEMA[tabla];
  if (!def) throw AppError('Tabla desconocida: ' + tabla, 500);
  var c = def.split(',').map(function (s) {
    var p = s.split(':');
    return { name: p[0], type: p[1] || 's' };
  });
  _schemaCache[tabla] = c;
  return c;
}

/**
 * Crea/actualiza todas las hojas, la configuración por defecto y el usuario administrador inicial.
 * Ejecutar UNA vez desde el editor de Apps Script (y de nuevo si se agregan campos).
 * Usuario inicial: admin / mulan2026   PIN de autorización: 1234  (se obliga a cambiar la clave).
 */
function setup() {
  var ss = Db.ss();
  Object.keys(SCHEMA).forEach(function (t) {
    var c = cols_(t);
    var sh = ss.getSheetByName(t) || ss.insertSheet(t);
    var lastCol = Math.max(sh.getLastColumn(), 1);
    var actuales = sh.getLastRow() >= 1 ? sh.getRange(1, 1, 1, lastCol).getValues()[0] : [];
    // escribir encabezados (agrega columnas nuevas al final sin mover datos)
    var headers = c.map(function (x) { return x.name; });
    headers.forEach(function (h, i) {
      if (actuales[i] && actuales[i] !== h && actuales[i] !== '') {
        throw new Error('La hoja ' + t + ' tiene la columna "' + actuales[i] + '" donde se esperaba "' + h + '". Revise el orden de columnas.');
      }
    });
    var hr = sh.getRange(1, 1, 1, headers.length);
    hr.setValues([headers]);
    hr.setFontWeight('bold').setBackground('#111111').setFontColor('#ffffff');
    sh.setFrozenRows(1);
    // formato por columna para evitar conversiones automáticas
    var filas = Math.max(sh.getMaxRows() - 1, 1);
    c.forEach(function (col, i) {
      var fmt = col.type === 'n' ? '0.####' : (col.type === 'b' ? 'General' : '@');
      sh.getRange(2, i + 1, filas, 1).setNumberFormat(fmt);
    });
  });
  Db.reset();

  // configuración por defecto (solo claves que no existan)
  var cfg = indexBy_(Db.all('Config'), 'clave');
  Object.keys(CONFIG_DEFAULT).forEach(function (k) {
    if (!cfg[k]) Db.insert('Config', { clave: k, valor: CONFIG_DEFAULT[k] });
  });

  // administrador inicial
  if (Db.all('Usuarios').length === 0) {
    Auth.crearUsuario_({ nombre: 'Administrador', usuario: 'admin', rol: 'ADMIN', password: 'mulan2026', pin: '1234', debe_cambiar: true });
  }
  // categorías iniciales
  if (Db.all('Categorias').length === 0) {
    [['Platos', '#C62828'], ['Bebidas', '#1565C0'], ['Adiciones', '#EF6C00'], ['Postres', '#6A1B9A']].forEach(function (c, i) {
      Db.insert('Categorias', { id: uuid_(), nombre: c[0], orden: i + 1, color: c[1], activo: true });
    });
  }
  return 'MULAN POS listo. Usuario: admin / Clave: mulan2026 / PIN: 1234';
}
