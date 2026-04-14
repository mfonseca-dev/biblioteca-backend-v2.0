// api/usuarios/cadastrar.js
const bcrypt   = require('bcryptjs');
const supabase = require('../../lib/supabase');

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ erro: 'Metodo nao permitido' });

  const { nome, cpf, email, telefone, tipo = 'aluno', senha } = req.body || {};

  if (!nome || !cpf) return res.status(400).json({ erro: 'Nome e CPF sao obrigatorios' });
  if (!senha || senha.length < 6) return res.status(400).json({ erro: 'Senha obrigatoria (minimo 6 caracteres)' });

  const cpfLimpo = cpf.replace(/\D/g, '');
  if (cpfLimpo.length !== 11) return res.status(400).json({ erro: 'CPF invalido' });

  const { data: existe } = await supabase
    .from('usuarios')
    .select('id, nome, ativo')
    .eq('cpf', cpfLimpo)
    .maybeSingle();

  if (existe) return res.status(409).json({ erro: 'CPF ja cadastrado', usuario: existe });

  const senha_hash = await bcrypt.hash(senha, 10);

  const { data, error } = await supabase
    .from('usuarios')
    .insert({ nome, cpf: cpfLimpo, email, telefone, tipo, senha_hash })
    .select('id, nome, cpf, email, tipo, ativo, created_at')
    .single();

  if (error) {
    console.error('Erro ao cadastrar:', error);
    return res.status(500).json({ erro: 'Erro interno ao cadastrar' });
  }

  return res.status(201).json({ mensagem: 'Usuario cadastrado com sucesso', usuario: data });
};
