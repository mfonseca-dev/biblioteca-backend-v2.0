// api/acessos/encerrar.js
// POST /api/acessos/encerrar
// Body: { acesso_id }
// Requer: Authorization: Bearer <token>

const supabase = require('../../lib/supabase');
const { autenticado } = require('../../middleware/auth');

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ erro: 'Método não permitido' });

  const auth = autenticado(req, res);
  if (!auth.ok) return;

  const { acesso_id } = req.body || {};
  if (!acesso_id) return res.status(400).json({ erro: 'acesso_id é obrigatório' });

  const { data, error } = await supabase
    .from('acessos')
    .update({ status: 'encerrado', saida_em: new Date().toISOString() })
    .eq('id', acesso_id)
    .eq('status', 'ativo')
    .select()
    .single();

  if (error || !data) {
    return res.status(404).json({ erro: 'Acesso não encontrado ou já encerrado' });
  }

  return res.status(200).json({ mensagem: 'Saída registrada', acesso: data });
};
