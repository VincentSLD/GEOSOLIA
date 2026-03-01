// ═══ GéoTer' Service Worker ═══
const CACHE_VERSION = 'v1';
const CACHE_STATIC = 'geoter-static-' + CACHE_VERSION;
const CACHE_TILES  = 'geoter-tiles-' + CACHE_VERSION;
const CACHE_API    = 'geoter-api-' + CACHE_VERSION;

const MAX_TILES = 500;
const API_TTL = 24 * 60 * 60 * 1000; // 24h

// Assets à pré-cacher à l'installation
const PRECACHE_URLS = [
  './',
  './index.html',
  './manifest.json',
  './pwa-register.js',
  // Librairies locales
  './lib/pdf.min.js',
  './lib/pdf.worker.min.js',
  './lib/leaflet.min.css',
  './lib/leaflet.min.js',
  './lib/images/marker-icon.png',
  './lib/images/marker-icon-2x.png',
  './lib/images/marker-shadow.png',
  './lib/images/layers.png',
  './lib/images/layers-2x.png',
  './lib/three/three.module.js',
  './lib/three/examples/jsm/controls/OrbitControls.js',
  './lib/three/examples/jsm/loaders/PLYLoader.js',
  './lib/three/examples/jsm/loaders/OBJLoader.js',
  './lib/three/examples/jsm/loaders/MTLLoader.js',
  // Polices
  './lib/fonts/nunito-sans-normal.woff2',
  './lib/fonts/nunito-sans-italic.woff2',
  './lib/fonts/playfair-display-700.woff2',
  // Icônes
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/apple-touch-icon.png'
];

// ═══ INSTALLATION : pré-cache des assets ═══
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_STATIC)
      .then(cache => cache.addAll(PRECACHE_URLS))
      .then(() => self.skipWaiting())
  );
});

// ═══ ACTIVATION : nettoyage des anciens caches ═══
self.addEventListener('activate', event => {
  const validCaches = [CACHE_STATIC, CACHE_TILES, CACHE_API];
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys.filter(k => !validCaches.includes(k)).map(k => caches.delete(k))
      ))
      .then(() => self.clients.claim())
  );
});

// ═══ FETCH : stratégie par type de ressource ═══
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);

  // Ignorer les requêtes non-GET
  if (event.request.method !== 'GET') return;

  // Ignorer le proxy IA local (network-only)
  if (url.hostname === 'localhost' || url.hostname === '127.0.0.1') return;

  // Assets statiques locaux → cache-first
  if (isStaticAsset(url)) {
    event.respondWith(cacheFirst(event.request, CACHE_STATIC));
    return;
  }

  // Page principale → network-first
  if (isAppShell(url)) {
    event.respondWith(networkFirst(event.request, CACHE_STATIC));
    return;
  }

  // Tuiles de carte → network-first + cache LRU
  if (isTileUrl(url)) {
    event.respondWith(networkFirstTile(event.request));
    return;
  }

  // APIs géo (GéoRisques, BRGM, IGN, adresse) → network-first + cache TTL
  if (isApiUrl(url)) {
    event.respondWith(networkFirstApi(event.request));
    return;
  }

  // Tout le reste → network-first sans cache
  event.respondWith(fetch(event.request).catch(() => caches.match(event.request)));
});

// ═══ DÉTECTION DES TYPES D'URL ═══

function isStaticAsset(url) {
  const path = url.pathname;
  return path.includes('/lib/') ||
         path.includes('/icons/') ||
         path.endsWith('/manifest.json') ||
         path.endsWith('/pwa-register.js');
}

function isAppShell(url) {
  const path = url.pathname;
  return path.endsWith('/index.html') ||
         path.endsWith('/') ||
         path === '' ||
         path.endsWith('/03_GEOTER') ||
         path.endsWith('/03_GEOTER/');
}

function isTileUrl(url) {
  const h = url.hostname;
  return h.includes('tile.openstreetmap.org') ||
         h.includes('arcgisonline.com') ||
         (h.includes('geopf.fr') && url.pathname.includes('WMTS'));
}

function isApiUrl(url) {
  const h = url.hostname;
  return h.includes('georisques.gouv.fr') ||
         h.includes('brgm.fr') ||
         h.includes('geopf.fr') ||
         h.includes('api-adresse.data.gouv.fr') ||
         h.includes('ign.fr');
}

// ═══ STRATÉGIES DE CACHE ═══

// Cache-first : retourne le cache, fetch en fallback
async function cacheFirst(request, cacheName) {
  const cached = await caches.match(request);
  if (cached) return cached;
  try {
    const response = await fetch(request);
    if (response.ok) {
      const cache = await caches.open(cacheName);
      cache.put(request, response.clone());
    }
    return response;
  } catch (e) {
    return new Response('Ressource indisponible hors ligne', { status: 503 });
  }
}

// Network-first : fetch d'abord, cache en fallback
async function networkFirst(request, cacheName) {
  try {
    const response = await fetch(request);
    if (response.ok) {
      const cache = await caches.open(cacheName);
      cache.put(request, response.clone());
    }
    return response;
  } catch (e) {
    const cached = await caches.match(request);
    if (cached) return cached;
    return new Response('Application indisponible hors ligne', {
      status: 503,
      headers: { 'Content-Type': 'text/html; charset=utf-8' }
    });
  }
}

// Network-first pour les tuiles avec cache LRU
async function networkFirstTile(request) {
  try {
    const response = await fetch(request);
    if (response.ok) {
      await cacheTileWithEviction(request, response.clone());
    }
    return response;
  } catch (e) {
    const cached = await caches.match(request);
    if (cached) return cached;
    // Tuile transparente 1x1 PNG comme fallback
    return new Response(
      Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVQI12NgAAIABQABNjN9GQAAAAlwSFlzAAAWJQAAFiUBSVIk8AAAAA0lEQVQI12P4z8BQDwAEgAF/QualzQAAAABJRU5ErkJggg=='), c => c.charCodeAt(0)),
      { headers: { 'Content-Type': 'image/png' } }
    );
  }
}

// Network-first pour les APIs avec cache TTL 24h
async function networkFirstApi(request) {
  try {
    const response = await fetch(request);
    if (response.ok) {
      const cache = await caches.open(CACHE_API);
      // Stocker avec timestamp dans un header custom
      const headers = new Headers(response.headers);
      headers.set('x-geoter-cached-at', Date.now().toString());
      const timedResponse = new Response(await response.clone().blob(), {
        status: response.status,
        statusText: response.statusText,
        headers: headers
      });
      cache.put(request, timedResponse);
    }
    return response;
  } catch (e) {
    const cached = await caches.match(request);
    if (cached) {
      // Vérifier le TTL
      const cachedAt = parseInt(cached.headers.get('x-geoter-cached-at') || '0');
      if (Date.now() - cachedAt < API_TTL) {
        return cached;
      }
      // Même expiré, mieux que rien hors-ligne
      return cached;
    }
    return new Response(JSON.stringify({ error: 'Données indisponibles hors ligne' }), {
      status: 503,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}

// Éviction LRU pour le cache de tuiles
async function cacheTileWithEviction(request, response) {
  const cache = await caches.open(CACHE_TILES);
  const keys = await cache.keys();
  if (keys.length >= MAX_TILES) {
    // Supprimer les 50 plus anciennes entrées
    const toDelete = keys.slice(0, 50);
    await Promise.all(toDelete.map(k => cache.delete(k)));
  }
  await cache.put(request, response);
}
