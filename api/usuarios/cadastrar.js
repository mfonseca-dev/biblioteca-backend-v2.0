// api/usuarios/cadastrar.js
// POST /api/usuarios/cadastrar — rota PÚBLICA
const supabase = require('../../lib/supabase');

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ erro: 'Método não permitido' });

  const { nome, cpf, email, telefone, foto_url, tipo = 'aluno', assinatura_svg } = req.body || {};

  if (!nome || !cpf) {
    return res.status(400).json({ erro: 'Campos obrigatórios: nome, cpf' });
  }

  const cpfLimpo = cpf.replace(/\D/g, '');
  if (cpfLimpo.length !== 11) {
    return res.status(400).json({ erro: 'CPF inválido' });
  }

  const { data: existe } = await supabase
    .from('usuarios')
    .select('id, nome, ativo')
    .eq('cpf', cpfLimpo)
    .maybeSingle();

  if (existe) {
    return res.status(409).json({ erro: 'CPF já cadastrado', usuario: existe });
  }

  const { data, error } = await supabase
    .from('usuarios')
    .insert({ nome, cpf: cpfLimpo, email, telefone, foto_url, tipo })
    .select()
    .single();

  if (error) {
    console.error('Erro ao cadastrar usuário:', error);
    return res.status(500).json({ erro: 'Erro interno ao cadastrar' });
  }

  // Salva assinatura junto com o cadastro
  if (assinatura_svg && data?.id) {
    await supabase
      .from('termos_assinados')
      .insert({
        usuario_id: data.id,
        assinatura_svg,
        assinado_em: new Date().toISOString()
      });
  }

  return res.status(201).json({ mensagem: 'Usuário cadastrado com sucesso', usuario: data });
};