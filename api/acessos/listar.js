// api/acessos/listar.js
// GET /api/acessos/listar?data=2024-01-15&status=ativo
// Requer: Authorization: Bearer <token>

const supabase = require('../../lib/supabase');
const { autenticado } = require('../../middleware/auth');

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ erro: 'Método não permitido' });

  const auth = autenticado(req, res);
  if (!auth.ok) return;

  const { data: dataFiltro, status } = req.query;

  // Data padrão: hoje
  const dia = dataFiltro ? new Date(dataFiltro) : new Date();
  dia.setHours(0, 0, 0, 0);
  const fimDia = new Date(dia);
  fimDia.setHours(23, 59, 59, 999);

  let query = supabase
    .from('acessos')
    .select(`
      id,
      entrada_em,
      saida_em,
      status,
      registrado_por,
      usuarios ( id, nome, cpf, foto_url ),
      pagamentos ( id, tipo, valor, status )
    `)
    .gte('entrada_em', dia.toISOString())
    .lte('entrada_em', fimDia.toISOString())
    .order('entrada_em', { ascending: false });

  if (status) {
    query = query.eq('status', status);
  }

  const { data, error } = await query;

  if (error) {
    console.error('Erro ao listar acessos:', error);
    return res.status(500).json({ erro: 'Erro interno' });
  }

  return res.status(200).json({
    acessos: data,
    total:   data.length,
    data:    dia.toISOString().split('T')[0]
  });
};
