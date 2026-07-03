// api/vagas.js
// GET /api/vagas  — público (tela de entrada e totem)

const supabase = require('../supabase');

module.exports = async function handler(req, res) {
  // ── CORS restrito ────────────────────────────────────────────
const _ORIGENS_PERMITIDAS = (process.env.FRONTEND_URL || 'https://biblioteca-backend-v2-0.vercel.app').split(',').map(o => o.trim());
const _origem = req.headers.origin || '';
res.setHeader('Access-Control-Allow-Origin', _ORIGENS_PERMITIDAS.includes(_origem) ? _origem : _ORIGENS_PERMITIDAS[0]);
res.setHeader('Vary', 'Origin');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  res.setHeader('Permissions-Policy', 'camera=(self), microphone=(), geolocation=()');
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ erro: 'Método não permitido' });

  const { data: config } = await supabase
    .from('configuracoes')
    .select('chave, valor')
    .in('chave', ['total_vagas', 'horario_abertura', 'horario_encerramento']);

  const cfg        = Object.fromEntries((config || []).map(c => [c.chave, c.valor]));
  const totalVagas = parseInt(cfg.total_vagas || '30', 10);

  // FIX: filtra apenas acessos de hoje para não acumular dias anteriores
  // e para que acessos especiais (que gravam entrada_em corretamente) sejam contados.
  const hojeInicio = new Date();
  hojeInicio.setHours(0, 0, 0, 0);

  const { count, error } = await supabase
    .from('acessos')
    .select('*', { count: 'exact', head: true })
    .eq('status', 'ativo')
    .gte('entrada_em', hojeInicio.toISOString()); // ← CORRIGIDO

  if (error) {
    console.error('Erro ao contar acessos:', JSON.stringify(error));
    return res.status(500).json({ erro: 'Erro interno', detalhe: error.message || JSON.stringify(error) });
  }

  const ocupadas = count || 0;
  const livres   = Math.max(0, totalVagas - ocupadas);

  return res.status(200).json({
    total: totalVagas,
    ocupadas,
    livres,
    lotado: livres === 0,
    horario_abertura:     cfg.horario_abertura     || '07:00',
    horario_encerramento: cfg.horario_encerramento || '19:45',
    timestamp: new Date().toISOString()
  });
};
module.exports.config = { api: { bodyParser: { sizeLimit: '5mb' } } };
