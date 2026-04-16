// api/vagas.js
// GET /api/vagas  — público (tela de entrada e totem)

const supabase = require('../lib/supabase');

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
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

  const { count, error } = await supabase
    .from('acessos').select('*', { count: 'exact', head: true }).eq('status', 'ativo');

  if (error) {
    console.error('Erro ao contar acessos:', error);
    return res.status(500).json({ erro: 'Erro interno' });
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
