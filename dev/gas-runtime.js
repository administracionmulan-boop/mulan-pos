/**
 * Entorno local que simula Google Apps Script (SpreadsheetApp, Utilities, CacheService, LockService...)
 * para ejecutar el backend REAL de /backend sin desplegarlo. Usado por las pruebas y el servidor de desarrollo.
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const crypto = require('crypto');

class MockRange {
  constructor(sheet, r, c, nr, nc) { Object.assign(this, { sheet, r, c, nr, nc }); }
  getValues() {
    const out = [];
    for (let i = 0; i < this.nr; i++) {
      const row = this.sheet.data[this.r - 1 + i] || [];
      const vals = [];
      for (let j = 0; j < this.nc; j++) {
        const v = row[this.c - 1 + j];
        vals.push(v === undefined || v === null ? '' : v);
      }
      out.push(vals);
    }
    return out;
  }
  setValues(vals) {
    if (vals.length !== this.nr || vals.some((r) => r.length !== this.nc)) {
      throw new Error(`Dimensiones incorrectas: datos ${vals.length}x${vals[0] && vals[0].length}, rango ${this.nr}x${this.nc}`);
    }
    vals.forEach((row, i) => {
      const idx = this.r - 1 + i;
      if (!this.sheet.data[idx]) this.sheet.data[idx] = [];
      row.forEach((v, j) => { this.sheet.data[idx][this.c - 1 + j] = v; });
    });
    this.sheet.ss._dirty = true;
    return this;
  }
  setNumberFormat() { return this; }
  setFontWeight() { return this; }
  setBackground() { return this; }
  setFontColor() { return this; }
}

class MockSheet {
  constructor(ss, name, data, maxRows) {
    this.ss = ss; this.name = name; this.data = data || []; this.maxRows = maxRows || 1000;
  }
  getName() { return this.name; }
  getLastRow() {
    for (let i = this.data.length - 1; i >= 0; i--) {
      const r = this.data[i];
      if (r && r.some((v) => v !== '' && v !== null && v !== undefined)) return i + 1;
    }
    return 0;
  }
  getLastColumn() {
    let m = 0;
    this.data.forEach((r) => { if (r) for (let j = r.length - 1; j >= 0; j--) if (r[j] !== '' && r[j] !== undefined) { m = Math.max(m, j + 1); break; } });
    return m;
  }
  getMaxRows() { return this.maxRows; }
  insertRowsAfter(after, n) {
    if (after < this.data.length) this.data.splice(after, 0, ...Array.from({ length: n }, () => []));
    this.maxRows += n;
  }
  getRange(r, c, nr = 1, nc = 1) {
    if (r < 1 || c < 1 || r + nr - 1 > this.maxRows) {
      throw new Error(`Range fuera de la hoja ${this.name}: fila ${r}+${nr} > ${this.maxRows}`);
    }
    return new MockRange(this, r, c, nr, nc);
  }
  getDataRange() { return this.getRange(1, 1, Math.max(this.getLastRow(), 1), Math.max(this.getLastColumn(), 1)); }
  deleteRow(r) { this.data.splice(r - 1, 1); this.maxRows--; this.ss._dirty = true; }
  setFrozenRows() { return this; }
}

class MockSpreadsheet {
  constructor(file) {
    this.file = file; this.sheets = {}; this._dirty = false;
    if (file && fs.existsSync(file)) {
      const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
      Object.keys(raw).forEach((n) => { this.sheets[n] = new MockSheet(this, n, raw[n].data, raw[n].maxRows); });
    }
  }
  getSheetByName(n) { return this.sheets[n] || null; }
  insertSheet(n) { this.sheets[n] = new MockSheet(this, n); this._dirty = true; return this.sheets[n]; }
  save() {
    if (!this.file || !this._dirty) return;
    const o = {};
    Object.keys(this.sheets).forEach((n) => { o[n] = { data: this.sheets[n].data, maxRows: this.sheets[n].maxRows }; });
    fs.writeFileSync(this.file, JSON.stringify(o));
    this._dirty = false;
  }
}

function formatDate(date, tz, fmt) {
  const parts = {};
  new Intl.DateTimeFormat('en-CA', {
    timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23'
  }).formatToParts(date).forEach((p) => { parts[p.type] = p.value; });
  return fmt.replace('yyyy', parts.year).replace('MM', parts.month).replace('dd', parts.day)
    .replace('HH', parts.hour).replace('mm', parts.minute).replace('ss', parts.second);
}

function createRuntime(opts = {}) {
  const ss = new MockSpreadsheet(opts.file);
  const cache = new Map();
  const ctx = {
    console,
    SpreadsheetApp: { getActiveSpreadsheet: () => ss, openById: () => ss },
    PropertiesService: { getScriptProperties: () => ({ getProperty: () => null }) },
    CacheService: {
      getScriptCache: () => ({
        get: (k) => (cache.has(k) ? cache.get(k) : null),
        put: (k, v) => cache.set(k, v),
        remove: (k) => cache.delete(k)
      })
    },
    LockService: { getScriptLock: () => ({ tryLock: () => true, releaseLock: () => {} }) },
    HtmlService: { createHtmlOutput: (h) => ({ content: h, setTitle() { return this; }, getContent() { return h; } }) },
    ContentService: {
      MimeType: { JSON: 'application/json' },
      createTextOutput: (s) => ({ content: s, setMimeType() { return this; }, getContent() { return s; } })
    },
    Utilities: {
      DigestAlgorithm: { SHA_256: 'sha256' },
      Charset: { UTF_8: 'utf8' },
      getUuid: () => crypto.randomUUID(),
      computeDigest: (alg, s) => Array.from(crypto.createHash(alg).update(String(s), 'utf8').digest()).map((b) => (b > 127 ? b - 256 : b)),
      formatDate
    }
  };
  if (opts.now) {
    // reloj controlable para pruebas
    const RealDate = Date;
    let current = new RealDate(opts.now).getTime();
    class FakeDate extends RealDate {
      constructor(...a) { if (a.length) super(...a); else super(current); }
      static now() { return current; }
    }
    ctx.Date = FakeDate;
    ctx.__setNow = (iso) => { current = new RealDate(iso).getTime(); };
  }
  vm.createContext(ctx);
  const dir = path.join(__dirname, '..', 'backend');
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.gs')).sort();
  // Main.gs primero para comprobar que no depende del orden de carga
  files.sort((a, b) => (a === 'Main.gs' ? -1 : b === 'Main.gs' ? 1 : 0));
  files.forEach((f) => vm.runInContext(fs.readFileSync(path.join(dir, f), 'utf8'), ctx, { filename: f }));

  if (!ss.getSheetByName('Usuarios')) ctx.setup();
  ss.save();

  function call(action, data, token) {
    const res = ctx.handle_(JSON.parse(JSON.stringify({ action, data, token })));
    ss.save();
    return JSON.parse(JSON.stringify(res));
  }
  function post(body) {
    const out = ctx.doPost({ postData: { contents: body } });
    ss.save();
    return out.content;
  }
  return { ctx, ss, call, post };
}

module.exports = { createRuntime };
