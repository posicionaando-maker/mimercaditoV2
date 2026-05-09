/**
 * SERVICE WORKER - VERSIÓN 2
 * Cambio de color a azul y reorganización de interfaz
 */

// Nombre de la caché - CAMBIADO para forzar actualización
const CACHE_NAME = 'mi-mercadito-pos-v2';

// Archivos a cachear (versión actualizada)
const ARCHIVOS_CACHE = [
  './',
  './index.html',
  './styles.css',
  './pos.js',
  './manifest.json'
];

// Instalación
self.addEventListener('install', (event) => {
  console.log('Service Worker v2 instalado');
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(ARCHIVOS_CACHE);
    })
  );
  // Forzar activación inmediata
  self.skipWaiting();
});

// Activación: limpiar cachés antiguas
self.addEventListener('activate', (event) => {
  console.log('Service Worker v2 activado');
  event.waitUntil(
    caches.keys().then((nombresCaches) => {
      return Promise.all(
        nombresCaches.map((nombreCache) => {
          if (nombreCache !== CACHE_NAME) {
            console.log('Eliminando caché antigua:', nombreCache);
            return caches.delete(nombreCache);
          }
        })
      );
    })
  );
  // Tomar control de todas las pestañas inmediatamente
  event.waitUntil(clients.claim());
});

// Fetch: primero caché, luego red
self.addEventListener('fetch', (event) => {
  event.respondWith(
    caches.match(event.request).then((respuestaCache) => {
      if (respuestaCache) {
        return respuestaCache;
      }
      return fetch(event.request).then((respuestaRed) => {
        // No cacheamos respuestas de API o archivos dinámicos
        if (!respuestaRed || respuestaRed.status !== 200) {
          return respuestaRed;
        }
        // Solo cacheamos archivos estáticos (opcional)
        if (event.request.url.includes('inventario') || event.request.url.includes('ventas')) {
          return respuestaRed;
        }
        const copia = respuestaRed.clone();
        caches.open(CACHE_NAME).then(cache => {
          cache.put(event.request, copia);
        });
        return respuestaRed;
      });
    })
  );
});
