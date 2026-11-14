#!/usr/bin/env node
/**
 * MULAN POS · Instalación guiada (doble clic en INSTALAR-MULAN.cmd o:  npm run instalar)
 *
 * Hace automáticamente todo lo posible y solo se detiene cuando usted debe iniciar sesión
 * o aprobar algo en el navegador. Si se interrumpe, vuelva a ejecutarlo: continúa donde quedó.
 *
 *   1. Prepara los archivos de VS Code y GitHub.
 *   2. Verifica Git y su nombre/correo.
 *   3. Inicia sesión en Google (clasp) con la cuenta de MULAN.
 *   4. Crea el Google Sheet y su proyecto de Apps Script.
 *   5. Conecta la carpeta con su repositorio de GitHub.
 *   6. Publica todo (pruebas → Apps Script → GitHub).
 *   7. Autoriza el servidor y crea la base de datos.
 *   8. Activa GitHub Pages.
 */
const fs = require('fs');
const path = require('path');
const L = require('./lib');

const enter = (msg = 'Cuando termine, presione Enter para continuar…') => L.preguntar(`\n  ${L.c.amarillo}➜${L.c.fin} ${msg} `);
const ACCION = (t) => console.log(`\n  ${L.c.neg}${L.c.amarillo}ACCIÓN SUYA:${L.c.fin} ${t}`);

function plantillas() {
  L.titulo('1. Archivos de VS Code y GitHub');
  [['vscode-settings.json', '.vscode/settings.json'], ['vscode-extensions.json', '.vscode/extensions.json'],
    ['vscode-tasks.json', '.vscode/tasks.json'], ['github-pages.yml', '.github/workflows/pages.yml']].forEach(([o, d]) => {
    const destino = path.join(L.RAIZ, d);
    if (fs.existsSync(destino)) return;
    fs.mkdirSync(path.dirname(destino), { recursive: true });
    fs.copyFileSync(path.join(__dirname, 'plantillas', o), destino);
  });
  L.ok('Tareas de VS Code y flujo de GitHub Pages listos');
}

async function gitListo() {
  L.titulo('2. Git');
  const g = L.git(['--version'], { silencioso: true });
  if (g.status !== 0) L.fallar('Git no está instalado.', 'Instálelo desde https://git-scm.com/download/win y ejecute de nuevo el instalador.');
  L.ok(g.stdout.trim());
  let nombre = L.git(['config', '--global', 'user.name'], { silencioso: true }).stdout.trim();
  let correo = L.git(['config', '--global', 'user.email'], { silencioso: true }).stdout.trim();
  if (!nombre) {
    nombre = await L.preguntar('  Su nombre (para el historial de cambios): ');
    if (nombre) L.git(['config', '--global', 'user.name', nombre], { silencioso: true });
  }
  if (!correo) {
    correo = await L.preguntar('  Su correo de GitHub: ');
    if (correo) L.git(['config', '--global', 'user.email', correo], { silencioso: true });
  }
  if (!nombre || !correo) L.fallar('Git necesita su nombre y correo.');
  L.ok(`Git: ${nombre} <${correo}>`);
}

async function googleListo() {
  L.titulo('3. Cuenta de Google de MULAN');
  let s = L.claspSesion();
  if (!s.loggedIn) {
    ACCION('se abrirá el navegador. Entre con la cuenta de Google de MULAN (la dueña de los datos) y pulse "Permitir".');
    const r = L.clasp(['login']);
    if (r.status !== 0) L.fallar('No se completó el inicio de sesión de Google.', 'Ejecute de nuevo el instalador.');
    s = L.claspSesion();
    if (!s.loggedIn) L.fallar('No se completó el inicio de sesión de Google.');
  }
  L.ok(`Sesión de Google${s.email ? ': ' + s.email : ' iniciada'}`);
  const cambiar = await L.preguntar(`  ¿Es la cuenta de MULAN? (S/n): `);
  if (/^n/i.test(cambiar)) {
    L.clasp(['logout'], { silencioso: true });
    return googleListo();
  }
}

const apiDesactivada = (txt) => /Apps Script API|has not (been )?(used|enabled)|usersettings/i.test(txt);

async function proyectoListo(cfg) {
  L.titulo('4. Google Sheet y proyecto de Apps Script');
  if (cfg.scriptId && fs.existsSync(L.CLASP_JSON)) {
    L.ok('Ya existe: ' + `https://script.google.com/d/${cfg.scriptId}/edit`);
    return;
  }
  for (let intento = 1; intento <= 3; intento++) {
    const tmp = path.join(L.RAIZ, '.mulan-tmp');
    fs.rmSync(tmp, { recursive: true, force: true });
    fs.mkdirSync(tmp);
    const r = L.correr(process.execPath, [L.claspBin(),
      '--json', 'create-script', '--type', 'sheets', '--title', 'MULAN POS - Datos', '--rootDir', '.'], { cwd: tmp, silencioso: true });
    fs.rmSync(tmp, { recursive: true, force: true });
    let out = null;
    try { out = JSON.parse(r.stdout.slice(r.stdout.indexOf('{'))); } catch (e) { /* no JSON */ }
    if (out && out.scriptId) {
      cfg.scriptId = out.scriptId;
      cfg.sheetId = out.parentId || cfg.sheetId;
      L.guardarConfig(cfg);
      fs.writeFileSync(L.CLASP_JSON, JSON.stringify({ scriptId: cfg.scriptId, rootDir: '.' }, null, 2) + '\n');
      L.ok('Google Sheet creado: "MULAN POS - Datos" (en el Drive de la cuenta de MULAN)');
      if (cfg.sheetId) L.info(`https://docs.google.com/spreadsheets/d/${cfg.sheetId}/edit`);
      return;
    }
    const err = (r.stderr + r.stdout).trim();
    if (apiDesactivada(err) && intento < 3) {
      ACCION('hay que activar la API de Apps Script (solo una vez). Se abrirá la página:\n    active "API de Google Apps Script" y espere un minuto.');
      L.abrir('https://script.google.com/home/usersettings');
      await enter();
      continue;
    }
    L.fallar('No se pudo crear el Sheet con su proyecto de Apps Script.', err || 'Sin detalle.');
  }
}

async function githubListo(cfg) {
  L.titulo('5. Repositorio de GitHub');
  if (L.git(['rev-parse', '--is-inside-work-tree'], { silencioso: true }).status !== 0) {
    L.git(['init', '-b', 'main'], { silencioso: true });
    L.ok('Repositorio Git creado en esta carpeta');
  }
  let remoto = L.git(['remote', 'get-url', 'origin'], { silencioso: true }).stdout.trim();
  if (!remoto) {
    ACCION('se abrirá GitHub para crear el repositorio. Inicie sesión si lo pide,\n    deje el nombre "mulan-pos", elija "Public", NO marque "Add a README" y pulse "Create repository".');
    L.abrir('https://github.com/new?name=mulan-pos&visibility=public&description=MULAN%20POS%20-%20Punto%20de%20venta');
    let url = '';
    while (!/github\.com\/[^/\s]+\/[^/\s]+/.test(url)) {
      url = await L.preguntar('\n  Pegue aquí la dirección del repositorio creado (ej. https://github.com/usuario/mulan-pos): ');
      if (!url) L.fallar('Se necesita la dirección del repositorio.', 'Ejecute de nuevo el instalador cuando lo tenga.');
    }
    url = url.replace(/\/+$/, '').replace(/\.git$/, '') + '.git';
    L.git(['remote', 'add', 'origin', url], { silencioso: true });
    remoto = url;
  }
  const m = remoto.match(/github\.com[:/]([^/]+)\/([^/.]+)/);
  if (!m) L.fallar('El repositorio remoto no es de GitHub: ' + remoto);
  cfg.github = { usuario: m[1], repo: m[2] };
  L.guardarConfig(cfg);
  L.ok(`Conectado a github.com/${m[1]}/${m[2]}`);
}

function publicar() {
  L.titulo('6. Publicación');
  console.log(`  ${L.c.gris}(si Windows pide iniciar sesión en GitHub, acepte en la ventana que aparece)${L.c.fin}`);
  const r = L.correr(process.execPath, [path.join(__dirname, 'publicar.js'), '-m', 'Instalación inicial de MULAN POS']);
  if (r.status !== 0) L.fallar('La publicación no terminó.', 'Revise el mensaje de arriba y ejecute de nuevo el instalador: continúa donde quedó.');
}

async function autorizar(cfg) {
  L.titulo('7. Autorizar el servidor y crear la base de datos');
  if (cfg.autorizado) { L.ok('Ya autorizado'); return; }
  ACCION('se abrirá la dirección del servidor con la cuenta de MULAN:\n' +
    '    "Revisar permisos" → elija la cuenta → "Configuración avanzada" → "Ir a MULAN POS (no seguro)" → "Permitir".\n' +
    '    (Es normal: la app es suya y no está publicada en el catálogo de Google.)\n' +
    '    Al final debe ver "MULAN POS · servidor activo ✔" con el usuario inicial.');
  L.abrir(L.urlApi(cfg.deploymentId));
  const r = await enter('¿Ve "servidor activo"? Presione Enter (o escriba N si no):');
  if (/^n/i.test(r)) L.fallar('El servidor no quedó autorizado.', 'Abra de nuevo ' + L.urlApi(cfg.deploymentId) + ' con la cuenta de MULAN y luego ejecute otra vez el instalador.');
  cfg.autorizado = true;
  L.guardarConfig(cfg);
  L.ok('Servidor autorizado y base de datos creada');
}

async function pages(cfg) {
  L.titulo('8. Activar GitHub Pages');
  const { usuario, repo } = cfg.github;
  const app = `https://${usuario.toLowerCase()}.github.io/${repo}/`;
  if (!cfg.pagesActivo) {
    ACCION('se abrirá la configuración de Pages de su repositorio.\n    En "Build and deployment → Source" elija "GitHub Actions" (no hay que guardar nada más).');
    L.abrir(`https://github.com/${usuario}/${repo}/settings/pages`);
    await enter();
    // nueva publicación para que el flujo corra con Pages ya activo
    L.git(['commit', '--allow-empty', '-m', 'Activar GitHub Pages'], { silencioso: true });
    const p = L.git(['push', 'origin', 'HEAD'], { silencioso: true });
    if (p.status !== 0) L.fallar('No se pudo subir a GitHub.', (p.stderr || p.stdout).trim());
    cfg.pagesActivo = true;
    L.guardarConfig(cfg);
  }
  L.ok('GitHub Pages publicando (1-2 minutos). Avance en:');
  L.info(`https://github.com/${usuario}/${repo}/actions`);
  return app;
}

async function main() {
  console.log(`\n${L.c.neg}${L.c.rojo}MULAN POS${L.c.fin}${L.c.neg} · Instalación guiada${L.c.fin}`);
  console.log(`${L.c.gris}Si algo se interrumpe, ejecute de nuevo el instalador: continúa donde quedó.${L.c.fin}`);
  if (Number(process.versions.node.split('.')[0]) < 20) L.fallar('Se necesita Node.js 20 o superior.', 'Instale Node.js LTS desde https://nodejs.org');
  const cfg = L.leerConfig();
  plantillas();
  await gitListo();
  await googleListo();
  await proyectoListo(cfg);
  await githubListo(cfg);
  publicar();
  Object.assign(cfg, L.leerConfig()); // publicar guarda el deploymentId
  await autorizar(cfg);
  const app = await pages(cfg);

  console.log(`\n${L.c.verde}${L.c.neg}¡MULAN POS instalado!${L.c.fin}\n`);
  console.log(`  App (instálela en cada dispositivo):  ${L.c.neg}${app}${L.c.fin}`);
  if (cfg.sheetId) console.log(`  Datos (Google Sheet):                 https://docs.google.com/spreadsheets/d/${cfg.sheetId}/edit`);
  console.log(`  Primer ingreso:                       usuario ${L.c.neg}admin${L.c.fin} · clave ${L.c.neg}mulan2026${L.c.fin} (la app pedirá cambiarla)`);
  console.log(`  Para publicar cambios en el futuro:   doble clic en ${L.c.neg}PUBLICAR-MULAN.cmd${L.c.fin} o  npm run publicar\n`);
  const abrirYa = await L.preguntar('  ¿Abrir la app ahora? (puede tardar 1-2 minutos en estar disponible) (S/n): ');
  if (!/^n/i.test(abrirYa)) L.abrir(app);
}

main()
  .then(() => L.cerrarEntrada())
  .catch((e) => { L.cerrarEntrada(); if (!(e instanceof L.Detener)) console.error(e); process.exitCode = 1; });
