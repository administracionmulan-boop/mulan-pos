/**
 * Prueba de punta a punta en navegador (Playwright + Chromium) contra el servidor de desarrollo.
 * Recorre: primer ingreso -> catálogo -> recetas -> compra -> caja -> POS (llevar, mesa, domicilio)
 * -> venta sin conexión y sincronización -> anulación -> cierre de caja -> reportes.
 * Uso: node tests/e2e.js [carpeta-capturas]
 */
const { chromium } = require('playwright');
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');

const PORT = 8123;
const URL = `http://localhost:${PORT}/`;
const SHOTS = process.argv[2] || path.join(os.tmpdir(), 'mulan-shots');
fs.mkdirSync(SHOTS, { recursive: true });
const DATA = path.join(os.tmpdir(), `mulan-e2e-${Date.now()}.json`);

let paso = 0;
const log = (m) => console.log(`  ✔ ${++paso}. ${m}`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const srv = spawn(process.execPath, [path.join(__dirname, '..', 'dev', 'server.js'), String(PORT)], { env: { ...process.env, MULAN_DATA: DATA }, stdio: 'pipe' });
  await sleep(800);
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1366, height: 860 } });
  const page = await ctx.newPage();
  const errores = [];
  page.on('pageerror', (e) => errores.push('pageerror: ' + (e.stack || e.message)));
  page.on('console', (m) => { if (m.type() === 'error' && !/Failed to fetch|ERR_INTERNET_DISCONNECTED|net::/.test(m.text())) errores.push('console: ' + m.text()); });
  page.on('dialog', (d) => d.accept());
  const shot = (n) => page.screenshot({ path: path.join(SHOTS, n + '.png'), fullPage: false });
  const modalBtn = (txt) => page.locator('.modal-foot button', { hasText: txt }).last();
  const toastHas = async (txt) => page.locator('.toast', { hasText: txt }).first().waitFor({ timeout: 8000 });
  const ir = async (r) => { await page.goto(URL + '#/' + r); await page.waitForSelector('#view .loading', { state: 'detached' }).catch(() => {}); await sleep(300); };

  try {
    // ---- Etapa 0: ingreso y cambio de clave obligatorio ----
    await page.goto(URL);
    await page.waitForSelector('#login-form');
    await shot('01-login');
    await page.fill('[name=usuario]', 'admin');
    await page.fill('[name=password]', 'mulan2026');
    await page.click('#login-form button');
    await page.waitForSelector('.modal >> text=Cree su clave personal');
    await page.fill('.modal [name=actual]', 'mulan2026');
    await page.fill('.modal [name=nueva]', 'Admin-2026');
    await page.fill('.modal [name=nueva2]', 'Admin-2026');
    await page.fill('.modal [name=pin]', '2468');
    await modalBtn('Guardar').click();
    await toastHas('Clave actualizada');
    log('Primer ingreso de administrador con cambio de clave y PIN');

    // ---- Etapa 1-3: proveedores, insumos, productos con receta, compra ----
    await ir('proveedores');
    await page.click('#np');
    await page.fill('.modal [name=nombre]', 'Distribuidora La Granja');
    await page.fill('.modal [name=telefono]', '3105556677');
    await modalBtn('Guardar').click();
    await toastHas('Proveedor guardado');
    log('Proveedor creado');

    await ir('inventario');
    const insumos = [['Pollo', 'g', 2000, 14, 8000], ['Arroz', 'g', 1000, 4, 5000], ['Gaseosa 400ml', 'und', 10, 1800, 12], ['Papa', 'g', 1500, 3, 6000]];
    for (const [n, u, min, costo, ini] of insumos) {
      await page.click('#b-nuevo');
      await page.fill('.modal [name=nombre]', n);
      await page.selectOption('.modal [name=unidad]', u);
      await page.fill('.modal [name=stock_minimo]', String(min));
      await page.fill('.modal [name=costo_unitario]', String(costo));
      await page.fill('.modal [name=stock_inicial]', String(ini));
      await modalBtn('Guardar').click();
      await toastHas('Insumo guardado');
      await page.waitForSelector('#tabla-ins');
      await sleep(400);
    }
    await page.waitForSelector(`#tabla-ins >> text=Papa`);
    log('4 insumos creados con stock inicial');

    // compra: 2000 g de pollo por $30.000
    await page.click('#b-compra');
    await page.selectOption('.modal [name=proveedor_id]', { label: 'Distribuidora La Granja' });
    await page.fill('.modal [name=factura]', 'FV-100');
    await page.selectOption('.modal [data-k=insumo_id]', { label: 'Pollo (g)' });
    await page.fill('.modal [data-k=cantidad]', '2000');
    await page.fill('.modal [data-k=total]', '30000');
    await shot('02-compra');
    await modalBtn('Registrar compra').click();
    await toastHas('Compra registrada');
    await page.waitForSelector('#tabla-ins');
    log('Compra registrada (entrada de inventario + costo promedio)');

    await ir('productos');
    const prods = [
      ['Pollo asado con papas', 'Platos', 22000, [['Pollo (g)', 300], ['Papa (g)', 250]]],
      ['Arroz con pollo', 'Platos', 18000, [['Pollo (g)', 200], ['Arroz (g)', 200]]],
      ['Gaseosa', 'Bebidas', 4000, [['Gaseosa 400ml (und)', 1]]]
    ];
    for (const [n, c, precio, rec] of prods) {
      await page.click('#np');
      await page.fill('.modal [name=nombre]', n);
      await page.selectOption('.modal [name=categoria_id]', { label: c });
      await page.fill('.modal [name=precio]', String(precio));
      if (n.startsWith('Pollo')) await page.fill('.modal [name=modificadores]', 'Sin sal, Extra papa');
      for (let i = 0; i < rec.length; i++) {
        await page.click('.modal #addr');
        await page.selectOption(`.modal [data-k=insumo_id][data-i="${i}"]`, { label: rec[i][0] });
        await page.fill(`.modal [data-k=cantidad][data-i="${i}"]`, String(rec[i][1]));
      }
      if (n.startsWith('Pollo')) await shot('03-receta');
      await modalBtn('Guardar').click();
      await toastHas('Producto guardado');
      await page.waitForSelector(`#lp >> text=${n}`);
    }
    const margen = await page.locator('#lp tr', { hasText: 'Gaseosa' }).locator('.badge').first().innerText();
    if (!margen.includes('55')) throw new Error('Margen de gaseosa inesperado: ' + margen);
    await shot('04-productos');
    log('3 productos con receta; costo y margen calculados (gaseosa 55 %)');

    await ir('promociones');
    await page.click('#np');
    await page.fill('.modal [name=nombre]', 'Gaseosa en promo');
    await page.selectOption('.modal [name=tipo]', 'VALOR');
    await page.fill('.modal [name=valor]', '500');
    await page.selectOption('.modal [name=ref_id]', { label: 'Gaseosa' });
    await modalBtn('Guardar').click();
    await toastHas('Promoción guardada');
    log('Promoción automática creada');

    await ir('usuarios');
    await page.click('#nu');
    await page.fill('.modal [name=nombre]', 'Laura Cajera');
    await page.fill('.modal [name=usuario]', 'laura');
    await page.fill('.modal [name=password]', 'laura123');
    await modalBtn('Guardar').click();
    await toastHas('Usuario guardado');
    log('Usuario cajero creado');

    await ir('config');
    await page.fill('[name=negocio_nit]', '900.123.456-7');
    await page.fill('[name=impuesto_pct]', '8');
    await page.fill('[name=mesas]', 'Mesa 1,Mesa 2,Barra');
    await page.click('#fc button');
    await toastHas('Configuración guardada');
    log('Configuración: impoconsumo 8 % y 3 mesas');

    // ---- Etapa 4: caja ----
    await ir('caja');
    await page.fill('#fa [name=base]', '100000');
    await page.click('#fa button');
    await toastHas('Caja abierta');
    await page.click('[data-mov=EGRESO]');
    await page.fill('.modal [name=valor]', '8000');
    await page.fill('.modal [name=concepto]', 'Hielo');
    await modalBtn('Registrar').click();
    await toastHas('Movimiento registrado');
    log('Caja abierta con base $100.000 y egreso registrado');

    // ---- Etapa 5: POS ----
    await ir('pos');
    await page.waitForSelector('.prod');
    // para llevar: 2 pollos + 1 gaseosa (promo) = 44000 + 3500 = 47500
    await page.click('.prod:has-text("Pollo asado")');
    await page.click('.prod:has-text("Pollo asado")');
    await page.click('.prod:has-text("Gaseosa")');
    await page.click('[data-nota="0"]');
    await page.click('.modal [data-mod="Sin sal"]');
    await modalBtn('Guardar').click();
    const tot = await page.locator('#t-total').innerText();
    if (!tot.includes('47.500')) throw new Error('Total esperado 47.500 y fue ' + tot);
    await shot('05-pos');
    await page.click('#t-cobrar');
    await page.click('.modal [data-b="50000"]');
    await page.waitForSelector('.modal #c-cambio:has-text("2.500")');
    await shot('06-cobro');
    await modalBtn('Confirmar pago').click();
    await page.waitForSelector('.modal >> text=Venta #1');
    await page.waitForSelector('.modal .ticket >> text=Incluye Impoconsumo');
    await shot('07-comprobante');
    await modalBtn('Nueva venta').click();
    log('Venta para llevar cobrada en un clic (total $47.500, cambio $2.500, comprobante con impuesto)');

    // mesa: comanda y luego cobro mixto
    await page.click('.mesa[data-m="Mesa 2"]');
    await page.click('.prod:has-text("Arroz con pollo")');
    await page.click('.prod:has-text("Gaseosa")');
    await page.click('#t-guardar');
    await page.waitForSelector('.modal >> text=Comanda guardada');
    await shot('08-comanda');
    await modalBtn('Cerrar').click();
    await page.waitForSelector('.mesa.ocupada[data-m="Mesa 2"]');
    await page.click('.mesa[data-m="Mesa 2"]');
    await page.click('.prod:has-text("Gaseosa")'); // agregan otra bebida
    await page.click('#t-cobrar');
    await page.click('.modal [data-met="TRANSFERENCIA"]');
    await page.fill('.modal #c-valor', '10000');
    await page.fill('.modal #c-ref', 'Nequi 555');
    await page.click('.modal #c-add');
    await page.fill('.modal #c-valor', '15000');
    await page.click('.modal [data-met="EFECTIVO"]');
    await modalBtn('Confirmar pago').click();
    await page.waitForSelector('.modal >> text=Venta #2');
    await modalBtn('Nueva venta').click();
    log('Comanda de mesa guardada, ampliada y cobrada con pago mixto (transferencia + efectivo)');

    // domicilio con descuento alto como admin (no pide PIN)
    await page.click('#t-tipo [data-t=DOMICILIO]');
    await page.fill('#t-cliente', 'Carlos');
    await page.fill('#t-tel', '3001112233');
    await page.fill('#t-dir', 'Calle 10 # 5-20');
    await page.click('.prod:has-text("Pollo asado")');
    await page.click('#t-cobrar');
    await modalBtn('Confirmar pago').click();
    await page.waitForSelector('.modal >> text=Venta #3');
    await modalBtn('Nueva venta').click();
    log('Domicilio cobrado con valor de envío');

    // ---- Etapa 6: venta sin conexión ----
    await ctx.setOffline(true);
    await page.evaluate(() => window.dispatchEvent(new Event('offline')));
    await page.waitForSelector('.sync-pill.off');
    await page.click('.prod:has-text("Arroz con pollo")');
    await page.click('#t-cobrar');
    await modalBtn('Confirmar pago').click();
    await toastHas('Sin conexión');
    await page.waitForSelector('.modal .ticket >> text=Pendiente de sincronizar');
    await shot('09-offline');
    await modalBtn('Nueva venta').click();
    const pill = await page.locator('#sync-pill').innerText();
    if (!pill.includes('1 pendiente')) throw new Error('Debía haber 1 pendiente: ' + pill);
    await ctx.setOffline(false);
    await page.evaluate(() => window.dispatchEvent(new Event('online')));
    await page.waitForFunction(() => document.querySelector('#sync-pill').textContent === 'En línea', null, { timeout: 15000 });
    log('Venta sin conexión guardada en el dispositivo y sincronizada al volver el internet');

    // ---- Anulación desde ventas ----
    await ir('ventas');
    await page.waitForSelector('#lista tr.clickable');
    const nVentas = await page.locator('#lista tr.clickable').count();
    if (nVentas !== 4) throw new Error('Se esperaban 4 ventas y hay ' + nVentas);
    await page.locator('#lista tr.clickable', { hasText: '#3' }).click();
    await modalBtn('Anular').click();
    await page.fill('.modal #mot', 'Cliente canceló el domicilio');
    await modalBtn('Anular venta').click();
    await toastHas('anulada');
    await page.waitForSelector('#lista >> text=ANULADA');
    await shot('10-ventas');
    log('Venta #3 anulada (dinero e inventario revertidos)');

    // ---- Cierre de caja ----
    await ir('caja');
    const esperado = await page.locator('.kpi:has-text("Efectivo esperado") .val').innerText();
    // 100000 - 8000 + 47500 + 15000 + 18000 (offline) = 172500
    if (!esperado.includes('172.500')) throw new Error('Efectivo esperado inesperado: ' + esperado);
    await page.click('#cerrar');
    await page.fill('.modal [data-den="100000"]', '1');
    await page.fill('.modal [data-den="50000"]', '1');
    await page.fill('.modal [data-den="20000"]', '1');
    await page.fill('.modal [data-den="2000"]', '1');
    await page.waitForSelector('.modal #dif:has-text("-500")');
    await shot('11-arqueo');
    await modalBtn('Cerrar caja').click();
    await page.waitForSelector('.modal >> text=CIERRE DE CAJA');
    await modalBtn('Cerrar').click();
    await page.waitForSelector('#fa');
    log('Cierre de caja con arqueo por denominaciones (esperado $172.500, faltante $500)');

    // ---- Etapa 7: reportes e inicio ----
    await ir('reportes');
    await page.waitForSelector('#ch-serie');
    await sleep(800);
    const netas = await page.locator('.kpi:has-text("Ventas netas") .val').innerText();
    if (!netas.includes('90.500')) throw new Error('Ventas netas inesperadas: ' + netas);
    await shot('12-reportes');
    await page.click('#presets [data-p=anio]');
    await page.waitForSelector('#ch-serie');
    log('Reportes: ventas netas $90.500, gráficos y comparativo; vista anual');

    await ir('inventario');
    await page.waitForSelector('#tabla-ins');
    await shot('13-inventario');
    await ir('inicio');
    await page.waitForSelector('.kpi');
    await shot('14-inicio');
    await sleep(4000);
    const tt = await page.evaluate(() => [performance.now(), Array.from(document.querySelectorAll('.toast')).map((t) => t.textContent + '@' + t.dataset.t)]);
    if (tt[1].length) throw new Error('Notificaciones que no se ocultan: ' + JSON.stringify(tt));
    log('Inventario y tablero de inicio');

    // ---- Cajero: permisos ----
    await page.click('#user-chip');
    await modalBtn('Cerrar sesión').click();
    await page.waitForSelector('#login-form');
    await page.fill('[name=usuario]', 'laura');
    await page.fill('[name=password]', 'laura123');
    await page.click('#login-form button');
    await page.waitForSelector('.modal >> text=Cree su clave personal');
    await page.fill('.modal [name=actual]', 'laura123');
    await page.fill('.modal [name=nueva]', 'laura456');
    await page.fill('.modal [name=nueva2]', 'laura456');
    await modalBtn('Guardar').click();
    await toastHas('Clave actualizada');
    const navCajero = await page.locator('#nav a').allInnerTexts();
    if (navCajero.some((t) => /Reportes|Usuarios|Productos/.test(t))) throw new Error('El cajero ve menús de administrador');
    await ir('caja');
    await page.fill('#fa [name=base]', '50000');
    await page.click('#fa button');
    await toastHas('Caja abierta');
    await ir('pos');
    await page.click('.prod:has-text("Pollo asado")');
    await page.click('#t-descg');
    await page.click('.modal #dv-mod [data-m=p]');
    await page.fill('.modal #dv', '30');
    await modalBtn('Aplicar').click();
    await page.click('#t-cobrar');
    await page.waitForSelector('.modal >> text=Autorización de administrador');
    await page.fill('.modal [name=usuario]', 'admin');
    await page.fill('.modal [name=pin]', '2468');
    await modalBtn('Autorizar').click();
    await page.waitForSelector('.modal .total-grande');
    await modalBtn('Confirmar pago').click();
    await page.waitForSelector('.modal >> text=Venta #5');
    await modalBtn('Nueva venta').click();
    log('Cajero: menú restringido; descuento del 30 % autorizado con PIN de administrador');

    // ---- Vista móvil ----
    await page.setViewportSize({ width: 390, height: 844 });
    await ir('pos');
    await page.click('.prod:has-text("Gaseosa")');
    await page.waitForSelector('#pos-fab:not(.hidden)');
    await shot('15-movil-pos');
    await page.click('#pos-fab');
    await page.waitForSelector('#ticket.open');
    await shot('16-movil-ticket');
    for (const r of ['pos', 'inicio', 'ventas', 'caja', 'inventario']) {
      if (r !== 'pos') await ir(r);
      const des = await page.evaluate(() => {
        const W = document.documentElement.clientWidth;
        const fuera = [];
        document.querySelectorAll('body *').forEach((e) => { const rc = e.getBoundingClientRect(); if (rc.width && rc.right > W + 1) fuera.push(e.tagName + '.' + e.className + ' ' + Math.round(rc.right)); });
        return { sw: document.documentElement.scrollWidth, fuera: fuera.slice(0, 5) };
      });
      if (des.sw > 392) throw new Error(`Desbordamiento horizontal en móvil (${r}): ${des.sw} ${des.fuera.join(' | ')}`);
    }
    log('Vista de celular: catálogo, botón de pedido y ticket a pantalla completa sin desbordes');

    if (errores.length) throw new Error('Errores en consola:\n' + errores.join('\n'));
    console.log(`\nE2E OK · ${paso} pasos · capturas en ${SHOTS}`);
  } catch (e) {
    await shot('ERROR').catch(() => {});
    console.error('\n✖ Falló en el paso', paso + 1, '\n', e.message, errores.length ? '\nConsola:\n' + errores.join('\n') : '');
    process.exitCode = 1;
  } finally {
    await browser.close();
    srv.kill();
    fs.rmSync(DATA, { force: true });
  }
}

main();
