// api/auth/login-usuario.js
const jwt      = require('jsonwebtoken');
const bcrypt   = require('bcryptjs');
const supabase = require('../../lib/supabase');
const SECRET   = process.env.JWT_SECRET;

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ erro: 'Método nao permitido' });

  const { cpf, senha } = req.body || {};
  if (!cpf || !senha) return res.status(400).json({ erro: 'CPF e senha sao obrigatorios' });

  const cpfLimpo = cpf.replace(/\D/g, '');
  if (cpfLimpo.length !== 11) return res.status(400).json({ erro: 'CPF invalido' });

  const { data: usuario } = await supabase
    .from('usuarios')
    .select('id, nome, cpf, tipo, ativo, senha_hash, foto_url')
    .eq('cpf', cpfLimpo)
    .maybeSingle();

  if (!usuario) return res.status(401).json({ erro: 'CPF nao cadastrado' });
  if (!usuario.ativo) return res.status(403).json({ erro: 'Conta suspensa. Entre em contato com a recepcao.' });
  if (!usuario.senha_hash) return res.status(401).json({ erro: 'Senha nao definida. Procure a recepcao.' });

  const ok = await bcrypt.compare(senha, usuario.senha_hash);
  if (!ok) return res.status(401).json({ erro: 'Senha incorreta' });

  const token = jwt.sign(
    { id: usuario.id, nome: usuario.nome, cpf: usuario.cpf, tipo: usuario.tipo },
    SECRET, { expiresIn: '12h' }
  );

  return res.status(200).json({
    token,
    usuario: { id: usuario.id, nome: usuario.nome, cpf: usuario.cpf, tipo: usuario.tipo, foto_url: usuario.foto_url }
  });
};
