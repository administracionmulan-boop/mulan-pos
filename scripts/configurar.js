#!/usr/bin/env node
/**
 * MULAN POS · Configuración inicial (se ejecuta una sola vez por computador):  npm run configurar
 * Verifica herramientas, sesión de Google (clasp) y conecta esta carpeta con su proyecto de Apps Script.
 */
const fs = require('fs');
const readline = require('readline');
const L = require('./lib');

// Una sola interfaz de lectura (funciona tanto en la terminal como con entrada redirigida)
let rl = null;
const lineas = [];
const esperando = [];
function lector() {
  if (rl) return;
  rl = readline.createInterface({ input: process.stdin, terminal: false });
  rl.on('line', (l) => { const w = esperando.shift(); if (w) w(l.trim()); else lineas.push(l.trim()); });
  rl.on('close', () => { while (esperando.length) esperando.shift()(''); });
}
const preguntar = (q) => new Promise((res) => {
  lector();
  process.stdout.write(q);
  if (lineas.length) res(lineas.shift()); else esperando.push(res);
});

async function main() {
  console.log(`\n${L.c.neg}MULAN POS · Configuración inicial${L.c.fin}`);

  L.titulo('0. Archivos de VS Code y GitHub');
  const path = require('path');
  const plantillas = [
    ['vscode-settings.json', '.vscode/settings.json'],
    ['vscode-extensions.json', '.vscode/extensions.json'],
    ['vscode-tasks.json', '.vscode/tasks.json'],
    ['github-pages.yml', '.github/workflows/pages.yml']
  ];
  plantillas.forEach(([origen, destino]) => {
    const d = path.join(L.RAIZ, destino);
    if (fs.existsSync(d)) return;
    fs.mkdirSync(path.dirname(d), { recursive: true });
    fs.copyFileSync(path.join(__dirname, 'plantillas', origen), d);
    L.ok('Creado ' + destino);
  });
  L.ok('Tareas de VS Code y publicación en GitHub Pages listas');

  L.titulo('1. Herramientas');
  const mayor = Number(process.versions.node.split('.')[0]);
  if (mayor < 20) L.fallar(`Node.js ${process.versions.node} es muy antiguo.`, 'Instale Node.js LTS (20 o superior) desde https://nodejs.org');
  L.ok(`Node.js ${process.versions.node}`);
  const g = L.git(['--version'], { silencioso: true });
  if (g.status !== 0) L.fallar('Git no está instalado.', 'Descárguelo de https://git-scm.com/download/win y reinicie VS Code.');
  L.ok(g.stdout.trim());
  const nombre = L.git(['config', '--global', 'user.name'], { silencioso: true }).stdout.trim();
  const correo = L.git(['config', '--global', 'user.email'], { silencioso: true }).stdout.trim();
  if (!nombre || !correo) {
    L.aviso('Git no tiene configurado su nombre y correo. Ejecute en la terminal:');
    L.info('git config --global user.name "Su Nombre"');
    L.info('git config --global user.email "su-correo@ejemplo.com"');
  } else L.ok(`Git: ${nombre} <${correo}>`);

  L.titulo('2. Sesión de Google (clasp)');
  const s = L.claspSesion();
  if (!s.loggedIn) {
    L.fallar('clasp no ha iniciado sesión con Google.',
      'Ejecute:  npx clasp login\n(se abre el navegador: entre con la cuenta de Google DUEÑA del Sheet)\nY active la API en https://script.google.com/home/usersettings  →  "API de Google Apps Script: Activada".\nLuego vuelva a ejecutar:  npm run configurar');
  }
  L.ok(`Sesión iniciada${s.email ? ' como ' + s.email : ''}`);

  L.titulo('3. Proyecto de Apps Script');
  const cfg = L.leerConfig();
  let scriptId = cfg.scriptId;
  if (scriptId) L.info(`Proyecto actual: ${scriptId}`);
  const resp = await preguntar(`  Pegue el ID del proyecto o la URL del editor de Apps Script${scriptId ? ' (Enter para mantener el actual)' : ''}:\n  > `);
  if (resp) {
    scriptId = L.extraerScriptId(resp);
    if (!scriptId) L.fallar('Eso no parece un ID de Apps Script.', 'Lo encuentra en Apps Script → ⚙ Configuración del proyecto → "ID de la secuencia de comandos",\no copie la URL del editor (https://script.google.com/home/projects/XXXX/edit).');
  }
  if (!scriptId) L.fallar('Se necesita el ID del proyecto de Apps Script.');
  if (scriptId !== cfg.scriptId) delete cfg.deploymentId; // otro proyecto: implementación nueva
  cfg.scriptId = scriptId;
  fs.writeFileSync(L.CLASP_JSON, JSON.stringify({ scriptId, rootDir: '.' }, null, 2) + '\n');
  L.guardarConfig(cfg);
  L.ok('Carpeta backend/ conectada al proyecto (backend/.clasp.json)');

  // comprobar acceso al proyecto
  const st = L.clasp(['list-deployments'], { silencioso: true });
  if (st.status !== 0 || /error|not found|permission|disabled/i.test(st.stderr)) {
    L.fallar('No se pudo acceder al proyecto con esa cuenta.', (st.stderr || st.stdout).trim() +
      '\nVerifique: 1) el ID del proyecto, 2) que la sesión de clasp sea la cuenta dueña del Sheet,\n3) que la API esté activada en https://script.google.com/home/usersettings');
  }
  L.ok('Acceso al proyecto verificado');

  if (!cfg.deploymentId) {
    const dep = await preguntar('  Si ya tiene una implementación de aplicación web, pegue su URL /exec (Enter si aún no):\n  > ');
    if (dep) {
      const id = L.extraerDeploymentId(dep);
      if (!id) L.aviso('No se reconoció la URL; se creará una implementación nueva al publicar.');
      else { cfg.deploymentId = id; L.ok('Implementación registrada'); }
    }
  }
  L.guardarConfig(cfg);

  L.titulo('4. Repositorio de GitHub');
  const esRepo = L.git(['rev-parse', '--is-inside-work-tree'], { silencioso: true }).status === 0;
  const remoto = esRepo ? L.git(['remote', 'get-url', 'origin'], { silencioso: true }).stdout.trim() : '';
  if (remoto) L.ok(`Conectado a ${remoto}`);
  else L.aviso('Aún no está en GitHub. En VS Code: Control de código fuente → "Publicar en GitHub" (repositorio público). Vea la guía, paso 6.');

  console.log(`\n${L.c.verde}${L.c.neg}Listo.${L.c.fin} Siguiente paso: ${L.c.neg}npm run subir-backend${L.c.fin} y luego ejecute setup() en el editor (guía, paso 5).\n`);
}

main().then(() => { if (rl) rl.close(); }).catch((e) => { if (rl) rl.close(); if (!(e instanceof L.Detener)) console.error(e); process.exitCode = 1; });
