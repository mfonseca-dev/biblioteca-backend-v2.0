// lib/push.js
// Helper compartilhado para envio de push notifications
const supabase = require('./supabase');

let webpush;
try {
  webpush = require('web-push');
  webpush.setVapidDetails(
    'mailto:privacidade@aladosestudantes.org.br',
    process.env.VAPID_PUBLIC_KEY,
    process.env.VAPID_PRIVATE_KEY
  );
} catch (e) {
  console.warn('[push] web-push não disponível:', e.message);
}

/**
 * Envia push notification para assinantes.
 * apenasStaff = true → envia só para usuários tipo admin/recepcao (uso interno, ex: alertas urgentes)
 * Uso interno do backend — não exige token, deve ser chamado só a partir de outras rotas do servidor.
 */
async function enviarPushInterno({ titulo, corpo, tipo = 'aviso', url = '/', apenasStaff = false }) {
  if (!webpush) return { enviados: 0, motivo: 'webpush indisponível' };
  try {
    const { data: subs } = await supabase
      .from('push_subscriptions')
      .select('*, usuarios(tipo)')
      .eq('ativo', true);
    if (!subs?.length) return { enviados: 0, motivo: 'nenhum assinante' };
    const alvos = apenasStaff
      ? subs.filter(s => s.usuarios?.tipo === 'admin' || s.usuarios?.tipo === 'recepcao')
      : subs;
    if (!alvos.length) return { enviados: 0, motivo: 'nenhum assinante staff' };
    const payload = JSON.stringify({ titulo, corpo, tipo, url });
    let enviados = 0;
    await Promise.allSettled(alvos.map(async sub => {
      try {
        await webpush.sendNotification(
          { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
          payload
        );
        enviados++;
      } catch (e) {
        if (e.statusCode === 404 || e.statusCode === 410) {
          await supabase.from('push_subscriptions').update({ ativo: false }).eq('endpoint', sub.endpoint);
        }
      }
    }));
    return { enviados, total: alvos.length };
  } catch (e) {
    console.error('[push] Erro em enviarPushInterno:', e.message);
    return { enviados: 0, erro: e.message };
  }
}

module.exports = { enviarPushInterno };
