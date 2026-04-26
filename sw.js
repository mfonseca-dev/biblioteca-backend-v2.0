// Service Worker — Ala dos Estudantes
// Permite funcionamento offline e instalação como PWA

const CACHE_NAME = 'ala-estudantes-v2';
const URLS_CACHE = [
  '/',
  '/index.html',
  '/manifest.json'
];

// Instala e faz cache dos arquivos principais
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(URLS_CACHE))
  );
  self.skipWaiting();
});

// Ativa e limpa caches antigos
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// Estratégia: network first, cache como fallback
self.addEventListener('fetch', event => {
  const url = event.request.url;

  // API e totem sempre vão direto para a rede — SW não intercepta
  if (url.includes('/api/') || url.includes('/totem')) return;

  event.respondWith(
    fetch(event.request)
      .then(response => {
        const clone = response.clone();
        caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
        return response;
      })
      .catch(() => caches.match(event.request))
  );
});
