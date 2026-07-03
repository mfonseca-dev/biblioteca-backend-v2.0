// lib/handlers/agente/salvar-person-id.js
//
// Chamado pelo agente após criar um usuário novo no iDFace.
// Salva o controlid_person_id gerado de volta no Supabase.

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
  if (req.method !== 'POST') {
    return res.status(405).json({ erro: 'Método não permitido' });
  }

  const secret = req.headers['x-agent-secret'];
  if (!secret || secret !== AGENT_SECRET) {
    return res.status(401).json({ erro: 'Não autorizado' });
  }

  const { usuario_id, controlid_person_id } = req.body || {};
  if (!usuario_id || !controlid_person_id) {
    return res.status(400).json({ erro: 'usuario_id e controlid_person_id obrigatórios' });
  }

  try {
    const { error } = await supabase
      .from('usuarios')
      .update({
        controlid_person_id: String(controlid_person_id),
        updated_at:          new Date().toISOString(),
      })
      .eq('id', usuario_id);

    if (error) throw error;

    console.log(`[salvar-person-id] usuario=${usuario_id} person_id=${controlid_person_id}`);
    return res.status(200).json({ ok: true });

  } catch (err) {
    console.error('[salvar-person-id] Erro:', err.message);
    return res.status(500).json({ erro: 'Erro interno' });
  }
};
