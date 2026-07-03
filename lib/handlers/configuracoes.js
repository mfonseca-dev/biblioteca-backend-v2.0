// api/configuracoes.js
// GET  /api/configuracoes?acao=ping → verifica saúde da API
// GET  /api/configuracoes           → lista configs públicas
// POST /api/configuracoes           → salva config (admin)
const supabase = require('../supabase');
const { soAdmin } = require('../../middleware/auth');

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

  const { acao } = req.query;

  // ── Ping (absorvido do ping.js) ──────────────────────────────
  if (acao === 'ping') {
    return res.status(200).json({ ping: 'ok', supabase: !!process.env.SUPABASE_URL });
  }

  if (req.method === 'GET') {
    const { data } = await supabase
      .from('configuracoes')
      .select('chave, valor')
      .not('chave', 'in', '("controlid_token","senha_admin","senha_recepcao","cron_token","gateway_chave")');
    return res.status(200).json({ configuracoes: data || [] });
  }

  if (req.method !== 'POST') return res.status(405).json({ erro: 'Método não permitido' });

  const auth = soAdmin(req, res);
  if (!auth.ok) return;

  const { chave, valor } = req.body || {};
  if (!chave || valor === undefined) return res.status(400).json({ erro: 'chave e valor são obrigatórios' });

  const { data, error } = await supabase
    .from('configuracoes')
    .upsert({ chave, valor, updated_at: new Date().toISOString() })
    .select().single();

  if (error) {
    console.error('Erro ao salvar config:', error);
    return res.status(500).json({ erro: 'Erro interno' });
  }

  return res.status(200).json({ mensagem: 'Configuração salva', config: data });
};
module.exports.config = { api: { bodyParser: { sizeLimit: '5mb' } } };
