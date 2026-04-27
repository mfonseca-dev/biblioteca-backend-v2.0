// lib/handlers/agente/confirmar.js
const supabase     = require('../../supabase');
const AGENT_SECRET = process.env.AGENT_SECRET;

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, x-agent-secret');
  if (req.method === 'OPTIONS') return res.status(200).end();

  if (req.method !== 'POST') {
    return res.status(405).json({ erro: 'Método não permitido' });
  }

  const secret = req.headers['x-agent-secret'];
  if (!secret || secret !== AGENT_SECRET) {
    return res.status(401).json({ erro: 'Não autorizado' });
  }

  const { id, sucesso } = req.body || {};
  if (!id) return res.status(400).json({ erro: 'id obrigatório' });

  try {
    const { error } = await supabase
      .from('liberacoes_catraca')
      .update({
        status:       sucesso ? 'executado' : 'falhou',
        executado_em: new Date().toISOString(),
      })
      .eq('id', id);

    if (error) throw error;
    return res.status(200).json({ ok: true });

  } catch (err) {
    console.error('[confirmar] Erro:', err.message);
    return res.status(500).json({ erro: 'Erro interno' });
  }
};
