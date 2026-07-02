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
const { checar, getIp } = require('../rateLimit');
const SENHA_RE  = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[!@#$%^&*()\-_=+\[\]{};:'",.<>?/\\|`~]).{8,}$/;
const SENHA_MSG = 'Senha fraca: mínimo 8 caracteres, com maiúscula, minúscula, número e símbolo (ex: !@#$)';


// ── Validação de upload de imagem ───────────────────────────
function _validarFotoBase64(base64) {
  if (!base64 || typeof base64 !== 'string') return 'Imagem obrigatória.';
  // Remove prefixo data:image/...;base64,
  const dados = base64.replace(/^data:image\/\w+;base64,/, '');
  // Tamanho máximo 5MB
  const bytes = Buffer.from(dados, 'base64').length;
  if (bytes > 5 * 1024 * 1024) return 'Imagem muito grande. Máximo 5MB (atual: ' + (bytes/1024/1024).toFixed(1) + 'MB).';
  // Verifica MIME pelos magic bytes
  const buf = Buffer.from(dados.substring(0, 8), 'base64');
  const hex = buf.toString('hex').substring(0, 8);
  const isJpeg = hex.startsWith('ffd8ff');
  const isPng  = hex.startsWith('89504e47');
  const isWebp = dados.substring(0, 4) === 'UklG'; // RIFF header em base64
  if (!isJpeg && !isPng && !isWebp) return 'Tipo inválido. Envie JPEG, PNG ou WebP.';
  return null;
}

// ── Log de auditoria ────────────────────────────────────────
async function _audit(supabase, acao, ip, detalhes = {}) {
  try {
    await supabase.from('auditoria').insert({ acao, ip, detalhes, criado_em: new Date().toISOString() });
  } catch(e) {}
}

module.exports = async function handler(req, res) {
const ORIGEM_PERMITIDA = process.env.FRONTEND_URL || 'https://biblioteca-backend-v2-0.vercel.app';
const origem = req.headers.origin;
if (origem === ORIGEM_PERMITIDA) {
  res.setHeader('Access-Control-Allow-Origin', origem);
} else {
  res.setHeader('Access-Control-Allow-Origin', ORIGEM_PERMITIDA);
}
res.setHeader('Vary', 'Origin');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  res.setHeader('Permissions-Policy', 'camera=(self), microphone=(), geolocation=()');
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const acao = req.query.acao;

 // ── ROTAS PUBLICAS (GET ou POST) ─────────────────────────────────────────

  // Verificar primeiro acesso — público (totem/app)
  if (acao === 'verificar-primeiro-acesso') {

    // Rate limit: máximo 20 verificações por minuto por IP
    const rl = checar(`verificar-cpf:${getIp(req)}`, {
      max: 20,
      janela: 60_000,
      bloqueio: 60_000
    });

    if (!rl.permitido) {
      return res.status(429).json({
        erro: 'Muitas requisições. Aguarde um momento.'
      });
    }

    // Aceita CPF via body (POST) ou query string (GET legado)
    const cpfLimpo = (req.body && req.body.cpf ? req.body.cpf : req.query.cpf || '').replace(/\D/g, '');
    if (!cpfLimpo || cpfLimpo.length !== 11) return res.status(400).json({ erro: 'CPF invalido.' });

    const { data } = await supabase
      .from('usuarios')
      .select('id, nome, cpf, foto_url, senha_hash, termo_aceito_em, termo_versao_aceita, ativo')
      .eq('cpf', cpfLimpo)
      .maybeSingle();

    if (!data) return res.status(404).json({ encontrado: false });

    if (!data.ativo) {
      return res.status(403).json({
        erro: 'Conta suspensa. Entre em contato com a recepção.'
      });
    }

    // Foto ausente NÃO bloqueia — só senha e termo são obrigatórios
    const precisaCadastro = !data.senha_hash || !data.termo_aceito_em;

    return res.status(200).json({
      encontrado: true,
      id: data.id,
      nome: data.nome,
      cpf: data.cpf,
      foto_url: data.foto_url || null,
      primeiro_acesso: precisaCadastro,
      sem_senha: !data.senha_hash,
      sem_termo: !data.termo_aceito_em,
      sem_foto: !data.foto_url,
      termo_versao_aceita: data.termo_versao_aceita || null
    });
  }

  // Buscar por CPF exato — público (totem)
    if (acao === 'buscar-cpf') {
      const rl2 = checar('buscar-cpf:' + getIp(req), { max: 30, janela: 60000, bloqueio: 60000 });
      if (!rl2.permitido) return res.status(429).json({ erro: 'Muitas requisicoes. Aguarde.' });
      const cpfLimpo = (req.body && req.body.cpf ? req.body.cpf : req.query.cpf || '').replace(/\D/g, '');
      if (!cpfLimpo || cpfLimpo.length !== 11) return res.status(400).json({ erro: 'CPF invalido.' });
      const { data, error } = await supabase
        .from('usuarios')
        .select('id, nome, cpf, email, tipo, ativo, foto_url')
        .eq('cpf', cpfLimpo)
        .maybeSingle();
      if (error) return res.status(500).json({ erro: 'Erro interno' });
      if (!data) return res.status(404).json({ erro: 'Nao encontrado.', usuario: null });
      return res.status(200).json({ usuario: data });
    }

  if (req.method === 'GET') {
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
      .select('id, nome, cpf, email, telefone, foto_url, tipo, ativo, created_at, exclusao_solicitada_em, exclusao_motivo')
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
    if (foto_url && foto_url.startsWith('data:')) {
      const erroFotoCad = _validarFotoBase64(foto_url);
      if (erroFotoCad) return res.status(400).json({ erro: erroFotoCad });
    }
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
    await _audit(supabase, 'termo_assinado', ip || 'desconhecido', { usuario_id, versao: versao || '1.0' });
    return res.status(200).json({ mensagem: 'Termo assinado com sucesso' });
  }

  // Salvar foto (público — vincula por usuario_id + cpf)
  if (acao === 'salvar-foto') {
    const { usuario_id, cpf, foto_base64 } = req.body || {};
    if (!usuario_id || !cpf || !foto_base64) return res.status(400).json({ erro: 'Dados obrigatórios' });
    const erroFoto = _validarFotoBase64(foto_base64);
    if (erroFoto) return res.status(400).json({ erro: erroFoto });
    const cpfLimpo = cpf.replace(/\D/g, '');
    const { data: u } = await supabase
      .from('usuarios').select('id').eq('id', usuario_id).eq('cpf', cpfLimpo).maybeSingle();
    if (!u) return res.status(404).json({ erro: 'Usuário não encontrado' });
  const { data: fotoAtualizada, error } = await supabase
      .from('usuarios').update({ foto_url: foto_base64 }).eq('id', usuario_id).select();
    if (error) return res.status(500).json({ erro: error.message });
    if (!fotoAtualizada || fotoAtualizada.length === 0) {
      console.error('[salvar-foto] Update não afetou nenhuma linha (possível bloqueio RLS). usuario_id=', usuario_id);
      return res.status(500).json({ erro: 'Não foi possível salvar a foto. Tente novamente ou entre em contato com o suporte.' });
    }
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
    const _ip3 = (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.socket?.remoteAddress || 'desconhecido';
    await _audit(supabase, 'senha_definida_primeiro_acesso', _ip3, { usuario_id });
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
    const _ip1 = (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.socket?.remoteAddress || 'desconhecido';
    await _audit(supabase, 'redefinir_senha', _ip1, { usuario_id, por: auth.tipo });
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
    const _ip2 = (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.socket?.remoteAddress || 'desconhecido';
    await _audit(supabase, ativo ? 'usuario_ativado' : 'usuario_bloqueado', _ip2, { usuario_id, por: auth.tipo });
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

  // ── LGPD: Solicitar exclusão de conta ─────────────────────────────────────
  // POST /api/usuarios?acao=solicitar-exclusao
  // Autenticação dupla:
  //   1. JWT do app verificado (payload tem id + cpf do próprio usuário)
  //   2. Par id + cpf confirmado no Supabase
  // Não usa autenticado() pois ele rejeita tipo != recepcao/admin.
  if (acao === 'solicitar-exclusao') {
    // ── Camada 1: JWT do app ──────────────────────────────────
    const authHeader = req.headers['authorization'] || '';
    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;

    let jwtPayload = null;
    if (token) {
      try {
        jwtPayload = require('jsonwebtoken').verify(token, process.env.JWT_SECRET);
      } catch (e) {
        return res.status(401).json({ erro: 'Token inválido ou expirado. Faça login novamente.' });
      }
    }

    const { usuario_id, cpf, motivo } = req.body || {};

    if (!usuario_id || !cpf) {
      return res.status(400).json({ erro: 'usuario_id e cpf obrigatórios' });
    }

    // Se JWT presente: id e cpf do token devem bater com o body (impede usar token de A para excluir B)
    if (jwtPayload) {
      if (jwtPayload.id !== usuario_id || jwtPayload.cpf !== cpf.replace(/\D/g, '')) {
        return res.status(403).json({ erro: 'Token não corresponde ao usuário informado' });
      }
    }

    const cpfLimpo = cpf.replace(/\D/g, '');

    // ── Camada 2: confirma no banco ───────────────────────────
    const { data: u } = await supabase
      .from('usuarios')
      .select('id, nome, exclusao_solicitada_em')
      .eq('id', usuario_id)
      .eq('cpf', cpfLimpo)
      .maybeSingle();

    if (!u) return res.status(404).json({ erro: 'Usuário não encontrado' });

    // Idempotente: já solicitou antes?
    if (u.exclusao_solicitada_em) {
      return res.status(200).json({
        mensagem:      'Solicitação já registrada anteriormente',
        solicitada_em: u.exclusao_solicitada_em
      });
    }

    const agora = new Date().toISOString();

    const { error } = await supabase
      .from('usuarios')
      .update({
        exclusao_solicitada_em: agora,
        exclusao_motivo:        motivo || 'Não informado',
        ativo:                  false,   // bloqueia acesso imediatamente
        updated_at:             agora
      })
      .eq('id', usuario_id);

    if (error) return res.status(500).json({ erro: 'Erro ao registrar solicitação' });

    // Auditoria — falha silenciosa se tabela ainda não existir
    await supabase.from('logs_lgpd').insert({
      tipo:       'exclusao_solicitada',
      usuario_id: usuario_id,
      detalhes:   motivo || 'Não informado',
      criado_em:  agora
    }).catch(() => {});

    await _audit(supabase, 'exclusao_solicitada', agora, { usuario_id });
    return res.status(200).json({
      mensagem:      'Solicitação de exclusão registrada. Seus dados serão eliminados em até 30 dias.',
      solicitada_em: agora
    });
  }

  // ── LGPD: Cancelar solicitação de exclusão (auth admin) ───────────────────
  // POST /api/usuarios?acao=cancelar-exclusao
  // Admin pode cancelar uma solicitação (ex.: usuário mudou de ideia presencialmente)
  if (acao === 'cancelar-exclusao') {
    const auth = autenticado(req, res);
    if (!auth.ok) return;
    if (auth.tipo !== 'admin') return res.status(403).json({ erro: 'Apenas admin' });

    const { usuario_id } = req.body || {};
    if (!usuario_id) return res.status(400).json({ erro: 'usuario_id obrigatório' });

    const { data, error } = await supabase
      .from('usuarios')
      .update({
        exclusao_solicitada_em: null,
        exclusao_motivo:        null,
        ativo:                  true,
        updated_at:             new Date().toISOString()
      })
      .eq('id', usuario_id)
      .select('id, nome')
      .single();

    if (error || !data) return res.status(404).json({ erro: 'Usuário não encontrado' });

    await supabase.from('logs_lgpd').insert({
      tipo:       'exclusao_cancelada',
      usuario_id: usuario_id,
      detalhes:   `Cancelada por admin: ${auth.usuario_id || 'sistema'}`,
      criado_em:  new Date().toISOString()
    }).catch(() => {});

    return res.status(200).json({
      mensagem: `Solicitação de exclusão de ${data.nome} cancelada`,
      usuario:  data
    });
  }

  // ── LGPD: Executar exclusão definitiva (auth admin) ───────────────────────
  // POST /api/usuarios?acao=executar-exclusao
  // Apaga todos os dados pessoais. Mantém só um registro anonimizado para auditoria.
  if (acao === 'executar-exclusao') {
    const auth = autenticado(req, res);
    if (!auth.ok) return;
    if (auth.tipo !== 'admin') return res.status(403).json({ erro: 'Apenas admin' });

    const { usuario_id } = req.body || {};
    if (!usuario_id) return res.status(400).json({ erro: 'usuario_id obrigatório' });

    const { data: u } = await supabase
      .from('usuarios')
      .select('id, nome, cpf, exclusao_solicitada_em')
      .eq('id', usuario_id)
      .maybeSingle();

    if (!u) return res.status(404).json({ erro: 'Usuário não encontrado' });
    if (!u.exclusao_solicitada_em) {
      return res.status(400).json({ erro: 'Usuário não solicitou exclusão' });
    }

    // Verifica carência de 2 dias (proteção contra exclusão acidental)
    const diasDesde = (Date.now() - new Date(u.exclusao_solicitada_em).getTime()) / 86400000;
    if (diasDesde < 2) {
      return res.status(400).json({ erro: `Aguarde o prazo de carência (${Math.ceil(2 - diasDesde)}d restante)` });
    }

    // Anonimiza: limpa dados pessoais, mantém registro para integridade referencial
    const anonimo = {
      nome:                   '[EXCLUÍDO]',
      cpf:                    `EXC_${Date.now()}`,    // impede re-cadastro com mesmo CPF UUID
      email:                  null,
      telefone:               null,
      foto_url:               null,
      assinatura_svg:         null,
      documento_oficial:      null,
      observacoes:            null,
      senha_hash:             null,
      termo_ip:               null,
      termo_aceito_em:        null,
      ativo:                  false,
      exclusao_executada_em:  new Date().toISOString(),
      updated_at:             new Date().toISOString()
    };

    const { error } = await supabase
      .from('usuarios')
      .update(anonimo)
      .eq('id', usuario_id);

    if (error) return res.status(500).json({ erro: 'Erro ao executar exclusão' });

    await supabase.from('logs_lgpd').insert({
      tipo:       'exclusao_executada',
      usuario_id: usuario_id,
      detalhes:   `CPF original: ${u.cpf} | Executada por: ${auth.usuario_id || 'admin'}`,
      criado_em:  new Date().toISOString()
    }).catch(() => {});

    await _audit(supabase, 'exclusao_executada', new Date().toISOString(), { usuario_id, por: auth.tipo });
    return res.status(200).json({ mensagem: 'Dados pessoais eliminados conforme LGPD art. 18, VI' });
  }

  return res.status(400).json({ erro: 'acao inválida' });
};
module.exports.config = { api: { bodyParser: { sizeLimit: '5mb' } } };
