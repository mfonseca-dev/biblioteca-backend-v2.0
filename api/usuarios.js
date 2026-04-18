const bcrypt   = require('bcryptjs');
const supabase = require('../lib/supabase');
const { autenticado } = require('../middleware/auth');

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, Accept, X-Requested-With');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const acao = req.query.acao;

  // ── GET ─────────────────────────────────────────────
  if (req.method === 'GET') {
    const auth = autenticado(req, res);
    if (!auth.ok) return;

    // 🔎 Buscar usuário com assinatura
    if (acao === 'buscar') {
      const { id } = req.query;
      if (!id) return res.status(400).json({ erro: 'id obrigatório' });

      const { data, error } = await supabase
        .from('usuarios')
        .select('id, nome, cpf, email, tipo, ativo, assinatura_svg, termo_aceito_em, termo_ip, created_at')
        .eq('id', id)
        .maybeSingle();

      if (error || !data) return res.status(404).json({ erro: 'Usuário não encontrado' });

      return res.status(200).json({ usuario: data });
    }

    // 📋 LISTAR USUÁRIOS (AGORA COM TERMO)
    const { busca, tipo, ativo = 'true' } = req.query;

    let query = supabase
      .from('usuarios')
      .select('id, nome, cpf, email, telefone, foto_url, tipo, ativo, assinatura_svg, termo_aceito_em, termo_ip, created_at')
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
      console.error(error);
      return res.status(500).json({ erro: 'Erro interno' });
    }

    return res.status(200).json({ usuarios: data, total: data.length });
  }

  // ── POST ─────────────────────────────────────────────
  if (req.method !== 'POST') return res.status(405).json({ erro: 'Método não permitido' });

  // 🆕 CADASTRAR
  if (acao === 'cadastrar' || !acao) {
    const { nome, cpf, email, telefone, foto_url, tipo = 'aluno', senha, assinatura_svg } = req.body || {};

    if (!nome || !cpf) return res.status(400).json({ erro: 'Nome e CPF são obrigatórios' });

    const cpfLimpo = cpf.replace(/\D/g, '');
    if (cpfLimpo.length !== 11) return res.status(400).json({ erro: 'CPF inválido' });

    const { data: existe } = await supabase
      .from('usuarios')
      .select('id')
      .eq('cpf', cpfLimpo)
      .maybeSingle();

    if (existe) return res.status(409).json({ erro: 'CPF já cadastrado' });

    const insertData = { nome, cpf: cpfLimpo, email, telefone, foto_url, tipo };

    if (assinatura_svg) {
      insertData.assinatura_svg = assinatura_svg;
      insertData.termo_aceito_em = new Date().toISOString();
    }

    if (senha) {
      insertData.senha_hash = await bcrypt.hash(senha, 10);
    }

    const { data, error } = await supabase
      .from('usuarios')
      .insert(insertData)
      .select('id, nome, cpf, tipo, ativo, created_at')
      .single();

    if (error) return res.status(500).json({ erro: 'Erro ao cadastrar' });

    return res.status(201).json({ usuario: data });
  }

  // 🔒 BLOQUEAR / ATIVAR
  if (acao === 'bloquear') {
    const auth = autenticado(req, res);
    if (!auth.ok) return;

    const { usuario_id, ativo } = req.body || {};

    if (!usuario_id || ativo === undefined) {
      return res.status(400).json({ erro: 'usuario_id e ativo obrigatórios' });
    }

    const { data, error } = await supabase
      .from('usuarios')
      .update({ ativo, updated_at: new Date().toISOString() })
      .eq('id', usuario_id)
      .select('id, nome, ativo')
      .single();

    if (error || !data) return res.status(404).json({ erro: 'Usuário não encontrado' });

    return res.status(200).json({
      mensagem: `${data.nome} ${data.ativo ? 'ativado' : 'bloqueado'}`
    });
  }

  return res.status(400).json({ erro: 'ação inválida' });
};
