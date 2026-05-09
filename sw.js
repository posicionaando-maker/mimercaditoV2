/**
 * SERVICE WORKER
 * Permite que la PWA funcione sin conexión a internet
 * Almacena en caché los archivos principales cuando se instala
 */

// Nombre de la caché (cambiar para forzar actualizaciones)
const CACHE_NAME = 'mi-mercadito-pos-v1';

// Lista de archivos que queremos cachear para uso offline
const ARCHIVOS_CACHE = [
  './',
  './index.html',
  './styles.css',
  './pos.js',
  './manifest.json'
];

// Evento 'install': ocurre cuando se instala el Service Worker por primera vez
self.addEventListener('install', (event) => {
  console.log('Service Worker instalado');
  
  // Esperamos a que termine de cachear todos los archivos
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(ARCHIVOS_CACHE);
    })
  );
});

// Evento 'fetch': intercepta todas las peticiones de red
self.addEventListener('fetch', (event) => {
  event.respondWith(
    // Primero intentamos buscar en la caché
    caches.match(event.request).then((respuestaCache) => {
      // Si está en caché, lo devolvemos (rápido y offline)
      if (respuestaCache) {
        return respuestaCache;
      }
      
      // Si no está en caché, vamos a la red
      return fetch(event.request).then((respuestaRed) => {
        // Opcional: guardar en caché la nueva respuesta para futuras veces
        // (descomentar si se quiere cachear dinámicamente)
        /*
        if (respuestaRed && respuestaRed.status === 200) {
          const copia = respuestaRed.clone();
          caches.open(CACHE_NAME).then(cache => {
            cache.put(event.request, copia);
          });
        }
        */
        return respuestaRed;
      });
    })
  );
});

// Evento 'activate': limpia cachés antiguas cuando se actualiza el SW
self.addEventListener('activate', (event) => {
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
});
