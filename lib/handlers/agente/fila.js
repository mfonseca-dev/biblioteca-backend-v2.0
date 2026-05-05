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

  // DEBUG TEMPORÁRIO — remover após resolver
  console.log('SECRET ESPERADO:', JSON.stringify(AGENT_SECRET));
  console.log('SECRET RECEBIDO:', JSON.stringify(secret));

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
      controlid_user_id: item.usuarios?.controlid_person_id
                         ? parseInt(item.usuarios.controlid_person_id, 10)
                         : (item.controlid_user_id || 0),
      nome:             item.nome,
      cpf:              item.usuarios?.cpf || null,
      foto_base64:      item.foto_url || null,
      criado_em:        item.criado_em,
    }));

    return res.status(200).json({ pendentes });

  } catch (err) {
    console.error('[fila] Erro:', err.message);
    return res.status(500).json({ erro: 'Erro interno', pendentes: [] });
  }
};