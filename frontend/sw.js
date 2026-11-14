// Service Worker: guarda la aplicación en el dispositivo para que abra y venda sin internet.
// Cambie VERSION en cada despliegue para que los dispositivos descarguen la nueva versión.
const VERSION = 'mulan-20261114-1106';
const ARCHIVOS = [
  './', './index.html', './config.js', './manifest.webmanifest', './css/app.css',
  './js/app.js', './js/api.js', './js/store.js', './js/ui.js', './js/calc.js', './js/receipt.js',
  './js/views/login.js', './js/views/inicio.js', './js/views/pos.js', './js/views/ventas.js', './js/views/caja.js',
  './js/views/inventario.js', './js/views/productos.js', './js/views/proveedores.js', './js/views/promociones.js',
  './js/views/reportes.js', './js/views/usuarios.js', './js/views/config.js',
  './vendor/chart.umd.js', './assets/logo.png', './assets/icon-192.png', './assets/icon-512.png'
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(ARCHIVOS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== VERSION).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return; // la API (POST) siempre va a la red
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  // red primero para tener la última versión; caché si no hay conexión
  e.respondWith(
    fetch(req).then((res) => {
      if (res.ok) { const copia = res.clone(); caches.open(VERSION).then((c) => c.put(req, copia)); }
      return res;
    }).catch(() => caches.match(req, { ignoreSearch: true }).then((r) => r || caches.match('./index.html')))
  );
});
