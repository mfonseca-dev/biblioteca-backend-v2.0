// lib/handlers/agente/salvar-person-id.js
//
// Chamado pelo agente após criar um usuário novo no iDFace.
// Salva o controlid_person_id gerado de volta no Supabase.

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
