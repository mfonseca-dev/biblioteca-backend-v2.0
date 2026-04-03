// api/usuarios/login.js
// POST /api/usuarios/login — rota PÚBLICA
const supabase = require('../../lib/supabase');

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ erro: 'Método não permitido' });

  const { cpf } = req.body || {};
  if (!cpf) return res.status(400).json({ erro: 'CPF obrigatório' });

  const cpfLimpo = cpf.replace(/\D/g, '');

  const { data: usuario, error } = await supabase
    .from('usuarios')
    .select('id, nome, cpf, email, tipo, ativo, foto_url')
    .eq('cpf', cpfLimpo)
    .maybeSingle();

  if (error || !usuario) return res.status(404).json({ erro: 'CPF não cadastrado' });
  if (!usuario.ativo) return res.status(403).json({ erro: 'Conta suspensa. Fale com a recepção.' });

  return res.status(200).json({ usuario });
};