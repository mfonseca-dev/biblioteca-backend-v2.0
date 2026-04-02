// api/acessos/encerrar-dia.js
// POST /api/acessos/encerrar-dia
// Chamado pelo cron job do Vercel às 19:45 todos os dias
// Também pode ser chamado manualmente pelo admin

const supabase = require('../../lib/supabase');
const { verificarToken } = require('../../middleware/auth');

// Chave secreta para o cron (diferente do JWT)
const CRON_SECRET = process.env.CRON_SECRET;

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ erro: 'Método não permitido' });

  // Aceita tanto o cron secret quanto um token JWT de admin
  const authHeader = req.headers['authorization'] || '';
  const isCron = authHeader === `Bearer ${CRON_SECRET}`;

  if (!isCron) {
    const result = verificarToken(req);
    if (!result.ok || result.payload.tipo !== 'admin') {
      return res.status(401).json({ erro: 'Não autorizado' });
    }
  }

  const agora = new Date().toISOString();

  const { data, error } = await supabase
    .from('acessos')
    .update({ status: 'encerrado', saida_em: agora })
    .eq('status', 'ativo')
    .select('id');

  if (error) {
    console.error('Erro ao encerrar acessos:', error);
    return res.status(500).json({ erro: 'Erro interno' });
  }

  const totalEncerrado = data?.length || 0;
  console.log(`[${agora}] Encerramento do dia: ${totalEncerrado} acessos encerrados`);

  return res.status(200).json({
    mensagem: `Encerramento realizado`,
    acessos_encerrados: totalEncerrado,
    timestamp: agora
  });
};
