# MULAN POS

Sistema punto de venta (POS) para negocio de comidas. Es una **aplicación instalable (PWA)** para computador, tableta y celular (Windows, macOS, Linux, Android e iOS). Los datos se guardan en **Google Sheets** a través de **Google Apps Script**.

## 1. Arquitectura

```
 Dispositivos (PWA instalable)                 Google
 ┌──────────────────────────────┐   HTTPS   ┌──────────────────────┐    ┌──────────────────┐
 │ frontend/ (HTML+CSS+JS)       │ ───────▶ │ Apps Script (Web App) │ ─▶ │ Google Sheets    │
 │ · Service Worker (sin red)    │  JSON    │ backend/*.gs          │    │ una hoja / tabla │
 │ · IndexedDB: catálogo + cola  │ ◀─────── │ LockService, sesiones │    └──────────────────┘
 └──────────────────────────────┘           └──────────────────────┘
   alojado en GitHub Pages (gratis)
```

* **Frontend**: módulos JavaScript sin compilación (`frontend/js`). Funciona sin internet: el catálogo queda guardado en el dispositivo y las ventas y movimientos de caja se encolan. Cada operación lleva un ID único, así que al volver la conexión se sincronizan **sin duplicarse**.
* **Backend**: `backend/*.gs`. Expone una sola URL (`doPost`) con acciones `{action, token, data}`. Las escrituras se hacen con un bloqueo (`LockService`) para que dos cajas que venden al mismo tiempo no se pisen.
* **Por qué la interfaz no se aloja en Apps Script**: las páginas servidas por Apps Script no se pueden instalar como aplicación (no admiten *manifest* ni *service worker*). Por eso la interfaz va en un hosting estático y Apps Script queda solo como API.

### Módulos y dependencias

| Módulo | Archivo backend | Vista | Depende de |
|---|---|---|---|
| Usuarios y permisos | `Auth.gs` | `usuarios.js`, `login.js` | — |
| Catálogo (categorías, productos, insumos, proveedores, promociones, configuración) | `Catalogo.gs` | `productos.js`, `proveedores.js`, `promociones.js`, `config.js` | Usuarios |
| Recetas y costos | `Catalogo.gs` | `productos.js` | Insumos |
| Inventario | `Inventario.gs` | `inventario.js` | Insumos, Caja (compras pagadas desde caja) |
| Caja | `Caja.gs` | `caja.js` | Usuarios |
| Ventas / POS | `Ventas.gs` | `pos.js`, `ventas.js` | Catálogo, Recetas, Caja, Inventario |
| Reportes | `Reportes.gs` | `reportes.js`, `inicio.js` | Ventas, Compras, Caja, Inventario |
| Sincronización | `Main.gs` (`sync`) | `api.js`, `store.js`, `sw.js` | Ventas, Caja |

### Base de datos (hojas de Google Sheets)

`setup()` crea las hojas automáticamente. La primera fila de cada hoja tiene los encabezados.

| Hoja | Contenido |
|---|---|
| Config | Datos del negocio, impuesto, mesas, medios de pago, turnos y topes |
| Usuarios / Sesiones | Usuarios (clave con hash y sal, PIN de autorización) y sesiones activas |
| Categorias / Productos / Recetas | Carta de venta e ingredientes por porción |
| Insumos / Proveedores | Materias primas (stock, mínimo, costo promedio) y proveedores |
| MovInventario | Kardex: cada entrada o salida, con su saldo resultante |
| Compras | Encabezado de compras (el detalle está en MovInventario) |
| Cajas / MovCaja | Turnos de caja (base, esperado, contado, diferencia), ingresos, egresos y retiros |
| Ventas / VentaItems / Pagos | Comandas y ventas, sus líneas y pagos (incluye reversos por anulación o devolución) |
| Promociones | Descuentos automáticos por producto, categoría o toda la carta, por fechas y días |
| Auditoria | Bitácora de acciones sensibles |

> No cambie el orden de las columnas ni borre filas a mano. Para correcciones use la aplicación (ajustes, anulaciones), así se conserva la trazabilidad.

## 2. Requerimientos cubiertos

| Requerimiento | Implementación |
|---|---|
| App descargable en cualquier dispositivo | PWA instalable con modo sin conexión |
| Datos en Google Sheets | Backend en Apps Script sobre el Sheet |
| Inventario con alertas | Mínimos por insumo, estados *Bajo* y *Agotado*, alertas en Inicio e Inventario |
| Ventas e indicadores semanales, mensuales y anuales | Reportes con filtros Hoy, Semana, Mes y Año, agrupación por día, semana o mes, y comparación con el período anterior |
| Crear productos de venta e insumos | Productos y recetas, e Inventario |
| Comandas y total en un clic | POS con mesas, para llevar y domicilio; botón **Cobrar $total** |
| Rojo y negro con logo | Logo en inicio de sesión, menú, comprobante e ícono de la app |
| Ventas y facturación | Categorías, cantidades, notas y modificadores, promociones, descuentos, pagos mixtos (efectivo, transferencia, tarjeta, otro), comprobante para imprimir o enviar por WhatsApp, anulación y devolución con PIN de administrador |
| Inventario y materias primas | Entradas por compras (costo promedio ponderado), salidas automáticas por venta, ajustes por desperdicio o daño, conteo físico, proveedores y kardex |
| Recetas y costos | Ingredientes por plato, costo de cada uno, costo total, utilidad y margen, y descuento automático al vender |
| Control de caja | Apertura con base, ingresos, egresos, retiros, arqueo por denominaciones, comparación esperado/real e historial por cajero y turno |
| Reportes | Ventas, más y menos vendidos, ganancia estimada, compras y gastos, inventario valorizado, medios de pago, ventas por hora, por categoría y por cajero. Se puede exportar a CSV |
| Usuarios y permisos | Administrador y Cajero, permisos validados en el servidor y bitácora de auditoría |

**Decisiones de funcionamiento acordadas:** comprobante interno no fiscal (no es factura electrónica DIAN); impuesto configurable incluido en el precio (0 = no aplica); mesas, para llevar y domicilios ocasionales; sin impresora por ahora (el comprobante sale en formato de 80 mm, listo para cuando haya una).

## 3. Puesta en marcha

**Siga la guía [GUIA-VSCODE.md](GUIA-VSCODE.md)**: instalación de programas, cuentas, conexión con Google (clasp) y GitHub, y publicación con un solo comando:

```bash
npm run publicar        # pruebas → Apps Script → GitHub Pages
```

### Instalar en cada dispositivo
* **Computador (Chrome o Edge):** abra la dirección y pulse el ícono **Instalar** de la barra de direcciones.
* **Android (Chrome):** menú ⋮ → **Instalar aplicación**.
* **iPhone o iPad (Safari):** Compartir → **Agregar a inicio**.

Inicie sesión con internet al menos una vez en cada dispositivo para que guarde el catálogo.

## 4. Uso diario
1. **Caja → Abrir caja** con la base del turno.
2. **Vender**: toque los productos. Elija *Mesa* (guarde la comanda y cóbrela después), *Para llevar* o *Domicilio*. Pulse **Cobrar**, elija el medio de pago (se pueden combinar) e imprima o envíe el comprobante.
3. Sin internet se puede seguir vendiendo. El indicador superior muestra las operaciones pendientes, que se envían solas al volver la conexión.
4. **Caja → Cerrar caja**: cuente el efectivo por denominación y el sistema muestra el faltante o sobrante.
5. **Inventario → Registrar compra** cuando llegue mercancía. Para desperdicios o conteos físicos use **Ajuste**.

## 5. Desarrollo y pruebas
```bash
npm install            # instala clasp y Playwright
npm run dev            # http://localhost:8080 con el backend real sobre un Sheets simulado (dev/data.json)
npm test               # pruebas del backend por etapa
npm run e2e            # prueba completa en navegador (19 pasos)
```
`dev/gas-runtime.js` simula `SpreadsheetApp`, `LockService`, `CacheService` y `Utilities`. Así el código de `backend/` corre sin cambios en Node.

## 6. Límites y recomendaciones
* Apps Script responde en 1 a 3 segundos por operación. Es adecuado para un local con pocas cajas. Las cuotas gratuitas de Google alcanzan de sobra para este volumen.
* Al crecer el historial (más de unas 50.000 líneas de venta), conviene archivar años anteriores en otro Sheet.
* Las operaciones administrativas (compras, ajustes, cierres, anulaciones) requieren conexión. Sin conexión solo se encolan ventas y movimientos de caja.
* El comprobante es interno. Si más adelante necesita factura electrónica DIAN, se puede integrar un proveedor tecnológico (Alegra, Siigo, etc.) en `Ventas.guardar`.
* El logo está en `frontend/assets/logo.png` e `icon-*.png`. Para cambiarlo, reemplace esos archivos.
