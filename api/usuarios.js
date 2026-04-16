// api/usuarios.js
// GET  /api/usuarios                       → listar usuários (auth)
// POST /api/usuarios?acao=cadastrar        → cadastrar novo usuário (público)
// POST /api/usuarios?acao=redefinir-senha  → redefinir senha (auth recepcao/admin)

const bcrypt   = require('bcryptjs');
const supabase = require('../lib/supabase');
const { autenticado } = require('../middleware/auth');

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();

  // ── GET — listar usuários ─────────────────────────────────────────────────
  if (req.method === 'GET') {
    const auth = autenticado(req, res);
    if (!auth.ok) return;

    const { busca, tipo, ativo = 'true' } = req.query;

    let query = supabase
      .from('usuarios')
      .select('id, nome, cpf, email, telefone, foto_url, tipo, ativo, created_at')
      .order('nome');

    if (ativo !== 'todos') query = query.eq('ativo', ativo === 'true');
    if (tipo) query = query.eq('tipo', tipo);

    if (busca) {
      const cpfBusca = busca.replace(/\D/g, '');
      if (cpfBusca.length >= 3) {
        query = query.or(`cpf.ilike.%${cpfBusca}%,nome.ilike.%${busca}%`);
      } else {
        query = query.ilike('nome', `%${busca}%`);
      }
    }

    const { data, error } = await query.limit(100);
    if (error) {
      console.error('Erro ao listar usuários:', error);
      return res.status(500).json({ erro: 'Erro interno' });
    }

    return res.status(200).json({ usuarios: data, total: data.length });
  }

  // ── POST ──────────────────────────────────────────────────────────────────
  if (req.method !== 'POST') return res.status(405).json({ erro: 'Método não permitido' });

  const acao = req.query.acao;

  // POST /api/usuarios?acao=cadastrar  (público)
  if (acao === 'cadastrar' || !acao) {
    const { nome, cpf, email, telefone, foto_url, tipo = 'aluno', senha, assinatura_svg } = req.body || {};

    if (!nome || !cpf) return res.status(400).json({ erro: 'Nome e CPF são obrigatórios' });

    const cpfLimpo = cpf.replace(/\D/g, '');
    if (cpfLimpo.length !== 11) return res.status(400).json({ erro: 'CPF inválido' });

    const { data: existe } = await supabase
      .from('usuarios').select('id, nome, ativo').eq('cpf', cpfLimpo).maybeSingle();

    if (existe) return res.status(409).json({ erro: 'CPF já cadastrado', usuario: existe });

    const insertData = {
      nome, cpf: cpfLimpo, email, telefone, foto_url, tipo,
      assinatura_svg: assinatura_svg || null,
      termo_aceito_em: assinatura_svg ? new Date().toISOString() : null
    };

    // Hash de senha se fornecida
    if (senha) {
      if (senha.length < 6) return res.status(400).json({ erro: 'Senha mínima de 6 caracteres' });
      insertData.senha_hash = await bcrypt.hash(senha, 10);
    }

    const { data, error } = await supabase
      .from('usuarios').insert(insertData)
      .select('id, nome, cpf, email, tipo, ativo, created_at').single();

    if (error) {
      console.error('Erro ao cadastrar:', error);
      return res.status(500).json({ erro: 'Erro interno ao cadastrar' });
    }

    return res.status(201).json({ mensagem: 'Usuário cadastrado com sucesso', usuario: data });
  }

  // POST /api/usuarios?acao=redefinir-senha  (auth)
  if (acao === 'redefinir-senha') {
    const auth = autenticado(req, res);
    if (!auth.ok) return;

    const { usuario_id, nova_senha } = req.body || {};
    if (!usuario_id || !nova_senha) return res.status(400).json({ erro: 'usuario_id e nova_senha são obrigatórios' });
    if (nova_senha.length < 6) return res.status(400).json({ erro: 'Senha mínima de 6 caracteres' });

    const senha_hash = await bcrypt.hash(nova_senha, 10);

    const { data, error } = await supabase
      .from('usuarios')
      .update({ senha_hash, updated_at: new Date().toISOString() })
      .eq('id', usuario_id)
      .select('id, nome, cpf').single();

    if (error || !data) return res.status(404).json({ erro: 'Usuário não encontrado' });

    return res.status(200).json({ mensagem: `Senha redefinida para ${data.nome}`, usuario: data });
  }

  return res.status(400).json({ erro: 'acao inválida. Use: cadastrar ou redefinir-senha' });
};
