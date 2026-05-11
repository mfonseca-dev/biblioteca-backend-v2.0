// api/usuarios.js
// GET  /api/usuarios?acao=listar            → listar usuários (auth)
// GET  /api/usuarios?acao=buscar&id=UUID    → buscar usuário individual com assinatura (auth)
// GET  /api/usuarios?acao=buscar-cpf&cpf=CPF → buscar por CPF exato (público — totem)
// GET  /api/usuarios?acao=verificar-primeiro-acesso&cpf=CPF → verifica se precisa completar cadastro
// POST /api/usuarios?acao=cadastrar         → cadastrar novo usuário (público)
// POST /api/usuarios?acao=redefinir-senha   → redefinir senha (auth)
// POST /api/usuarios?acao=bloquear          → bloquear/ativar usuário (auth admin)
// POST /api/usuarios?acao=assinar-termo     → salvar assinatura (público)
// POST /api/usuarios?acao=atualizar         → atualizar documento/observações (auth admin)

const bcrypt   = require('bcryptjs');
const supabase = require('../supabase');
const { autenticado } = require('../../middleware/auth');

const SENHA_RE  = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[!@#$%^&*()\-_=+\[\]{};:'",.<>?/\\|`~]).{8,}$/;
const SENHA_MSG = 'Senha fraca: mínimo 8 caracteres, com maiúscula, minúscula, número e símbolo (ex: !@#$)';

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const acao = req.query.acao;

  // ── GET ───────────────────────────────────────────────────────────────────
  if (req.method === 'GET') {

    // Verificar primeiro acesso — público (totem/app)
    if (acao === 'verificar-primeiro-acesso') {
      const { cpf } = req.query;
      if (!cpf) return res.status(400).json({ erro: 'cpf obrigatório' });
      const cpfLimpo = cpf.replace(/\D/g, '');
      const { data } = await supabase
        .from('usuarios')
        .select('id, nome, cpf, foto_url, senha_hash, termo_aceito_em, termo_versao_aceita, ativo')
        .eq('cpf', cpfLimpo)
        .maybeSingle();
      if (!data) return res.status(404).json({ encontrado: false });
      if (!data.ativo) return res.status(403).json({ erro: 'Conta suspensa. Entre em contato com a recepção.' });
      // Foto ausente NÃO bloqueia — só senha e termo são obrigatórios
      const precisaCadastro = !data.senha_hash || !data.termo_aceito_em;
      return res.status(200).json({
        encontrado:          true,
        id:                  data.id,
        nome:                data.nome,
        cpf:                 data.cpf,
        foto_url:            data.foto_url || null,
        primeiro_acesso:     precisaCadastro,
        sem_senha:           !data.senha_hash,
        sem_termo:           !data.termo_aceito_em,
        sem_foto:            !data.foto_url,
        termo_versao_aceita: data.termo_versao_aceita || null
      });
    }

    // Buscar por CPF exato — público (totem)
    if (acao === 'buscar-cpf') {
      const { cpf } = req.query;
      if (!cpf) return res.status(400).json({ erro: 'cpf obrigatório' });
      const cpfLimpo = cpf.replace(/\D/g, '');
      const { data, error } = await supabase
        .from('usuarios')
        .select('id, nome, cpf, email, tipo, ativo, foto_url')
        .eq('cpf', cpfLimpo)
        .maybeSingle();
      if (error) return res.status(500).json({ erro: 'Erro interno' });
      if (!data) return res.status(404).json({ erro: 'CPF não encontrado', usuario: null });
      return res.status(200).json({ usuario: data });
    }

    // Rotas abaixo exigem autenticação
    const auth = autenticado(req, res);
    if (!auth.ok) return;

    // Total real de usuários
    if (acao === 'total') {
      const { count, error } = await supabase
        .from('usuarios')
        .select('*', { count: 'exact', head: true });
      if (error) return res.status(500).json({ erro: 'Erro interno' });
      return res.status(200).json({ total: count || 0 });
    }

    // Total pendentes termo
    if (acao === 'total-pendentes-termo') {
      const { data: cfgVersao } = await supabase
        .from('configuracoes').select('valor').eq('chave', 'termo_versao').maybeSingle();
      const versaoAtual = cfgVersao?.valor || '1.0';
      const { count } = await supabase
        .from('usuarios').select('*', { count: 'exact', head: true })
        .eq('ativo', true)
        .or(`termo_versao_aceita.is.null,termo_versao_aceita.neq.${versaoAtual}`);
      return res.status(200).json({ total: count || 0, versao_atual: versaoAtual });
    }

    // Buscar usuário individual com assinatura
    if (acao === 'buscar') {
      const { id } = req.query;
      if (!id) return res.status(400).json({ erro: 'id obrigatório' });
      const { data, error } = await supabase
        .from('usuarios')
        .select('id, nome, cpf, email, telefone, tipo, ativo, foto_url, assinatura_svg, termo_aceito_em, termo_ip, documento_oficial, observacoes, created_at')
        .eq('id', id)
        .maybeSingle();
      if (error || !data) return res.status(404).json({ erro: 'Usuário não encontrado' });
      return res.status(200).json({ usuario: data });
    }

    // Listar usuários
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
    const { data, error } = await query.limit(200);
    if (error) return res.status(500).json({ erro: 'Erro interno' });
    return res.status(200).json({ usuarios: data, total: data.length });
  }

  // ── POST ──────────────────────────────────────────────────────────────────
  if (req.method !== 'POST') return res.status(405).json({ erro: 'Método não permitido' });

  // Cadastrar (público)
  if (acao === 'cadastrar' || !acao) {
    const { nome, cpf, email, telefone, foto_url, tipo = 'aluno', senha, assinatura_svg } = req.body || {};
    if (!nome || !cpf) return res.status(400).json({ erro: 'Nome e CPF são obrigatórios' });
    const cpfLimpo = cpf.replace(/\D/g, '');
    if (cpfLimpo.length !== 11) return res.status(400).json({ erro: 'CPF inválido' });
    const { data: existe } = await supabase
      .from('usuarios').select('id, nome, ativo').eq('cpf', cpfLimpo).maybeSingle();
    if (existe) return res.status(409).json({ erro: 'CPF já cadastrado', usuario: existe });
    const insertData = { nome, cpf: cpfLimpo, email, telefone, foto_url, tipo };
    if (assinatura_svg) {
      insertData.assinatura_svg = assinatura_svg;
      insertData.termo_aceito_em = new Date().toISOString();
    }
    if (senha) {
      if (!SENHA_RE.test(senha)) return res.status(400).json({ erro: SENHA_MSG });
      insertData.senha_hash = await bcrypt.hash(senha, 10);
    }
    const { data, error } = await supabase
      .from('usuarios').insert(insertData)
      .select('id, nome, cpf, email, tipo, ativo, created_at').single();
    if (error) return res.status(500).json({ erro: 'Erro interno ao cadastrar' });
    return res.status(201).json({ mensagem: 'Usuário cadastrado com sucesso', usuario: data });
  }

  // Assinar termo (público)
  if (acao === 'assinar-termo') {
    const { usuario_id, assinatura_svg, ip, versao } = req.body || {};
    if (!usuario_id || !assinatura_svg) return res.status(400).json({ erro: 'usuario_id e assinatura_svg obrigatórios' });
    await supabase.from('usuarios').update({
      assinatura_svg,
      termo_aceito_em:     new Date().toISOString(),
      termo_ip:            ip || 'desconhecido',
      termo_versao_aceita: versao || '1.0'
    }).eq('id', usuario_id);
    return res.status(200).json({ mensagem: 'Termo assinado com sucesso' });
  }

  // Salvar foto (público — vincula por usuario_id + cpf)
  if (acao === 'salvar-foto') {
    const { usuario_id, cpf, foto_base64 } = req.body || {};
    if (!usuario_id || !cpf || !foto_base64) return res.status(400).json({ erro: 'Dados obrigatórios' });
    const cpfLimpo = cpf.replace(/\D/g, '');
    const { data: u } = await supabase
      .from('usuarios').select('id').eq('id', usuario_id).eq('cpf', cpfLimpo).maybeSingle();
    if (!u) return res.status(404).json({ erro: 'Usuário não encontrado' });
    const { error } = await supabase
      .from('usuarios').update({ foto_url: foto_base64 }).eq('id', usuario_id);
    if (error) return res.status(500).json({ erro: error.message });
    return res.status(200).json({ ok: true });
  }

  // Definir senha primeiro acesso (público — só se não tiver senha)
  if (acao === 'definir-senha-primeiro-acesso') {
    const { usuario_id, nova_senha, cpf } = req.body || {};
    if (!usuario_id || !nova_senha || !cpf) return res.status(400).json({ erro: 'usuario_id, cpf e nova_senha obrigatórios' });
    if (!SENHA_RE.test(nova_senha)) return res.status(400).json({ erro: SENHA_MSG });
    const cpfLimpo = cpf.replace(/\D/g, '');
    const { data: usuario } = await supabase
      .from('usuarios').select('id, nome, cpf, senha_hash')
      .eq('id', usuario_id).eq('cpf', cpfLimpo).maybeSingle();
    if (!usuario) return res.status(404).json({ erro: 'Usuário não encontrado' });
    if (usuario.senha_hash) return res.status(409).json({ erro: 'Senha já definida. Use a opção "Esqueci minha senha" na recepção.' });
    const senha_hash = await bcrypt.hash(nova_senha, 10);
    const { error } = await supabase
      .from('usuarios').update({ senha_hash, updated_at: new Date().toISOString() }).eq('id', usuario_id);
    if (error) return res.status(500).json({ erro: 'Erro ao salvar senha' });
    return res.status(200).json({ mensagem: `Senha definida com sucesso para ${usuario.nome}` });
  }

  // Redefinir senha (auth recepção/admin)
  if (acao === 'redefinir-senha') {
    const auth = autenticado(req, res);
    if (!auth.ok) return;
    const { usuario_id, nova_senha } = req.body || {};
    if (!usuario_id || !nova_senha) return res.status(400).json({ erro: 'usuario_id e nova_senha obrigatórios' });
    if (!SENHA_RE.test(nova_senha)) return res.status(400).json({ erro: SENHA_MSG });
    const senha_hash = await bcrypt.hash(nova_senha, 10);
    const { data, error } = await supabase.from('usuarios')
      .update({ senha_hash, updated_at: new Date().toISOString() })
      .eq('id', usuario_id).select('id, nome, cpf').single();
    if (error || !data) return res.status(404).json({ erro: 'Usuário não encontrado' });
    return res.status(200).json({ mensagem: `Senha redefinida para ${data.nome}`, usuario: data });
  }

  // Bloquear / Ativar usuário (auth admin)
  if (acao === 'bloquear') {
    const auth = autenticado(req, res);
    if (!auth.ok) return;
    const { usuario_id, ativo } = req.body || {};
    if (!usuario_id || ativo === undefined) return res.status(400).json({ erro: 'usuario_id e ativo obrigatórios' });
    const { data, error } = await supabase.from('usuarios')
      .update({ ativo, updated_at: new Date().toISOString() })
      .eq('id', usuario_id).select('id, nome, ativo').single();
    if (error || !data) return res.status(404).json({ erro: 'Usuário não encontrado' });
    return res.status(200).json({ mensagem: `Usuário ${data.nome} ${ativo ? 'ativado' : 'bloqueado'}`, usuario: data });
  }

  // Atualizar documento oficial e observações (auth admin)
  if (acao === 'atualizar') {
    const auth = autenticado(req, res);
    if (!auth.ok) return;
    if (auth.tipo !== 'admin') return res.status(403).json({ erro: 'Apenas admin' });
    const { id, documento_oficial, observacoes, ativo } = req.body || {};
    if (!id) return res.status(400).json({ erro: 'ID obrigatório' });
    const update = { updated_at: new Date().toISOString() };
    if (documento_oficial !== undefined) update.documento_oficial = documento_oficial;
    if (observacoes       !== undefined) update.observacoes       = observacoes;
    if (ativo             !== undefined) update.ativo             = ativo;
    const { data, error } = await supabase
      .from('usuarios').update(update).eq('id', id)
      .select('id, nome, cpf, documento_oficial, observacoes, ativo').single();
    if (error || !data) return res.status(404).json({ erro: 'Usuário não encontrado' });
    return res.status(200).json({ mensagem: 'Usuário atualizado', usuario: data });
  }

  // Invalidar todos os termos (auth admin)
  if (acao === 'invalidar-termos') {
    const auth = autenticado(req, res);
    if (!auth.ok) return;
    const { nova_versao } = req.body || {};
    if (!nova_versao) return res.status(400).json({ erro: 'nova_versao obrigatória' });
    const { error } = await supabase
      .from('usuarios').update({ termo_versao_aceita: null })
      .neq('id', '00000000-0000-0000-0000-000000000000');
    if (error) return res.status(500).json({ erro: 'Erro ao invalidar termos' });
    const { count: total } = await supabase
      .from('usuarios').select('*', { count: 'exact', head: true }).eq('ativo', true);
    return res.status(200).json({ mensagem: 'Termos invalidados', invalidados: total || 0 });
  }

  return res.status(400).json({ erro: 'acao inválida' });
};
