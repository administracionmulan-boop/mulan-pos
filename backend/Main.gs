/**
 * MULAN POS - Punto de entrada de la API (Web App de Apps Script).
 * Petición: POST (Content-Type text/plain) con JSON {action, token, data}.
 * Respuesta: {ok:true, data} o {ok:false, error, code}.
 */
var A = ['ADMIN'];
var T = ['ADMIN', 'CAJERO'];

// Las rutas se construyen al primer uso (Apps Script no garantiza el orden de carga de archivos).
// write:true -> se ejecuta con bloqueo (LockService) para evitar choques entre dispositivos
var ROUTES_ = null;
function routes_() {
  if (ROUTES_) return ROUTES_;
  ROUTES_ = {
  'ping':                { public: true, fn: function () { return { app: 'MULAN POS', version: APP_VERSION, hora: fecha_() }; } },
  'auth.login':          { public: true, write: true, fn: function (d) { return Auth.login(d); } },
  'auth.logout':         { roles: T, write: true, fn: Auth.logout },
  'auth.yo':             { roles: T, fn: function (d, u) { return Auth.publico(u); } },
  'auth.cambiarClave':   { roles: T, write: true, fn: Auth.cambiarClave },
  'auth.autorizar':      { roles: T, fn: function (d, u) { var a = Auth.autorizar(d, null); return { id: a.id, nombre: a.nombre }; } },

  'usuario.listar':      { roles: A, fn: Auth.listar },
  'usuario.guardar':     { roles: A, write: true, fn: Auth.guardar },

  'catalogo.get':        { roles: T, fn: Catalogo.get },
  'categoria.guardar':   { roles: A, write: true, fn: Catalogo.guardarCategoria },
  'producto.guardar':    { roles: A, write: true, fn: Catalogo.guardarProducto },
  'insumo.guardar':      { roles: A, write: true, fn: Catalogo.guardarInsumo },
  'proveedor.guardar':   { roles: A, write: true, fn: Catalogo.guardarProveedor },
  'promocion.guardar':   { roles: A, write: true, fn: Catalogo.guardarPromocion },
  'config.guardar':      { roles: A, write: true, fn: Catalogo.guardarConfig },

  'inventario.compra':   { roles: A, write: true, fn: Inventario.compra },
  'inventario.ajuste':   { roles: A, write: true, fn: Inventario.ajuste },
  'inventario.kardex':   { roles: T, fn: Inventario.kardex },
  'inventario.alertas':  { roles: T, fn: Inventario.alertas },
  'inventario.compras':  { roles: A, fn: Inventario.compras },

  'caja.estado':         { roles: T, fn: Caja.estado },
  'caja.abrir':          { roles: T, write: true, fn: Caja.abrir },
  'caja.movimiento':     { roles: T, write: true, offline: true, fn: Caja.movimiento },
  'caja.cerrar':         { roles: T, write: true, fn: Caja.cerrar },
  'caja.historial':      { roles: T, fn: Caja.historial },
  'caja.detalle':        { roles: T, fn: Caja.detalle },

  'venta.guardar':       { roles: T, write: true, offline: true, fn: Ventas.guardar },
  'venta.abiertas':      { roles: T, fn: Ventas.abiertas },
  'venta.listar':        { roles: T, fn: Ventas.listar },
  'venta.detalle':       { roles: T, fn: Ventas.detalle },
  'venta.anular':        { roles: T, write: true, fn: Ventas.anular },
  'venta.devolver':      { roles: T, write: true, fn: Ventas.devolver },

  'reporte.ventas':      { roles: A, fn: Reportes.ventas },
  'reporte.dashboard':   { roles: T, fn: Reportes.dashboard },
  'auditoria.listar':    { roles: A, fn: Reportes.auditoria },

  // Sincronización de operaciones hechas sin conexión (en orden)
  'sync':                { roles: T, fn: sync_ }
  };
  return ROUTES_;
}

/**
 * Al abrir la URL /exec en el navegador (primera vez): el dueño autoriza los permisos
 * y se crean automáticamente las hojas y el usuario administrador si aún no existen.
 */
function doGet() {
  var creado = asegurarSetup_();
  var html = '<div style="font-family:system-ui,sans-serif;max-width:520px;margin:3rem auto;padding:1.5rem;border-top:6px solid #c62828;box-shadow:0 2px 12px rgba(0,0,0,.12);border-radius:12px">' +
    '<h2 style="margin-top:0">MULAN POS · servidor activo ✔</h2>' +
    '<p>La base de datos está lista en el Google Sheet.</p>' +
    (creado ? '<p><b>Usuario inicial:</b> admin<br><b>Clave:</b> mulan2026<br><b>PIN:</b> 1234<br><small>La app pedirá cambiar la clave en el primer ingreso.</small></p>' : '') +
    '<p style="color:#666">Esta dirección es la API del sistema. Ya puede cerrar esta pestaña y usar la app.</p></div>';
  return HtmlService.createHtmlOutput(html).setTitle('MULAN POS · servidor');
}

/** Crea las hojas si no existen. Devuelve true si las acaba de crear. */
function asegurarSetup_() {
  if (Db.ss().getSheetByName('Usuarios')) return false;
  return conBloqueo_(function () {
    if (Db.ss().getSheetByName('Usuarios')) return false;
    setup();
    return true;
  });
}

function doPost(e) {
  var req;
  try {
    req = JSON.parse(e && e.postData ? e.postData.contents : '{}');
  } catch (ex) {
    return json_({ ok: false, error: 'Petición inválida', code: 400 });
  }
  return json_(handle_(req));
}

function json_(o) {
  return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON);
}

function handle_(req) {
  try {
    Db.reset();
    asegurarSetup_();
    var def = routes_()[req.action];
    if (!def) throw AppError('Acción desconocida: ' + req.action, 404);
    var user = null;
    if (!def.public) {
      user = Auth.check(req.token);
      if (def.roles.indexOf(user.rol) < 0) throw AppError('No tiene permiso para esta operación', 403);
    }
    var run = function () { return def.fn(req.data || {}, user, req); };
    return { ok: true, data: def.write ? conBloqueo_(run) : run() };
  } catch (ex) {
    if (!ex.isApp) console.error(ex && ex.stack ? ex.stack : ex);
    return { ok: false, error: ex.message || String(ex), code: ex.code || 500 };
  }
}

function conBloqueo_(fn) {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(25000)) throw AppError('El sistema está ocupado, intente de nuevo', 503);
  try {
    Db.reset(); // releer datos ya con el bloqueo tomado
    return fn();
  } finally {
    lock.releaseLock();
  }
}

/** Procesa una cola de operaciones offline: [{op_id, action, data}] -> resultados por operación. */
function sync_(d, user, req) {
  var ops = Array.isArray(d.ops) ? d.ops : [];
  return ops.map(function (op) {
    var def = routes_()[op.action];
    if (!def || !def.offline) return { op_id: op.op_id, ok: false, error: 'Operación no sincronizable' };
    if (def.roles.indexOf(user.rol) < 0) return { op_id: op.op_id, ok: false, error: 'Sin permiso' };
    try {
      var r = conBloqueo_(function () { return def.fn(op.data || {}, user, req); });
      return { op_id: op.op_id, ok: true, data: r };
    } catch (ex) {
      return { op_id: op.op_id, ok: false, error: ex.message || String(ex) };
    }
  });
}
