// lib/handlers/agente/cursor-catraca.js
//
// GET  → retorna o último id de access_logs do iDFace já processado
// POST → salva o novo cursor após processar um lote de eventos
//
// Usado pelo poller de eventos físicos da catraca (agente local),
// para saber a partir de qual id continuar na próxima consulta ao
// dispositivo, sobrevivendo a reinícios do processo do agente.

const supabase     = require('../../supabase');
const AGENT_SECRET = process.env.AGENT_SECRET;

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
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, x-agent-secret');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const secret = req.headers['x-agent-secret'];
  if (!secret || secret !== AGENT_SECRET) {
    return res.status(401).json({ erro: 'Não autorizado' });
  }

  if (req.method === 'GET') {
    try {
      const { data } = await supabase
        .from('configuracoes')
        .select('valor')
        .eq('chave', 'idface_ultimo_log_id')
        .maybeSingle();
      const ultimoId = parseInt(data?.valor || '0', 10);
      return res.status(200).json({ ultimo_id: ultimoId });
    } catch (err) {
      console.error('[cursor-catraca] GET erro:', err.message);
      return res.status(500).json({ erro: 'Erro interno' });
    }
  }

  if (req.method === 'POST') {
    const { ultimo_id } = req.body || {};
    if (ultimo_id === undefined || ultimo_id === null) {
      return res.status(400).json({ erro: 'ultimo_id obrigatório' });
    }
    try {
      const { error } = await supabase
        .from('configuracoes')
        .upsert({
          chave: 'idface_ultimo_log_id',
          valor: String(ultimo_id),
          updated_at: new Date().toISOString(),
        }, { onConflict: 'chave' });
      if (error) throw error;
      return res.status(200).json({ ok: true });
    } catch (err) {
      console.error('[cursor-catraca] POST erro:', err.message);
      return res.status(500).json({ erro: 'Erro interno' });
    }
  }

  return res.status(405).json({ erro: 'Método não permitido' });
};
module.exports.config = { api: { bodyParser: { sizeLimit: '5mb' } } };