// lib/handlers/agente/alerta.js
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

  const { item_id, acao, nome, preso_ha_min, tentativas } = req.body || {};
  if (!item_id || !acao) {
    return res.status(400).json({ erro: 'item_id e acao obrigatórios' });
  }

  try {
    // Insert simples (não upsert): cada disparo vira uma linha nova no
    // histórico — assim dá pra ver recorrência (mesmo item travando
    // várias vezes) em vez de só o estado mais recente. Sem lógica de
    // "resolvido"/dashboard de propósito: ninguém acompanha isso ao
    // vivo hoje, então o valor está no histórico consultável, não numa
    // tela de status em tempo real.
    const { error } = await supabase
      .from('alertas_agente')
      .insert({
        item_id:      String(item_id),
        acao,
        nome:          nome || null,
        preso_ha_min:  preso_ha_min ?? null,
        tentativas:    tentativas ?? null,
      });

    if (error) throw error;
    return res.status(200).json({ ok: true });

  } catch (err) {
    console.error('[alerta] Erro:', err.message);
    return res.status(500).json({ erro: 'Erro interno' });
  }
};
