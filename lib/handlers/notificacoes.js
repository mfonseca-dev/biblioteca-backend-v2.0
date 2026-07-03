// api/notificacoes.js
// POST /api/notificacoes?acao=assinar      → salva assinatura do dispositivo
// POST /api/notificacoes?acao=cancelar     → remove assinatura
// POST /api/notificacoes?acao=enviar       → envia push (auth admin/recepcao)
// GET  /api/notificacoes?acao=status       → total de assinantes ativos

const supabase   = require('../supabase');
const { autenticado } = require('../../middleware/auth');

// ── VAPID — instale: npm install web-push ───────────────────
let webpush;
try {
  webpush = require('web-push');
  webpush.setVapidDetails(
    'mailto:privacidade@alados estudantes.org.br',
    process.env.VAPID_PUBLIC_KEY,
    process.env.VAPID_PRIVATE_KEY
  );
} catch(e) {
  console.warn('[push] web-push não disponível:', e.message);
}

module.exports = async function handler(req, res) {
  // ── CORS restrito ────────────────────────────────────────────
const _ORIGENS_PERMITIDAS = (process.env.FRONTEND_URL || 'https://biblioteca-backend-v2-0.vercel.app').split(',').map(o => o.trim());
const _origem = req.headers.origin || '';
res.setHeader('Access-Control-Allow-Origin', _ORIGENS_PERMITIDAS.includes(_origem) ? _origem : _ORIGENS_PERMITIDAS[0]);
res.setHeader('Vary', 'Origin');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  res.setHeader('Permissions-Policy', 'camera=(self), microphone=(), geolocation=()');
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const acao = req.query.acao;

  // ── Salvar assinatura (público — usuário logado) ────────────
  if (req.method === 'POST' && acao === 'assinar') {
    const { subscription, usuario_id } = req.body || {};
    if (!subscription?.endpoint) return res.status(400).json({ erro: 'subscription inválida' });

    // Upsert — evita duplicatas pelo endpoint
    const { error } = await supabase
      .from('push_subscriptions')
      .upsert({
        endpoint:   subscription.endpoint,
        usuario_id: usuario_id || null,
        p256dh:     subscription.keys?.p256dh,
        auth:       subscription.keys?.auth,
        ativo:      true,
        updated_at: new Date().toISOString()
      }, { onConflict: 'endpoint' });

    if (error) return res.status(500).json({ erro: 'Erro ao salvar assinatura' });
    return res.status(200).json({ ok: true });
  }

  // ── Cancelar assinatura ─────────────────────────────────────
  if (req.method === 'POST' && acao === 'cancelar') {
    const { endpoint } = req.body || {};
    if (!endpoint) return res.status(400).json({ erro: 'endpoint obrigatório' });
    await supabase.from('push_subscriptions').update({ ativo: false }).eq('endpoint', endpoint);
    return res.status(200).json({ ok: true });
  }

  // ── Status — total de assinantes ───────────────────────────
  if (req.method === 'GET' && acao === 'status') {
    const auth = autenticado(req, res);
    if (!auth.ok) return;
    const { count } = await supabase
      .from('push_subscriptions')
      .select('*', { count: 'exact', head: true })
      .eq('ativo', true);
    return res.status(200).json({ assinantes: count || 0 });
  }

  // ── Enviar notificação (auth admin/recepcao) ────────────────
  if (req.method === 'POST' && acao === 'enviar') {
    const auth = autenticado(req, res);
    if (!auth.ok) return;
    if (!webpush) return res.status(500).json({ erro: 'web-push não configurado. Instale: npm install web-push' });

    const { titulo, corpo, tipo = 'aviso', url = '/', usuario_id } = req.body || {};
    if (!titulo || !corpo) return res.status(400).json({ erro: 'titulo e corpo obrigatórios' });

    // Busca assinaturas — se usuario_id informado envia só para ele, senão para todos
    let query = supabase.from('push_subscriptions').select('*').eq('ativo', true);
    if (usuario_id) query = query.eq('usuario_id', usuario_id);
    const { data: subs } = await query;

    if (!subs?.length) return res.status(200).json({ enviados: 0, mensagem: 'Nenhum assinante ativo' });

    const payload = JSON.stringify({ titulo, corpo, tipo, url });
    let enviados = 0, falhas = 0;

    await Promise.allSettled(subs.map(async sub => {
      try {
        await webpush.sendNotification(
          { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
          payload
        );
        enviados++;
      } catch(e) {
        falhas++;
        // Assinatura expirada/inválida — desativa
        if (e.statusCode === 404 || e.statusCode === 410) {
          await supabase.from('push_subscriptions').update({ ativo: false }).eq('endpoint', sub.endpoint);
        }
      }
    }));

    return res.status(200).json({ enviados, falhas, total: subs.length });
  }

  return res.status(400).json({ erro: 'acao inválida' });
};
module.exports.config = { api: { bodyParser: { sizeLimit: '5mb' } } };
