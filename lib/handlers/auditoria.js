// lib/handlers/auditoria.js
// GET /api/auditoria?acao=listar&filtro_acao=X&data=YYYY-MM-DD -> lista logs (auth admin)

const supabase = require('../supabase');
const { soAdmin } = require('../../middleware/auth');

module.exports = async function handler(req, res) {
  const _ORIGENS_PERMITIDAS = (process.env.FRONTEND_URL || 'https://biblioteca-backend-v2-0.vercel.app').split(',').map(o => o.trim());
  const _origem = req.headers.origin || '';
  res.setHeader('Access-Control-Allow-Origin', _ORIGENS_PERMITIDAS.includes(_origem) ? _origem : _ORIGENS_PERMITIDAS[0]);
  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  res.setHeader('Permissions-Policy', 'camera=(self), microphone=(), geolocation=()');
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ erro: 'Metodo nao permitido' });

  const auth = soAdmin(req, res);
  if (!auth.ok) return;

  const acao = req.query.acao;

  if (acao === 'listar') {
    const filtro_acao = req.query.filtro_acao;
    const data = req.query.data;
    const limite = req.query.limite || '100';

    let query = supabase
      .from('auditoria')
      .select('id, usuario_id, acao, ip, detalhes, criado_em')
      .order('criado_em', { ascending: false })
      .limit(Math.min(parseInt(limite, 10) || 100, 500));

    if (filtro_acao) {
      query = query.eq('acao', filtro_acao);
    }

    if (data) {
      const inicio = new Date(data + 'T00:00:00.000Z').toISOString();
      const fim    = new Date(data + 'T23:59:59.999Z').toISOString();
      query = query.gte('criado_em', inicio).lte('criado_em', fim);
    }

    const resultado = await query;
    const logs = resultado.data;
    const error = resultado.error;

    if (error) {
      console.error('[auditoria] erro ao listar:', error.message);
      return res.status(500).json({ erro: 'Erro ao buscar logs de auditoria' });
    }

    return res.status(200).json({ logs: logs || [], total: (logs || []).length });
  }

  return res.status(400).json({ erro: 'acao invalida. Use: listar' });
};

module.exports.config = { api: { bodyParser: { sizeLimit: '5mb' } } };
