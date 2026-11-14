// Utilidades compartidas por los scripts de configuración y publicación de MULAN POS.
const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const RAIZ = path.join(__dirname, '..');
const CONFIG = path.join(RAIZ, 'mulan.config.json');
const CLASP_JSON = path.join(RAIZ, 'backend', '.clasp.json');

const c = { rojo: '\x1b[31m', verde: '\x1b[32m', amarillo: '\x1b[33m', gris: '\x1b[90m', neg: '\x1b[1m', fin: '\x1b[0m' };
const titulo = (t) => console.log(`\n${c.neg}${c.rojo}■${c.fin} ${c.neg}${t}${c.fin}`);
const ok = (t) => console.log(`  ${c.verde}✔${c.fin} ${t}`);
const aviso = (t) => console.log(`  ${c.amarillo}!${c.fin} ${t}`);
const info = (t) => console.log(`  ${c.gris}${t}${c.fin}`);

class Detener extends Error {}
function fallar(msg, ayuda) {
  console.log(`\n  ${c.rojo}✖ ${msg}${c.fin}`);
  if (ayuda) console.log(`    ${ayuda.split('\n').join('\n    ')}`);
  throw new Detener(msg);
}

/** Ejecuta un comando. silencioso=true captura la salida en vez de mostrarla. */
function correr(cmd, args, { cwd = RAIZ, silencioso = false } = {}) {
  const r = spawnSync(cmd, args, { cwd, encoding: 'utf8', stdio: silencioso ? 'pipe' : 'inherit', shell: false });
  if (r.error && r.error.code === 'ENOENT') return { status: 127, stdout: '', stderr: `No se encontró "${cmd}"` };
  return { status: r.status, stdout: r.stdout || '', stderr: r.stderr || '' };
}

/** Ruta del clasp instalado en el proyecto (o MULAN_CLASP para pruebas). */
function claspBin() {
  if (process.env.MULAN_CLASP) return process.env.MULAN_CLASP;
  const p = path.join(RAIZ, 'node_modules', '@google', 'clasp', 'build', 'src', 'index.js');
  if (!fs.existsSync(p)) fallar('No está instalado clasp en el proyecto.', 'Ejecute primero:  npm install');
  return p;
}

function clasp(args, opts = {}) {
  return correr(process.execPath, [claspBin(), ...args], { cwd: path.join(RAIZ, 'backend'), ...opts });
}

function claspSesion() {
  const r = clasp(['--json', 'show-authorized-user'], { silencioso: true });
  try { return JSON.parse(r.stdout); } catch (e) { return { loggedIn: false }; }
}

function git(args, opts = {}) { return correr('git', args, opts); }

function leerConfig() {
  if (!fs.existsSync(CONFIG)) return {};
  return JSON.parse(fs.readFileSync(CONFIG, 'utf8'));
}
function guardarConfig(cfg) { fs.writeFileSync(CONFIG, JSON.stringify(cfg, null, 2) + '\n'); }

/** Extrae el ID de un proyecto de Apps Script de un ID o de la URL del editor. */
function extraerScriptId(txt) {
  const s = String(txt || '').trim();
  const m = s.match(/projects\/([A-Za-z0-9_-]{20,})/) || s.match(/^([A-Za-z0-9_-]{20,})$/);
  return m ? m[1] : null;
}

/** Extrae el ID de implementación de un ID o de una URL .../macros/s/ID/exec */
function extraerDeploymentId(txt) {
  const s = String(txt || '').trim();
  const m = s.match(/macros\/s\/([A-Za-z0-9_-]{20,})/) || s.match(/^(AKfy[A-Za-z0-9_-]{20,})$/);
  return m ? m[1] : null;
}

// Lectura de respuestas del usuario (una sola interfaz; funciona en terminal y con entrada redirigida)
const readline = require('readline');
let rl = null;
const lineas = [];
const esperando = [];
function preguntar(q) {
  if (!rl) {
    rl = readline.createInterface({ input: process.stdin, terminal: false });
    rl.on('line', (l) => { const w = esperando.shift(); if (w) w(l.trim()); else lineas.push(l.trim()); });
    rl.on('close', () => { while (esperando.length) esperando.shift()(''); });
  }
  process.stdout.write(q);
  return new Promise((res) => { if (lineas.length) res(lineas.shift()); else esperando.push(res); });
}
function cerrarEntrada() { if (rl) rl.close(); }

/** Abre una dirección en el navegador predeterminado. */
function abrir(url) {
  if (process.env.MULAN_NO_ABRIR) return;
  if (process.platform === 'win32') spawnSync('rundll32', ['url.dll,FileProtocolHandler', url], { stdio: 'ignore' });
  else spawnSync(process.platform === 'darwin' ? 'open' : 'xdg-open', [url], { stdio: 'ignore' });
}

const urlApi = (deploymentId) => `https://script.google.com/macros/s/${deploymentId}/exec`;

module.exports = { claspBin, preguntar, cerrarEntrada, abrir, RAIZ, CONFIG, CLASP_JSON, c, titulo, ok, aviso, info, fallar, Detener, correr, clasp, claspSesion, git, leerConfig, guardarConfig, extraerScriptId, extraerDeploymentId, urlApi };
