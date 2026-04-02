// api/auth/login.js
// POST /api/auth/login
// Body: { senha, tipo }  —  tipo: 'recepcao' | 'admin'

const jwt     = require('jsonwebtoken');
const bcrypt  = require('bcryptjs');
const supabase = require('../../lib/supabase');

const SECRET = process.env.JWT_SECRET;

// Perfis disponíveis. As senhas ficam em variáveis de ambiente (hashed com bcrypt).
// Para gerar um hash: node -e "const b=require('bcryptjs');console.log(b.hashSync('suasenha',10))"
const PERFIS = {
  recepcao: {
    hashEnv: 'SENHA_RECEPCAO_HASH',
    tipo: 'recepcao',
    expiresIn: '12h'
  },
  admin: {
    hashEnv: 'SENHA_ADMIN_HASH',
    tipo: 'admin',
    expiresIn: '8h'
  }
};

module.exports = async function handler(req, res) {
  // CORS básico
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  if (req.method !== 'POST') {
    return res.status(405).json({ erro: 'Método não permitido' });
  }

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

  const payload = { tipo: perfil.tipo, iat: Math.floor(Date.now() / 1000) };
  const token = jwt.sign(payload, SECRET, { expiresIn: perfil.expiresIn });

  return res.status(200).json({
    token,
    tipo: perfil.tipo,
    mensagem: `Login ${perfil.tipo} realizado com sucesso`
  });
};
