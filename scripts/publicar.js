#!/usr/bin/env node
/**
 * MULAN POS · Publicar todo con un solo comando:  npm run publicar
 *
 *   1. Ejecuta las pruebas del backend (si fallan, no publica nada).
 *   2. Sube el backend a Apps Script y actualiza la aplicación web (la URL /exec no cambia).
 *   3. Escribe esa URL en frontend/config.js y cambia la versión del service worker
 *      para que los dispositivos instalados descarguen la actualización.
 *   4. Guarda los cambios en Git y los sube a GitHub; GitHub Pages publica la app en 1-2 minutos.
 *
 * Opciones:  --solo-backend   --solo-frontend   --solo-subir (sube código sin implementar)
 *            --sin-pruebas   -m "mensaje del cambio"
 *   npm run publicar -- -m "Agrego mesa 3"
 */
const fs = require('fs');
const path = require('path');
const L = require('./lib');

const args = process.argv.slice(2);
const tiene = (f) => args.includes(f);
const iMsg = Math.max(args.indexOf('-m'), args.indexOf('--mensaje'));
const mensaje = iMsg >= 0 ? args[iMsg + 1] : '';
const soloBack = tiene('--solo-backend');
const soloFront = tiene('--solo-frontend');

const CONFIG_JS = path.join(L.RAIZ, 'frontend', 'config.js');
const SW_JS = path.join(L.RAIZ, 'frontend', 'sw.js');
const ahora = new Date();
const p2 = (n) => String(n).padStart(2, '0');
const sello = `${ahora.getFullYear()}${p2(ahora.getMonth() + 1)}${p2(ahora.getDate())}-${p2(ahora.getHours())}${p2(ahora.getMinutes())}`;
const descripcion = `MULAN ${sello}${mensaje ? ' · ' + mensaje : ''}`;

function apiActual() {
  const m = fs.readFileSync(CONFIG_JS, 'utf8').match(/const API_PRODUCCION = '([^']*)';/);
  if (!m) L.fallar('frontend/config.js no tiene la línea API_PRODUCCION.', 'Restaure el archivo desde el proyecto original.');
  return m[1];
}

function escribirApi(url) {
  const t = fs.readFileSync(CONFIG_JS, 'utf8').replace(/const API_PRODUCCION = '[^']*';/, `const API_PRODUCCION = '${url}';`);
  fs.writeFileSync(CONFIG_JS, t);
}

function pruebas() {
  L.titulo('Pruebas del backend');
  const r = L.correr(process.execPath, ['--test', 'tests/backend.test.js'], { silencioso: true });
  const pasa = (r.stdout.match(/^# pass (\d+)/m) || [])[1];
  const falla = (r.stdout.match(/^# fail (\d+)/m) || [])[1];
  if (r.status !== 0) {
    console.log(r.stdout.split('\n').filter((l) => /^not ok|error:|expected|actual/.test(l.trim())).slice(0, 20).join('\n'));
    L.fallar(`${falla || 'Algunas'} prueba(s) fallaron. No se publicó nada.`, 'Revise el detalle con:  npm test');
  }
  L.ok(`${pasa} pruebas superadas`);
}

function backend(cfg) {
  L.titulo('Backend → Google Apps Script');
  if (!cfg.scriptId || !fs.existsSync(L.CLASP_JSON)) L.fallar('El proyecto no está configurado.', 'Ejecute primero:  npm run configurar');
  const s = L.claspSesion();
  if (!s.loggedIn) L.fallar('clasp no ha iniciado sesión con Google.', 'Ejecute:  npx clasp login');

  const push = L.clasp(['push', '--force'], { silencioso: true });
  if (push.status !== 0) {
    L.fallar('No se pudo subir el código a Apps Script.', (push.stderr || push.stdout).trim() +
      '\n¿Activó la API? https://script.google.com/home/usersettings');
  }
  L.ok(`Código subido (${fs.readdirSync(path.join(L.RAIZ, 'backend')).filter((f) => f.endsWith('.gs')).length} archivos .gs + manifiesto)`);

  if (tiene('--solo-subir')) { L.info('Solo se subió el código (sin actualizar la aplicación web).'); return false; }

  const dargs = ['--json', 'create-deployment', '-d', descripcion];
  if (cfg.deploymentId) dargs.push('-i', cfg.deploymentId);
  const dep = L.clasp(dargs, { silencioso: true });
  let out = null;
  try { out = JSON.parse(dep.stdout.slice(dep.stdout.indexOf('{'))); } catch (e) { /* salida no JSON */ }
  if (dep.status !== 0 || !out || !out.deploymentId) {
    L.fallar('No se pudo actualizar la aplicación web.', (dep.stderr || dep.stdout).trim() +
      (cfg.deploymentId ? '\nSi borró la implementación en Apps Script, quite "deploymentId" de mulan.config.json y publique de nuevo.' : ''));
  }
  const nueva = !cfg.deploymentId;
  cfg.deploymentId = out.deploymentId;
  cfg.ultimaPublicacionBackend = ahora.toISOString();
  L.guardarConfig(cfg);
  L.ok(`Aplicación web ${nueva ? 'creada' : 'actualizada'} · versión ${out.versionNumber || '?'}`);
  const url = L.urlApi(out.deploymentId);
  if (apiActual() !== url) {
    escribirApi(url);
    L.ok('URL de la API escrita en frontend/config.js');
    return true; // el frontend debe publicarse
  }
  L.info(url);
  return false;
}

function frontend() {
  L.titulo('Frontend → GitHub Pages');
  if (!apiActual()) L.fallar('La app aún no conoce la URL del backend.', 'Publique primero el backend:  npm run publicar');
  if (L.git(['rev-parse', '--is-inside-work-tree'], { silencioso: true }).status !== 0) {
    L.fallar('Esta carpeta todavía no es un repositorio Git.', 'En VS Code: Control de código fuente → "Publicar en GitHub" (guía, paso 6).');
  }
  const remoto = L.git(['remote', 'get-url', 'origin'], { silencioso: true }).stdout.trim();
  if (!remoto) L.fallar('El repositorio no está conectado a GitHub.', 'En VS Code: Control de código fuente → "Publicar rama" / "Publicar en GitHub".');

  const sw = fs.readFileSync(SW_JS, 'utf8').replace(/const VERSION = '[^']*';/, `const VERSION = 'mulan-${sello}';`);
  fs.writeFileSync(SW_JS, sw);
  L.ok(`Versión de la app: mulan-${sello}`);

  L.git(['add', '-A'], { silencioso: true });
  const hayCambios = L.git(['diff', '--cached', '--quiet'], { silencioso: true }).status !== 0;
  if (hayCambios) {
    const c = L.git(['commit', '-m', mensaje || `Publicación ${sello}`], { silencioso: true });
    if (c.status !== 0) L.fallar('No se pudo guardar el cambio en Git.', (c.stderr || c.stdout).trim());
    L.ok('Cambios guardados (commit)');
  } else L.info('Sin cambios nuevos para guardar');

  const rama = L.git(['rev-parse', '--abbrev-ref', 'HEAD'], { silencioso: true }).stdout.trim() || 'main';
  const p = L.git(['push', '-u', 'origin', rama], { silencioso: true });
  if (p.status !== 0) L.fallar('No se pudo subir a GitHub.', (p.stderr || p.stdout).trim() + '\nVerifique su conexión e inicio de sesión de GitHub en VS Code.');
  L.ok(`Subido a GitHub (${rama})`);
  const m = remoto.match(/github\.com[:/]([^/]+)\/([^/.]+)/);
  if (m) L.info(`La app quedará en https://${m[1].toLowerCase()}.github.io/${m[2]}/  (1-2 minutos; progreso en la pestaña Actions del repositorio)`);
}

function main() {
  console.log(`\n${L.c.neg}MULAN POS · Publicar${L.c.fin}  ${L.c.gris}${descripcion}${L.c.fin}`);
  if (!tiene('--sin-pruebas')) pruebas();
  const cfg = L.leerConfig();
  let forzarFront = false;
  if (!soloFront) forzarFront = backend(cfg);
  if (tiene('--solo-subir')) { console.log(`\n${L.c.verde}${L.c.neg}Código subido.${L.c.fin} Ahora ejecute setup() en el editor de Apps Script (guía, paso 5).\n`); return; }
  if (!soloBack || forzarFront) {
    if (soloBack) L.aviso('La URL del backend cambió: también se publica el frontend.');
    frontend();
  }
  console.log(`\n${L.c.verde}${L.c.neg}Publicación terminada.${L.c.fin}\n`);
}

try { main(); } catch (e) { if (!(e instanceof L.Detener)) console.error(e); process.exitCode = 1; }
