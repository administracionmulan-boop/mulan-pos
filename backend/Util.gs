/**
 * MULAN POS - Utilidades generales del backend (Google Apps Script).
 */
var APP_VERSION = '1.0.0';
var TZ = 'America/Bogota';
var FMT_FECHA = 'yyyy-MM-dd HH:mm:ss';

/** Error de negocio con código HTTP-like. */
function AppError(msg, code) {
  var e = new Error(msg);
  e.code = code || 400;
  e.isApp = true;
  return e;
}

function uuid_() {
  return Utilities.getUuid();
}

/** Fecha local (texto) yyyy-MM-dd HH:mm:ss. Acepta Date, ISO o vacío (ahora). */
function fecha_(d) {
  if (!d) d = new Date();
  if (!(d instanceof Date)) {
    var p = new Date(d);
    if (isNaN(p.getTime())) {
      // ya viene en formato local yyyy-MM-dd HH:mm:ss
      if (/^\d{4}-\d{2}-\d{2}/.test(String(d))) return String(d).substring(0, 19);
      p = new Date();
    }
    d = p;
  }
  return Utilities.formatDate(d, TZ, FMT_FECHA);
}

function hoy_() {
  return fecha_().substring(0, 10);
}

function num_(v) {
  var n = Number(v);
  return isFinite(n) ? n : 0;
}

/** Redondeo a pesos (sin decimales) por defecto. */
function round_(v, dec) {
  var f = Math.pow(10, dec || 0);
  return Math.round(num_(v) * f) / f;
}

function str_(v) {
  return v === null || v === undefined ? '' : String(v).trim();
}

function req_(obj, campos) {
  campos.forEach(function (c) {
    if (obj[c] === undefined || obj[c] === null || str_(obj[c]) === '') {
      throw AppError('El campo "' + c + '" es obligatorio');
    }
  });
}

function indexBy_(arr, key) {
  var m = {};
  arr.forEach(function (o) { m[o[key || 'id']] = o; });
  return m;
}

function sum_(arr, fn) {
  return arr.reduce(function (a, o) { return a + num_(fn(o)); }, 0);
}

/** Copia pública de un registro (sin campos internos). */
function pub_(o, omit) {
  var r = {};
  Object.keys(o).forEach(function (k) {
    if (k.charAt(0) === '_') return;
    if (omit && omit.indexOf(k) >= 0) return;
    r[k] = o[k];
  });
  return r;
}

function hex_(bytes) {
  return bytes.map(function (b) {
    var v = (b < 0 ? b + 256 : b).toString(16);
    return v.length === 1 ? '0' + v : v;
  }).join('');
}

function sha256_(s) {
  return hex_(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, s, Utilities.Charset.UTF_8));
}

/** Lunes (yyyy-MM-dd) de la semana de una fecha local yyyy-MM-dd. */
function lunes_(ymd) {
  var p = ymd.split('-');
  var d = new Date(Date.UTC(+p[0], +p[1] - 1, +p[2]));
  var dow = (d.getUTCDay() + 6) % 7; // 0 = lunes
  d.setUTCDate(d.getUTCDate() - dow);
  return d.toISOString().substring(0, 10);
}

function sumarDias_(ymd, n) {
  var p = ymd.split('-');
  var d = new Date(Date.UTC(+p[0], +p[1] - 1, +p[2]));
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().substring(0, 10);
}

function diasEntre_(a, b) {
  var pa = a.split('-'), pb = b.split('-');
  return Math.round((Date.UTC(+pb[0], +pb[1] - 1, +pb[2]) - Date.UTC(+pa[0], +pa[1] - 1, +pa[2])) / 86400000);
}

/** Día de la semana 1=lunes ... 7=domingo de una fecha local. */
function diaSemana_(ymd) {
  var p = ymd.split('-');
  var d = new Date(Date.UTC(+p[0], +p[1] - 1, +p[2]));
  return ((d.getUTCDay() + 6) % 7) + 1;
}

function auditar_(user, accion, entidad, id, detalle) {
  Db.insert('Auditoria', {
    id: uuid_(),
    fecha: fecha_(),
    usuario_id: user ? user.id : '',
    accion: accion,
    entidad: entidad || '',
    entidad_id: id || '',
    detalle: typeof detalle === 'string' ? detalle : JSON.stringify(detalle || '')
  });
}
