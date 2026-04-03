// api/usuarios/redefinir-senha.js
// POST /api/usuarios/redefinir-senha
// Body: { usuario_id, nova_senha }
// Requer: token de recepcao ou admin

const bcrypt   = require('bcryptjs');
const supabase = require('../../lib/supabase');
const { autenticado } = require('../../middleware/auth');

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ erro: 'Metodo nao permitido' });

  const auth = autenticado(req, res);
  if (!auth.ok) return;

  const { usuario_id, nova_senha } = req.body || {};

  if (!usuario_id || !nova_senha) {
    return res.status(400).json({ erro: 'usuario_id e nova_senha sao obrigatorios' });
  }

  if (nova_senha.length < 6) {
    return res.status(400).json({ erro: 'Senha minima de 6 caracteres' });
  }

  const senha_hash = await bcrypt.hash(nova_senha, 10);

  const { data, error } = await supabase
    .from('usuarios')
    .update({ senha_hash, updated_at: new Date().toISOString() })
    .eq('id', usuario_id)
    .select('id, nome, cpf')
    .single();

  if (error || !data) {
    return res.status(404).json({ erro: 'Usuario nao encontrado' });
  }

  return res.status(200).json({
    mensagem: `Senha redefinida para ${data.nome}`,
    usuario: data
  });
};
