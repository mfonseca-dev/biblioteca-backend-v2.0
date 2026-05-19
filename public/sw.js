// Service Worker — Ala dos Estudantes
// v3 — Cache offline + Push Notifications

const CACHE_NAME = 'ala-estudantes-v3';
const URLS_CACHE = [
  '/',
  '/index.html',
  '/manifest.json'
];

// ── Instala e faz cache dos arquivos principais ─────────────
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(URLS_CACHE))
  );
  self.skipWaiting();
});

// ── Ativa e limpa caches antigos ────────────────────────────
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// ── Estratégia: network first, cache como fallback ──────────
self.addEventListener('fetch', event => {
  const url = event.request.url;
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

// ── Push Notifications ──────────────────────────────────────
self.addEventListener('push', event => {
  let dados = { titulo: 'Ala dos Estudantes', corpo: 'Você tem uma nova notificação.', tipo: 'aviso' };

  try {
    if (event.data) dados = { ...dados, ...event.data.json() };
  } catch(e) {
    if (event.data) dados.corpo = event.data.text();
  }

  // Ícone por tipo
  const icones = {
    acesso:      '✅',
    urgente:     '🚨',
    manutencao:  '🔧',
    lotado:      '🚫',
    aviso:       '📢',
  };
  const emoji = icones[dados.tipo] || '📢';

  const opcoes = {
    body:    dados.corpo,
    icon:    '/icon-192.png',
    badge:   '/icon-192.png',
    tag:     dados.tipo || 'geral',         // agrupa notifs do mesmo tipo
    renotify: dados.tipo === 'urgente',     // re-toca som se urgente
    vibrate: dados.tipo === 'urgente' ? [200, 100, 200] : [100],
    data:    { url: dados.url || '/', tipo: dados.tipo },
    actions: dados.tipo === 'lotado'
      ? [{ action: 'verificar', title: '🔍 Ver vagas' }]
      : []
  };

  event.waitUntil(
    self.registration.showNotification(`${emoji} ${dados.titulo}`, opcoes)
  );
});

// ── Clique na notificação ───────────────────────────────────
self.addEventListener('notificationclick', event => {
  event.notification.close();

  const urlAlvo = event.notification.data?.url || '/';

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(lista => {
      // Se o app já está aberto, foca nele
      const aberto = lista.find(c => c.url.includes(self.location.origin));
      if (aberto) return aberto.focus();
      // Senão abre nova aba
      return clients.openWindow(urlAlvo);
    })
  );
});
