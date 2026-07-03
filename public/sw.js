// Service Worker — Ala dos Estudantes
// v5 — Cache offline + Push Notifications + Som

const CACHE_NAME = 'ala-estudantes-v5';
const URLS_CACHE = ['/', '/index.html', '/manifest.json'];

// ── Instala e faz cache ─────────────────────────────────────
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(URLS_CACHE))
  );
  self.skipWaiting();
});

// ── Ativa e limpa caches antigos ────────────────────────────
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k))
      ))
      .then(() => self.clients.claim())
  );
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

  const icones = { acesso:'✅', urgente:'🚨', manutencao:'🔧', lotado:'🚫', aviso:'📢' };
  const emoji  = icones[dados.tipo] || '📢';
  const somMap = { urgente:'erro', lotado:'erro', manutencao:'acesso', acesso:'acesso', aviso:'acesso' };
  const somTipo = somMap[dados.tipo] || 'acesso';

  const opcoes = {
    body:     dados.corpo,
    icon:     '/icon-192.png',
    badge:    '/icon-192.png',
    tag:      dados.tipo || 'geral',
    renotify: dados.tipo === 'urgente',
    vibrate:  dados.tipo === 'urgente' ? [200, 100, 200, 100, 200] : [100],
    data:     { url: dados.url || '/', tipo: dados.tipo },
    actions:  dados.tipo === 'lotado'
      ? [{ action: 'verificar', title: '🔍 Ver vagas' }]
      : []
  };

  // Usa Promise.all para rodar showNotification e postMessage em paralelo
  // (showNotification retorna undefined — não pode ser encadeado com .then)
  const notificar = self.registration.showNotification(`${emoji} ${dados.titulo}`, opcoes);

  const avisarClients = self.clients
    .matchAll({ type: 'window', includeUncontrolled: true })
    .then(lista => {
      lista.forEach(client => client.postMessage({ tipo: 'PUSH_RECEBIDO', somTipo }));
    });

  event.waitUntil(Promise.all([notificar, avisarClients]));
});

// ── Clique na notificação ───────────────────────────────────
self.addEventListener('notificationclick', event => {
  event.notification.close();
  const urlAlvo = event.notification.data?.url || '/';
  event.waitUntil(
    self.clients
      .matchAll({ type: 'window', includeUncontrolled: true })
      .then(lista => {
        const aberto = lista.find(c => c.url.includes(self.location.origin));
        if (aberto) return aberto.focus();
        return self.clients.openWindow(urlAlvo);
      })
  );
});
