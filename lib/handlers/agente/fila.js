// lib/handlers/agente/fila.js
const supabase     = require('../../supabase');
const AGENT_SECRET = process.env.AGENT_SECRET;

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
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
      .select('id, usuario_id, controlid_user_id, nome, criado_em')
      .eq('status', 'pendente')
      .order('criado_em', { ascending: true })
      .limit(10);

    if (error) throw error;
    return res.status(200).json({ pendentes: data || [] });

  } catch (err) {
    console.error('[fila] Erro:', err.message);
    return res.status(500).json({ erro: 'Erro interno', pendentes: [] });
  }
};
