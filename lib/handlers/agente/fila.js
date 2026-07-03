// lib/handlers/agente/fila.js
//
// Retorna fila de liberações pendentes para o agente local.
// A foto_url já vem gravada na liberacoes_catraca pelo liberar-acesso.js.

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
  if (req.method !== 'GET') {
    return res.status(405).json({ erro: 'Método não permitido' });
  }

  const secret = req.headers['x-agent-secret'];
  if (!secret || secret !== AGENT_SECRET) {
    return res.status(401).json({ erro: 'Não autorizado' });
  }

  try {
    const { data, error } = await supabase
      .from('liberacoes_catraca')
      .select(`
        id, usuario_id, controlid_user_id, nome, foto_url, criado_em,
        usuarios!liberacoes_catraca_usuario_id_fkey ( cpf, controlid_person_id )
      `)
      .eq('status', 'pendente')
      .order('criado_em', { ascending: true })
      .limit(10);

    if (error) throw error;

    const pendentes = (data || []).map(item => ({
      id:               item.id,
      usuario_id:       item.usuario_id,
      // controlid_person_id do usuário tem prioridade sobre o da fila
      controlid_user_id: item.usuarios?.controlid_person_id
                         ? parseInt(item.usuarios.controlid_person_id, 10)
                         : (item.controlid_user_id || 0),
      nome:             item.nome,
      cpf:              item.usuarios?.cpf || null,
      foto_base64:      item.foto_url || null,  // foto já gravada na fila
      criado_em:        item.criado_em,
    }));

    return res.status(200).json({ pendentes });

  } catch (err) {
    console.error('[fila] Erro:', err.message);
    return res.status(500).json({ erro: 'Erro interno', pendentes: [] });
  }
};
