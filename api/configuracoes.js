// api/configuracoes.js
// GET  /api/configuracoes           → lista configs públicas
// POST /api/configuracoes           → salva config (admin)

const supabase = require('../lib/supabase');
const { soAdmin } = require('../middleware/auth');

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();

  if (req.method === 'GET') {
    const { data } = await supabase
      .from('configuracoes')
      .select('chave, valor')
      .not('chave', 'in', '("controlid_token","senha_admin","senha_recepcao")');
    return res.status(200).json({ configuracoes: data || [] });
  }

  if (req.method !== 'POST') return res.status(405).json({ erro: 'Método não permitido' });

  const auth = soAdmin(req, res);
  if (!auth.ok) return;

  const { chave, valor } = req.body || {};
  if (!chave || valor === undefined) return res.status(400).json({ erro: 'chave e valor são obrigatórios' });

  const { data, error } = await supabase
    .from('configuracoes')
    .upsert({ chave, valor, updated_at: new Date().toISOString() })
    .select().single();

  if (error) {
    console.error('Erro ao salvar config:', error);
    return res.status(500).json({ erro: 'Erro interno' });
  }

  return res.status(200).json({ mensagem: 'Configuração salva', config: data });
};
