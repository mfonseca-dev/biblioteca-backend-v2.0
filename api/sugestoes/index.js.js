// api/sugestoes/index.js
// POST /api/sugestoes        — público, envia sugestão
// GET  /api/sugestoes        — admin/recepcao, lista sugestões
// PUT  /api/sugestoes        — admin, marca como lida (body: { id })

const supabase = require('../../lib/supabase');
const { autenticado, verificarToken } = require('../../middleware/auth');

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();

  // POST — público (usuário envia sugestão)
  if (req.method === 'POST') {
    const { tipo, area, mensagem, usuario_id } = req.body || {};
    if (!mensagem) return res.status(400).json({ erro: 'mensagem obrigatoria' });
    const { data, error } = await supabase.from('sugestoes')
      .insert({ tipo, area, mensagem, usuario_id: usuario_id || null })
      .select().single();
    if (error) return res.status(500).json({ erro: 'Erro ao enviar sugestao' });
    return res.status(201).json({ mensagem: 'Sugestao enviada com sucesso!' });
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
    if (!id) return res.status(400).json({ erro: 'id obrigatorio' });
    await supabase.from('sugestoes').update({ lida: true }).eq('id', id);
    return res.status(200).json({ mensagem: 'Marcada como lida' });
  }

  return res.status(405).json({ erro: 'Metodo nao permitido' });
};
