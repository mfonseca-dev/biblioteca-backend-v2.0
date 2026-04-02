// api/usuarios/listar.js
// GET /api/usuarios/listar?busca=nome_ou_cpf&tipo=aluno&ativo=true
// Requer: Authorization: Bearer <token>

const supabase  = require('../../lib/supabase');
const { autenticado } = require('../../middleware/auth');

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ erro: 'Método não permitido' });

  const auth = autenticado(req, res);
  if (!auth.ok) return;

  const { busca, tipo, ativo = 'true' } = req.query;

  let query = supabase
    .from('usuarios')
    .select('id, nome, cpf, email, telefone, foto_url, tipo, ativo, created_at')
    .order('nome');

  if (ativo !== 'todos') {
    query = query.eq('ativo', ativo === 'true');
  }

  if (tipo) {
    query = query.eq('tipo', tipo);
  }

  if (busca) {
    const cpfBusca = busca.replace(/\D/g, '');
    if (cpfBusca.length >= 3) {
      // Busca por CPF parcial ou nome
      query = query.or(`cpf.ilike.%${cpfBusca}%,nome.ilike.%${busca}%`);
    } else {
      query = query.ilike('nome', `%${busca}%`);
    }
  }

  const { data, error } = await query.limit(100);

  if (error) {
    console.error('Erro ao listar usuários:', error);
    return res.status(500).json({ erro: 'Erro interno' });
  }

  return res.status(200).json({ usuarios: data, total: data.length });
};
