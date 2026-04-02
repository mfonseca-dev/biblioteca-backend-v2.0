// api/acessos/registrar.js
// POST /api/acessos/registrar
// Body: { usuario_id, pagamento_id?, registrado_por? }
// Requer: Authorization: Bearer <token>

const supabase = require('../../lib/supabase');
const { autenticado } = require('../../middleware/auth');

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ erro: 'Método não permitido' });

  const auth = autenticado(req, res);
  if (!auth.ok) return;

  const { usuario_id, pagamento_id, registrado_por = 'recepcao' } = req.body || {};

  if (!usuario_id) {
    return res.status(400).json({ erro: 'usuario_id é obrigatório' });
  }

  // 1. Verifica se usuário existe e está ativo
  const { data: usuario } = await supabase
    .from('usuarios')
    .select('id, nome, ativo')
    .eq('id', usuario_id)
    .maybeSingle();

  if (!usuario) return res.status(404).json({ erro: 'Usuário não encontrado' });
  if (!usuario.ativo) return res.status(403).json({ erro: 'Usuário inativo' });

  // 2. Verifica se já tem acesso ativo hoje
  const inicioDia = new Date();
  inicioDia.setHours(0, 0, 0, 0);

  const { data: acessoAtivo } = await supabase
    .from('acessos')
    .select('id')
    .eq('usuario_id', usuario_id)
    .eq('status', 'ativo')
    .gte('entrada_em', inicioDia.toISOString())
    .maybeSingle();

  if (acessoAtivo) {
    return res.status(409).json({ erro: 'Usuário já possui acesso ativo hoje' });
  }

  // 3. Verifica disponibilidade de vagas
  const { data: config } = await supabase
    .from('configuracoes')
    .select('valor')
    .eq('chave', 'total_vagas')
    .single();

  const totalVagas = parseInt(config?.valor || '30', 10);

  const { count: ocupadas } = await supabase
    .from('acessos')
    .select('*', { count: 'exact', head: true })
    .eq('status', 'ativo');

  if ((ocupadas || 0) >= totalVagas) {
    return res.status(409).json({ erro: 'Sala lotada. Não há vagas disponíveis.' });
  }

  // 4. Registra o acesso
  const { data: acesso, error } = await supabase
    .from('acessos')
    .insert({ usuario_id, pagamento_id, registrado_por, status: 'ativo' })
    .select()
    .single();

  if (error) {
    console.error('Erro ao registrar acesso:', error);
    return res.status(500).json({ erro: 'Erro interno ao registrar acesso' });
  }

  return res.status(201).json({
    mensagem: `Entrada registrada para ${usuario.nome}`,
    acesso,
    vagas_restantes: totalVagas - (ocupadas || 0) - 1
  });
};
