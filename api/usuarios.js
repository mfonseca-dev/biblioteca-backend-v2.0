const supabase = require('../lib/supabase');
const bcrypt   = require('bcryptjs');
const { autenticado } = require('../middleware/auth');

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

module.exports = async function handler(req, res) {
  Object.entries(CORS).forEach(([k, v]) => res.setHeader(k, v));
  if (req.method === 'OPTIONS') return res.status(200).end();

  const acao = req.query.acao || req.query.action;

  try {

    // ─────────────────────────────────────────────
    // 🔍 LISTAR USUÁRIOS
    // ─────────────────────────────────────────────
    if (req.method === 'GET' && acao === 'listar') {
      const auth = autenticado(req, res);
      if (!auth.ok) return;

      const { busca, tipo, ativo = 'true' } = req.query;

      let query = supabase
        .from('usuarios')
        .select('id, nome, cpf, email, telefone, foto_url, tipo, ativo, created_at')
        .order('nome');

      if (ativo !== 'todos') {
        query = query.eq('ativo', ativo === 'true');
      }

      if (tipo) {
        query = query.eq('tipo', tipo);
      }

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
        return res.status(500).json({ erro: 'Erro interno ao listar usuários' });
      }

      return res.status(200).json({
        usuarios: data,
        total: data.length
      });
    }

    // ─────────────────────────────────────────────
    // ❌ BLOQUEAR USUÁRIO
    // ─────────────────────────────────────────────
    if (req.method === 'POST' && acao === 'desativar') {
      const auth = autenticado(req, res);
      if (!auth.ok) return;

      const { usuario_id } = req.body || {};

      if (!usuario_id) {
        return res.status(400).json({ erro: 'usuario_id é obrigatório' });
      }

      const { data, error } = await supabase
        .from('usuarios')
        .update({
          ativo: false,
          updated_at: new Date().toISOString()
        })
        .eq('id', usuario_id)
        .select('id, nome')
        .single();

      if (error || !data) {
        return res.status(404).json({ erro: 'Usuário não encontrado' });
      }

      console.log(`[BLOQUEIO] ${data.nome} (${usuario_id})`);

      return res.status(200).json({
        mensagem: `${data.nome} foi bloqueado com sucesso`
      });
    }

    // ─────────────────────────────────────────────
    // ✅ REATIVAR USUÁRIO
    // ─────────────────────────────────────────────
    if (req.method === 'POST' && acao === 'reativar') {
      const auth = autenticado(req, res);
      if (!auth.ok) return;

      const { usuario_id } = req.body || {};

      if (!usuario_id) {
        return res.status(400).json({ erro: 'usuario_id é obrigatório' });
      }

      const { data, error } = await supabase
        .from('usuarios')
        .update({
          ativo: true,
          updated_at: new Date().toISOString()
        })
        .eq('id', usuario_id)
        .select('id, nome')
        .single();

      if (error || !data) {
        return res.status(404).json({ erro: 'Usuário não encontrado' });
      }

      console.log(`[REATIVAÇÃO] ${data.nome} (${usuario_id})`);

      return res.status(200).json({
        mensagem: `${data.nome} foi reativado com sucesso`
      });
    }

    // ─────────────────────────────────────────────
    // 👤 CADASTRAR USUÁRIO
    // ─────────────────────────────────────────────
    if (req.method === 'POST' && (acao === 'cadastrar' || !acao)) {

      const {
        nome,
        cpf,
        email,
        telefone,
        foto_url,
        tipo = 'aluno',
        senha,
        assinatura_svg
      } = req.body || {};

      if (!nome || !cpf) {
        return res.status(400).json({ erro: 'Nome e CPF são obrigatórios' });
      }

      const cpfLimpo = cpf.replace(/\D/g, '');

      if (cpfLimpo.length !== 11) {
        return res.status(400).json({ erro: 'CPF inválido' });
      }

      const { data: existe } = await supabase
        .from('usuarios')
        .select('id')
        .eq('cpf', cpfLimpo)
        .maybeSingle();

      if (existe) {
        return res.status(409).json({ erro: 'CPF já cadastrado' });
      }

      const insertData = {
        nome,
        cpf: cpfLimpo,
        email,
        telefone,
        foto_url,
        tipo,
        ativo: true,
        assinatura_svg: assinatura_svg || null,
        termo_aceito_em: assinatura_svg ? new Date().toISOString() : null
      };

      if (senha) {
        if (senha.length < 6) {
          return res.status(400).json({ erro: 'Senha mínima de 6 caracteres' });
        }

        insertData.senha_hash = await bcrypt.hash(senha, 10);
      }

      const { data, error } = await supabase
        .from('usuarios')
        .insert(insertData)
        .select('id, nome, cpf, tipo, ativo, created_at')
        .single();

      if (error) {
        console.error('Erro ao cadastrar:', error);
        return res.status(500).json({ erro: 'Erro interno ao cadastrar' });
      }

      return res.status(201).json({
        mensagem: 'Usuário cadastrado com sucesso',
        usuario: data
      });
    }

    // ─────────────────────────────────────────────
    // 🔑 REDEFINIR SENHA
    // ─────────────────────────────────────────────
    if (req.method === 'POST' && acao === 'redefinir-senha') {
      const auth = autenticado(req, res);
      if (!auth.ok) return;

      const { usuario_id, nova_senha } = req.body || {};

      if (!usuario_id || !nova_senha) {
        return res.status(400).json({ erro: 'usuario_id e nova_senha são obrigatórios' });
      }

      if (nova_senha.length < 6) {
        return res.status(400).json({ erro: 'Senha mínima de 6 caracteres' });
      }

      const senha_hash = await bcrypt.hash(nova_senha, 10);

      const { data, error } = await supabase
        .from('usuarios')
        .update({
          senha_hash,
          updated_at: new Date().toISOString()
        })
        .eq('id', usuario_id)
        .select('id, nome')
        .single();

      if (error || !data) {
        return res.status(404).json({ erro: 'Usuário não encontrado' });
      }

      return res.status(200).json({
        mensagem: `Senha redefinida para ${data.nome}`
      });
    }

    // ─────────────────────────────────────────────
    // ❌ AÇÃO INVÁLIDA
    // ─────────────────────────────────────────────
    return res.status(400).json({
      erro: 'Ação inválida. Use: listar, cadastrar, redefinir-senha, desativar, reativar'
    });

  } catch (err) {
    console.error('ERRO GERAL:', err);

    return res.status(500).json({
      erro: 'Erro interno do servidor'
    });
  }
};
