// api/auth.js
const jwt      = require('jsonwebtoken');
const bcrypt   = require('bcryptjs');
const supabase = require('../supabase');

const SECRET = process.env.JWT_SECRET;

const PERFIS = {
  recepcao: { hashEnv: 'SENHA_RECEPCAO_HASH', tipo: 'recepcao', expiresIn: '12h' },
  admin:    { hashEnv: 'SENHA_ADMIN_HASH',    tipo: 'admin',    expiresIn: '8h'  },
};

module.exports = async function handler(req, res) {

  // ✅ CORS CORRIGIDO (ESSENCIAL)
  res.setHeader('Access-Control-Allow-Origin', '*');
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

  // ── LOGIN STAFF (RECEPÇÃO / ADMIN) ─────────────────────────
  if (acao === 'login-staff' || !acao) {
    const { senha, tipo } = req.body || {};

    if (!senha || !tipo) {
      return res.status(400).json({ erro: 'Campos obrigatórios: senha, tipo' });
    }

    const perfil = PERFIS[tipo];
    if (!perfil) {
      return res.status(400).json({ erro: 'Tipo inválido. Use: recepcao ou admin' });
    }

    const hashArmazenado = process.env[perfil.hashEnv];
    if (!hashArmazenado) {
      return res.status(500).json({ erro: `Variável ${perfil.hashEnv} não configurada` });
    }

    const senhaCorreta = await bcrypt.compare(senha, hashArmazenado);
    if (!senhaCorreta) {
      return res.status(401).json({ erro: 'Senha incorreta' });
    }

    const payload = {
      tipo: perfil.tipo,
      iat: Math.floor(Date.now() / 1000)
    };

    const token = jwt.sign(payload, SECRET, {
      expiresIn: perfil.expiresIn
    });

    return res.status(200).json({
      token,
      tipo: perfil.tipo,
      mensagem: `Login ${perfil.tipo} realizado com sucesso`
    });
  }

  // ── LOGIN USUÁRIO (CPF + SENHA) ────────────────────────────
  if (acao === 'login-usuario') {
    const { cpf, senha } = req.body || {};

    if (!cpf || !senha) {
      return res.status(400).json({ erro: 'CPF e senha são obrigatórios' });
    }

    const cpfLimpo = cpf.replace(/\D/g, '');
    if (cpfLimpo.length !== 11) {
      return res.status(400).json({ erro: 'CPF inválido' });
    }

    const { data: usuario } = await supabase
      .from('usuarios')
      .select('id, nome, cpf, tipo, ativo, senha_hash, foto_url, termo_aceito_em')
      .eq('cpf', cpfLimpo)
      .maybeSingle();

    if (!usuario) {
      return res.status(401).json({ erro: 'CPF não cadastrado' });
    }

    if (!usuario.ativo) {
      return res.status(403).json({ erro: 'Conta suspensa. Entre em contato com a recepção.' });
    }

    if (!usuario.senha_hash) {
      return res.status(401).json({ erro: 'Senha não definida. Procure a recepção.' });
    }

    const senhaOk = await bcrypt.compare(senha, usuario.senha_hash);
    if (!senhaOk) {
      return res.status(401).json({ erro: 'Senha incorreta' });
    }

    const token = jwt.sign(
      {
        id: usuario.id,
        nome: usuario.nome,
        cpf: usuario.cpf,
        tipo: usuario.tipo
      },
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

  return res.status(400).json({
    erro: 'acao inválida. Use: login-staff ou login-usuario'
  });
};
