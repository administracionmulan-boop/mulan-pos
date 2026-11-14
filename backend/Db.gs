/**
 * MULAN POS - Capa de acceso a datos sobre Google Sheets.
 * Lee cada hoja una sola vez por petición (caché en memoria) y escribe por filas.
 */
var Db = (function () {
  var cache = {};
  var _ss = null;

  function ss() {
    if (_ss) return _ss;
    var id = PropertiesService.getScriptProperties().getProperty('SHEET_ID');
    _ss = id ? SpreadsheetApp.openById(id) : SpreadsheetApp.getActiveSpreadsheet();
    if (!_ss) throw AppError('No se encontró la hoja de cálculo. Configure la propiedad SHEET_ID.', 500);
    return _ss;
  }

  function sheet(t) {
    var sh = ss().getSheetByName(t);
    if (!sh) throw AppError('Falta la hoja "' + t + '". Ejecute setup() en Apps Script.', 500);
    return sh;
  }

  function decode(v, type) {
    if (type === 'n') return v === '' || v === null ? 0 : num_(v);
    if (type === 'b') return v === true || v === 'TRUE' || v === 'true' || v === 1 || v === '1';
    if (v instanceof Date) {
      // celdas que Sheets convirtió a fecha: devolver texto local
      var s = Utilities.formatDate(v, TZ, FMT_FECHA);
      return s.substring(11) === '00:00:00' ? s.substring(0, 10) : s;
    }
    return v === null || v === undefined ? '' : String(v);
  }

  function encode(v, type) {
    if (type === 'n') return num_(v);
    if (type === 'b') return v === true || v === 'true' || v === 1 || v === 'TRUE';
    return v === null || v === undefined ? '' : String(v);
  }

  function all(t) {
    if (cache[t]) return cache[t];
    var c = cols_(t);
    var sh = sheet(t);
    var last = sh.getLastRow();
    var rows = [];
    if (last >= 2) {
      var vals = sh.getRange(2, 1, last - 1, c.length).getValues();
      for (var i = 0; i < vals.length; i++) {
        var r = vals[i];
        if (r.join('') === '') continue; // fila vacía
        var o = { _row: i + 2 };
        for (var j = 0; j < c.length; j++) o[c[j].name] = decode(r[j], c[j].type);
        rows.push(o);
      }
    }
    cache[t] = rows;
    return rows;
  }

  function find(t, id, key) {
    key = key || 'id';
    var rows = all(t);
    for (var i = 0; i < rows.length; i++) if (rows[i][key] === id) return rows[i];
    return null;
  }

  function where(t, fn) {
    return all(t).filter(fn);
  }

  function toRow(t, obj) {
    return cols_(t).map(function (c) { return encode(obj[c.name], c.type); });
  }

  function ensureCapacity(sh, needed) {
    var max = sh.getMaxRows();
    if (needed > max) sh.insertRowsAfter(max, needed - max + 200);
  }

  function insertMany(t, objs) {
    if (!objs.length) return objs;
    var sh = sheet(t);
    var c = cols_(t);
    var rows = all(t);
    var start = sh.getLastRow() + 1;
    ensureCapacity(sh, start + objs.length - 1);
    sh.getRange(start, 1, objs.length, c.length).setValues(objs.map(function (o) { return toRow(t, o); }));
    objs.forEach(function (o, i) {
      var copy = {};
      c.forEach(function (col) { copy[col.name] = decode(encode(o[col.name], col.type), col.type); });
      copy._row = start + i;
      rows.push(copy);
    });
    return objs;
  }

  function insert(t, obj) {
    insertMany(t, [obj]);
    return find(t, obj[cols_(t)[0].name], cols_(t)[0].name) || obj;
  }

  function update(t, id, patch, key) {
    var rec = find(t, id, key);
    if (!rec) throw AppError('Registro no encontrado en ' + t, 404);
    Object.keys(patch).forEach(function (k) { if (k.charAt(0) !== '_') rec[k] = patch[k]; });
    var c = cols_(t);
    c.forEach(function (col) { rec[col.name] = decode(encode(rec[col.name], col.type), col.type); });
    sheet(t).getRange(rec._row, 1, 1, c.length).setValues([toRow(t, rec)]);
    return rec;
  }

  /** Elimina filas que cumplan la condición (de abajo hacia arriba). */
  function removeWhere(t, fn) {
    var sh = sheet(t);
    var rows = all(t).filter(fn).map(function (r) { return r._row; }).sort(function (a, b) { return b - a; });
    rows.forEach(function (r) { sh.deleteRow(r); });
    if (rows.length) delete cache[t];
    return rows.length;
  }

  /** Inserta o actualiza por id. */
  function upsert(t, obj) {
    if (obj.id && find(t, obj.id)) return update(t, obj.id, obj);
    if (!obj.id) obj.id = uuid_();
    return insert(t, obj);
  }

  function reset() { cache = {}; }

  return {
    ss: ss, all: all, find: find, where: where, insert: insert, insertMany: insertMany,
    update: update, upsert: upsert, removeWhere: removeWhere, reset: reset
  };
})();

/** Configuración como objeto clave/valor. */
function config_() {
  var c = {};
  Object.keys(CONFIG_DEFAULT).forEach(function (k) { c[k] = CONFIG_DEFAULT[k]; });
  Db.all('Config').forEach(function (r) { c[r.clave] = r.valor; });
  return c;
}
