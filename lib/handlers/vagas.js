// api/vagas.js
// GET /api/vagas  — público (tela de entrada e totem)

const supabase = require('../supabase');

// Calcula o início do dia (00:00) em horário de Brasília (UTC-3),
// independente do fuso horário do servidor (Vercel roda em UTC por padrão).
function inicioDoDiaBrasilia() {
  const agora = new Date();
  const brasiliaOffsetMs = -3 * 60 * 60 * 1000; // UTC-3
  const agoraBrasilia = new Date(agora.getTime() + brasiliaOffsetMs);
  const anoBr = agoraBrasilia.getUTCFullYear();
  const mesBr = agoraBrasilia.getUTCMonth();
  const diaBr = agoraBrasilia.getUTCDate();
  return new Date(Date.UTC(anoBr, mesBr, diaBr, 3, 0, 0, 0));
}

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

  const hojeInicio = inicioDoDiaBrasilia();
  const agora = new Date().toISOString();

  // Ocupadas = acessos 'ativo' de hoje + acessos 'encerrado' de hoje que
  // ainda estao dentro da janela de garantia de vaga (vaga_garantida_ate
  // no futuro). Duas contagens separadas e somadas (mais confiavel que
  // um .or() combinado com filtros aninhados e timestamps).
  const ativosResult = await supabase
    .from('acessos')
    .select('*', { count: 'exact', head: true })
    .eq('status', 'ativo')
    .gte('entrada_em', hojeInicio.toISOString());

  const garantidosResult = await supabase
    .from('acessos')
    .select('*', { count: 'exact', head: true })
    .eq('status', 'encerrado')
    .gte('entrada_em', hojeInicio.toISOString())
    .gt('vaga_garantida_ate', agora);

  if (ativosResult.error || garantidosResult.error) {
    const err = ativosResult.error || garantidosResult.error;
    console.error('Erro ao contar acessos:', JSON.stringify(err));
    return res.status(500).json({ erro: 'Erro interno', detalhe: err.message || JSON.stringify(err) });
  }

  const ocupadas = (ativosResult.count || 0) + (garantidosResult.count || 0);
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
