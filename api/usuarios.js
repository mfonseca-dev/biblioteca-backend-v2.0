// api/usuarios.js
// Rota unificada para usuários
//
// GET  /api/usuarios?acao=listar                    — admin/recepcao, lista usuários
// POST /api/usuarios?acao=cadastrar                 — admin/recepcao, cadastra usuário
//                                                     body: { nome, cpf, tipo?, foto_url?, senha?, assinatura_svg? }
// POST /api/usuarios?acao=redefinir-senha           — admin/recepcao, redefine senha
//                                                     body: { usuario_id, nova_senha }
// POST /api/usuarios?acao=desativar                 — admin/recepcao, bloqueia usuário
//                                                     body: { usuario_id }
// POST /api/usuarios?acao=reativar                  — admin/recepcao, reativa usuário
//                                                     body: { usuario_id }

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

  // ─── GET /api/usuarios?acao=listar ────────────────────────────────────────
  if (req.method === 'GET' && acao === 'listar') {
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

  // ─── POST ─────────────────────────────────────────────────────────────────
  if (req.method !== 'POST') return res.status(405).json({ erro: 'Método não permitido' });

  // ─── POST /api/usuarios?acao=cadastrar ────────────────────────────────────
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

  // ─── POST /api/usuarios?acao=redefinir-senha ──────────────────────────────
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
      .eq('id', usuario_id).select('id, nome, cpf').single();

    if (error || !data) return res.status(404).json({ erro: 'Usuário não encontrado' });

    return res.status(200).json({ mensagem: `Senha redefinida para ${data.nome}`, usuario: data });
  }

  // ─── POST /api/usuarios?acao=desativar (bloquear) ─────────────────────────
  if (acao === 'desativar') {
    const auth = autenticado(req, res);
    if (!auth.ok) return;

    const { usuario_id } = req.body || {};
    if (!usuario_id) return res.status(400).json({ erro: 'usuario_id é obrigatório' });

    const { data, error } = await supabase
      .from('usuarios')
      .update({ ativo: false, updated_at: new Date().toISOString() })
      .eq('id', usuario_id).select('id, nome').single();

    if (error || !data) return res.status(404).json({ erro: 'Usuário não encontrado' });

    console.log(`[BLOQUEIO] Usuário ${data.nome} (${usuario_id}) foi bloqueado.`);
    return res.status(200).json({ mensagem: `${data.nome} foi bloqueado com sucesso.` });
  }

  // ─── POST /api/usuarios?acao=reativar ─────────────────────────────────────
  if (acao === 'reativar') {
    const auth = autenticado(req, res);
    if (!auth.ok) return;

    const { usuario_id } = req.body || {};
    if (!usuario_id) return res.status(400).json({ erro: 'usuario_id é obrigatório' });

    const { data, error } = await supabase
      .from('usuarios')
      .update({ ativo: true, updated_at: new Date().toISOString() })
      .eq('id', usuario_id).select('id, nome').single();

    if (error || !data) return res.status(404).json({ erro: 'Usuário não encontrado' });

    console.log(`[REATIVAÇÃO] Usuário ${data.nome} (${usuario_id}) foi reativado.`);
    return res.status(200).json({ mensagem: `${data.nome} foi reativado com sucesso.` });
  }

  return res.status(400).json({ erro: 'acao inválida. Use: cadastrar, listar, redefinir-senha, desativar, reativar' });
};

//
// GET  /api/usuarios?action=listar                    — admin/recepcao, lista usuários
// POST /api/usuarios?action=cadastrar                 — admin/recepcao, cadastra usuário
//                                                       body: { nome, cpf, tipo?, foto_url? }
// POST /api/usuarios?action=redefinir-senha           — admin/recepcao, redefine senha
//                                                       body: { usuario_id, nova_senha }

const supabase = require('../lib/supabase');
const bcrypt   = require('../node_modules/bcryptjs');
const { autenticado, soAdmin } = require('../middleware/auth');

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

module.exports = async function handler(req, res) {
  Object.entries(CORS).forEach(([k, v]) => res.setHeader(k, v));
  if (req.method === 'OPTIONS') return res.status(200).end();

  const { action } = req.query;

  // ─── GET /api/usuarios?action=listar ──────────────────────────────────────
  if (req.method === 'GET' && action === 'listar') {
    const auth = autenticado(req, res);
    if (!auth.ok) return;

    const { busca, ativo } = req.query;

    let query = supabase
      .from('usuarios')
      .select('id, nome, cpf, tipo, ativo, foto_url, created_at')
      .order('nome', { ascending: true });

    if (ativo !== undefined) query = query.eq('ativo', ativo === 'true');
    if (busca) query = query.ilike('nome', `%${busca}%`);

    const { data, error } = await query;
    if (error) {
      console.error('Erro ao listar usuários:', error);
      return res.status(500).json({ erro: 'Erro interno' });
    }

    return res.status(200).json({ usuarios: data, total: data.length });
  }

  // ─── POST /api/usuarios?action=cadastrar ──────────────────────────────────
  if (req.method === 'POST' && action === 'cadastrar') {
    const auth = autenticado(req, res);
    if (!auth.ok) return;

    const { nome, cpf, tipo = 'aluno', foto_url, senha } = req.body || {};

    if (!nome || !cpf) return res.status(400).json({ erro: 'nome e cpf são obrigatórios' });

    const cpfLimpo = cpf.replace(/\D/g, '');
    if (cpfLimpo.length !== 11) return res.status(400).json({ erro: 'CPF inválido' });

    // Verifica duplicata
    const { data: existente } = await supabase
      .from('usuarios')
      .select('id')
      .eq('cpf', cpfLimpo)
      .maybeSingle();

    if (existente) return res.status(409).json({ erro: 'CPF já cadastrado' });

    const senha_hash = senha ? await bcrypt.hash(senha, 10) : null;

    const { data, error } = await supabase
      .from('usuarios')
      .insert({ nome, cpf: cpfLimpo, tipo, foto_url, senha_hash, ativo: true })
      .select('id, nome, cpf, tipo, foto_url, ativo, created_at')
      .single();

    if (error) {
      console.error('Erro ao cadastrar usuário:', error);
      return res.status(500).json({ erro: 'Erro interno ao cadastrar' });
    }

    return res.status(201).json({ mensagem: 'Usuário cadastrado com sucesso', usuario: data });
  }

  // ─── POST /api/usuarios?action=redefinir-senha ────────────────────────────
  if (req.method === 'POST' && action === 'redefinir-senha') {
    const auth = autenticado(req, res);
    if (!auth.ok) return;

    const { usuario_id, nova_senha } = req.body || {};
    if (!usuario_id || !nova_senha) {
      return res.status(400).json({ erro: 'usuario_id e nova_senha são obrigatórios' });
    }
    if (nova_senha.length < 6) {
      return res.status(400).json({ erro: 'Senha deve ter pelo menos 6 caracteres' });
    }

    const senha_hash = await bcrypt.hash(nova_senha, 10);

    const { data, error } = await supabase
      .from('usuarios')
      .update({ senha_hash })
      .eq('id', usuario_id)
      .select('id, nome')
      .single();

    if (error || !data) {
      return res.status(404).json({ erro: 'Usuário não encontrado' });
    }

    return res.status(200).json({ mensagem: `Senha redefinida para ${data.nome}` });
  }

  return res.status(404).json({ erro: 'Ação não encontrada. Use: listar, cadastrar, redefinir-senha' });
};
