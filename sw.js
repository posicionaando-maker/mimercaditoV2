// VERSIÓN ÚNICA: 2025-01-15-001
// ESTE SERVICE WORKER ES NUEVO Y NO COINCIDE CON NINGÚN ANTERIOR

const CACHE_NAME = 'pos-azul-v3-final';  // nombre completamente diferente

self.addEventListener('install', (event) => {
  console.log('SW NUEVO instalado');
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll([
        './',
        './index.html',
        './styles.css',
        './pos.js',
        './manifest.json'
      ]);
    })
  );
  self.skipWaiting(); // Toma control inmediatamente
});

self.addEventListener('activate', (event) => {
  console.log('SW NUEVO activado - limpiando todo lo anterior');
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.map((key) => {
          if (key !== CACHE_NAME) {
            console.log('Eliminando caché:', key);
            return caches.delete(key);
          }
        })
      );
    })
  );
  return self.clients.claim(); // Toma control de todas las pestañas
});

self.addEventListener('fetch', (event) => {
  event.respondWith(
    fetch(event.request).catch(() => {
      return caches.match(event.request);
    })
  );
});
