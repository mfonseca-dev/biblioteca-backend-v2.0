// api/sugestoes.js
// POST /api/sugestoes      → envia sugestão (público)
// GET  /api/sugestoes      → lista sugestões (auth recepcao/admin)
// PUT  /api/sugestoes      → marca como lida (auth)   body: { id }

const supabase = require('../supabase');
const { autenticado } = require('../../middleware/auth');

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();

  // POST — público
  if (req.method === 'POST') {
    const { tipo, area, mensagem, usuario_id } = req.body || {};
    if (!mensagem) return res.status(400).json({ erro: 'mensagem é obrigatória' });

    const { error } = await supabase
      .from('sugestoes')
      .insert({ tipo, area, mensagem, usuario_id: usuario_id || null });
    if (error) return res.status(500).json({ erro: 'Erro ao enviar sugestão' });
    return res.status(201).json({ mensagem: 'Sugestão enviada com sucesso!' });
  }

  // GET e PUT — requer auth
  const auth = autenticado(req, res);
  if (!auth.ok) return;

  if (req.method === 'GET') {
    const { data, error } = await supabase
      .from('sugestoes')
      .select('id, tipo, area, mensagem, lida, created_at, usuarios(nome, cpf)')
      .order('created_at', { ascending: false })
      .limit(100);
    if (error) return res.status(500).json({ erro: 'Erro interno' });
    return res.status(200).json({ sugestoes: data || [] });
  }

  if (req.method === 'PUT') {
    const { id } = req.body || {};
    if (!id) return res.status(400).json({ erro: 'id é obrigatório' });
    await supabase.from('sugestoes').update({ lida: true }).eq('id', id);
    return res.status(200).json({ mensagem: 'Marcada como lida' });
  }

  return res.status(405).json({ erro: 'Método não permitido' });
};
