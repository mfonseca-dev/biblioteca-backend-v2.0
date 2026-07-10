// api/auth.js
const jwt      = require('jsonwebtoken');
const bcrypt   = require('bcryptjs');
const supabase = require('../supabase');
const { checar, resetar, getIp } = require('../rateLimit');
const SECRET = process.env.JWT_SECRET;

// ── Log de auditoria ────────────────────────────────────────
async function _audit(supabase, acao, ip, detalhes = {}) {
  try {
    await supabase.from('auditoria').insert({ acao, ip, detalhes, criado_em: new Date().toISOString() });
  } catch(e) { /* falha silenciosa */ }
}


const PERFIS = {
  recepcao: { hashEnv: 'SENHA_RECEPCAO_HASH', tipo: 'recepcao', expiresIn: '12h' },
  admin:    { hashEnv: 'SENHA_ADMIN_HASH',    tipo: 'admin',    expiresIn: '8h'  },
};

module.exports = async function handler(req, res) {

  // ✅ CORS CORRIGIDO (ESSENCIAL)
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
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader(
    'Access-Control-Allow-Headers',
    'Content-Type, Authorization, X-Requested-With, Accept'
  );

  // ✅ Responder preflight
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ erro: 'Método não permitido' });
  }

  // Falha segura: JWT_SECRET ausente impede qualquer login
  if (!SECRET) {
    console.error('[auth] JWT_SECRET não configurado');
    return res.status(500).json({ erro: 'Configuração do servidor incompleta' });
  }

  const acao = req.query.acao;

  // // ── LOGIN STAFF (RECEPÇÃO / ADMIN) ─────────────────────────
if (acao === 'login-staff' || !acao) {
  const ip    = getIp(req);
  const chave = `login-staff:${ip}`;

  const rl = checar(chave, { max: 5, janela: 60_000, bloqueio: 300_000 });
  if (!rl.permitido) {
    const seg = Math.ceil((rl.bloqueadoAte - Date.now()) / 1000);
    return res.status(429).json({
      erro: `Muitas tentativas. Aguarde ${seg} segundos.`
    });
  }

  const { senha, tipo } = req.body || {};
  if (!senha || !tipo) {
    return res.status(400).json({ erro: 'Campos obrigatórios: senha, tipo' });
  }

  const perfil = PERFIS[tipo];
  if (!perfil) {
    return res.status(400).json({ erro: 'Credenciais inválidas.' });
  }

  const hashArmazenado = process.env[perfil.hashEnv];
  if (!hashArmazenado) {
    return res.status(500).json({ erro: 'Configuração incompleta.' });
  }

  const senhaCorreta = await bcrypt.compare(senha, hashArmazenado);
  if (!senhaCorreta) {
    await _audit(supabase, 'login_staff_falha', ip, { tipo });
    return res.status(401).json({ erro: 'Credenciais inválidas.' });
  }

  // Sucesso — reseta contador
  resetar(chave);
  await _audit(supabase, 'login_staff', ip, { tipo: perfil.tipo });

  const token = jwt.sign(
    { tipo: perfil.tipo, iat: Math.floor(Date.now() / 1000) },
    SECRET,
    { expiresIn: perfil.expiresIn }
  );

  return res.status(200).json({
    token,
    tipo: perfil.tipo,
    mensagem: `Login ${perfil.tipo} realizado com sucesso`
  });
}

 // ── LOGIN USUÁRIO (CPF + SENHA) ────────────────────────────
if (acao === 'login-usuario') {
  const ip    = getIp(req);
  const chave = `login-usuario:${ip}`;

  const rl = checar(chave, { max: 5, janela: 60_000, bloqueio: 300_000 });
  if (!rl.permitido) {
    const seg = Math.ceil((rl.bloqueadoAte - Date.now()) / 1000);
    return res.status(429).json({
      erro: `Muitas tentativas. Aguarde ${seg} segundos.`
    });
  }

  const { cpf, senha } = req.body || {};
  if (!cpf || !senha) {
    return res.status(400).json({ erro: 'Dados obrigatórios não informados.' });
  }

  const cpfLimpo = cpf.replace(/\D/g, '');
  if (cpfLimpo.length !== 11) {
    return res.status(400).json({ erro: 'CPF inválido.' });
  }

  const { data: usuario } = await supabase
    .from('usuarios')
    .select('id, nome, cpf, tipo, ativo, senha_hash, foto_url, termo_aceito_em')
    .eq('cpf', cpfLimpo)
    .maybeSingle();

  // ⚠️ ANTI-ENUMERAÇÃO: mesma mensagem para CPF inexistente e senha errada
  const MSG_INVALIDO = 'Dados inválidos. Verifique e tente novamente.';

  if (!usuario) {
    await _audit(supabase, 'login_usuario_falha', ip, { cpf: cpfLimpo, motivo: 'cpf_nao_encontrado' });
    return res.status(401).json({ erro: MSG_INVALIDO });
  }

 if (!usuario.ativo) {
    // Conta suspensa pode revelar existência — aceitável pois o usuário precisa agir
    return res.status(403).json({ erro: 'Procure a recepção para regularizar sua situação.' });
}

  if (!usuario.senha_hash) {
    return res.status(401).json({ erro: MSG_INVALIDO });
  }

  const senhaOk = await bcrypt.compare(senha, usuario.senha_hash);
  if (!senhaOk) {
    await _audit(supabase, 'login_usuario_falha', ip, { cpf: cpfLimpo });
    return res.status(401).json({ erro: MSG_INVALIDO });
  }

  // Sucesso — reseta contador
  resetar(chave);
  await _audit(supabase, 'login_usuario', ip, { usuario_id: usuario.id });

  const token = jwt.sign(
    { id: usuario.id, nome: usuario.nome, cpf: usuario.cpf, tipo: usuario.tipo },
    SECRET,
    { expiresIn: '12h' }
  );

  return res.status(200).json({
    token,
    usuario: {
      id:              usuario.id,
      nome:            usuario.nome,
      cpf:             usuario.cpf,
      tipo:            usuario.tipo,
      foto_url:        usuario.foto_url,
      termo_aceito_em: usuario.termo_aceito_em || null
    }
  });
}
  return res.status(400).json({ erro: 'acao invalida. Use: login-staff ou login-usuario' });
};
module.exports.config = { api: { bodyParser: { sizeLimit: '5mb' } } };
