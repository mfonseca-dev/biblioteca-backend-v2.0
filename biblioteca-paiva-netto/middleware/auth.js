// middleware/auth.js
// Verifica o token JWT em rotas protegidas

const jwt = require('jsonwebtoken');

const SECRET = process.env.JWT_SECRET;

/**
 * Extrai e valida o Bearer token do header Authorization.
 * Retorna { ok: true, payload } ou { ok: false, status, message }
 */
function verificarToken(req) {
  const authHeader = req.headers['authorization'] || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;

  if (!token) {
    return { ok: false, status: 401, message: 'Token não fornecido' };
  }

  try {
    const payload = jwt.verify(token, SECRET);
    return { ok: true, payload };
  } catch (err) {
    return { ok: false, status: 401, message: 'Token inválido ou expirado' };
  }
}

/**
 * Middleware que exige perfil 'admin'
 */
function soAdmin(req, res, next) {
  const result = verificarToken(req);
  if (!result.ok) return res.status(result.status).json({ erro: result.message });
  if (result.payload.tipo !== 'admin') {
    return res.status(403).json({ erro: 'Acesso restrito a administradores' });
  }
  req.usuario = result.payload;
  next && next();
  return result;
}

/**
 * Middleware que exige autenticação (qualquer perfil)
 */
function autenticado(req, res, next) {
  const result = verificarToken(req);
  if (!result.ok) return res.status(result.status).json({ erro: result.message });
  req.usuario = result.payload;
  next && next();
  return result;
}

module.exports = { verificarToken, soAdmin, autenticado };
