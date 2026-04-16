// api/acessos.js
// GET  /api/acessos                   → listar acessos do dia (auth)
// POST /api/acessos?acao=registrar    → registrar entrada (auth)
// POST /api/acessos?acao=encerrar     → encerrar acesso individual (auth)
// POST /api/acessos?acao=encerrar-dia → encerrar todos os acessos do dia (cron/admin)

const supabase = require('../lib/supabase');
const { autenticado, verificarToken, soAdmin } = require('../middleware/auth');

const CRON_SECRET = process.env.CRON_SECRET;

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();

  // ── GET — listar acessos ───────────────────────────────────────────────────
  if (req.method === 'GET') {
    const auth = autenticado(req, res);
    if (!auth.ok) return;

    const { data: dataFiltro, status } = req.query;

    const dia = dataFiltro ? new Date(dataFiltro) : new Date();
    dia.setHours(0, 0, 0, 0);
    const fimDia = new Date(dia);
    fimDia.setHours(23, 59, 59, 999);

    let query = supabase
      .from('acessos')
      .select(`
        id, entrada_em, saida_em, status, registrado_por,
        usuarios ( id, nome, cpf, foto_url ),
        pagamentos ( id, tipo, valor, status )
      `)
      .gte('entrada_em', dia.toISOString())
      .lte('entrada_em', fimDia.toISOString())
      .order('entrada_em', { ascending: false });

    if (status) query = query.eq('status', status);

    const { data, error } = await query;
    if (error) {
      console.error('Erro ao listar acessos:', error);
      return res.status(500).json({ erro: 'Erro interno' });
    }

    return res.status(200).json({ acessos: data, total: data.length, data: dia.toISOString().split('T')[0] });
  }

  // ── POST ───────────────────────────────────────────────────────────────────
  if (req.method !== 'POST') return res.status(405).json({ erro: 'Método não permitido' });

  const acao = req.query.acao;

  // POST /api/acessos?acao=registrar
  if (acao === 'registrar' || !acao) {
    const auth = autenticado(req, res);
    if (!auth.ok) return;

    const { usuario_id, pagamento_id, registrado_por = 'recepcao' } = req.body || {};
    if (!usuario_id) return res.status(400).json({ erro: 'usuario_id é obrigatório' });

    const { data: usuario } = await supabase
      .from('usuarios').select('id, nome, ativo').eq('id', usuario_id).maybeSingle();

    if (!usuario)        return res.status(404).json({ erro: 'Usuário não encontrado' });
    if (!usuario.ativo)  return res.status(403).json({ erro: 'Usuário inativo' });

    const inicioDia = new Date();
    inicioDia.setHours(0, 0, 0, 0);

    const { data: acessoAtivo } = await supabase
      .from('acessos').select('id')
      .eq('usuario_id', usuario_id).eq('status', 'ativo')
      .gte('entrada_em', inicioDia.toISOString()).maybeSingle();

    if (acessoAtivo) return res.status(409).json({ erro: 'Usuário já possui acesso ativo hoje' });

    const { data: config } = await supabase
      .from('configuracoes').select('valor').eq('chave', 'total_vagas').single();
    const totalVagas = parseInt(config?.valor || '30', 10);

    const { count: ocupadas } = await supabase
      .from('acessos').select('*', { count: 'exact', head: true }).eq('status', 'ativo');

    if ((ocupadas || 0) >= totalVagas) return res.status(409).json({ erro: 'Sala lotada. Não há vagas disponíveis.' });

    const { data: acesso, error } = await supabase
      .from('acessos')
      .insert({ usuario_id, pagamento_id, registrado_por, status: 'ativo' })
      .select().single();

    if (error) {
      console.error('Erro ao registrar acesso:', error);
      return res.status(500).json({ erro: 'Erro interno ao registrar acesso' });
    }

    return res.status(201).json({
      mensagem: `Entrada registrada para ${usuario.nome}`,
      acesso,
      vagas_restantes: totalVagas - (ocupadas || 0) - 1
    });
  }

  // POST /api/acessos?acao=encerrar
  if (acao === 'encerrar') {
    const auth = autenticado(req, res);
    if (!auth.ok) return;

    const { acesso_id } = req.body || {};
    if (!acesso_id) return res.status(400).json({ erro: 'acesso_id é obrigatório' });

    const { data, error } = await supabase
      .from('acessos')
      .update({ status: 'encerrado', saida_em: new Date().toISOString() })
      .eq('id', acesso_id).eq('status', 'ativo')
      .select().single();

    if (error || !data) return res.status(404).json({ erro: 'Acesso não encontrado ou já encerrado' });

    return res.status(200).json({ mensagem: 'Saída registrada', acesso: data });
  }

  // POST /api/acessos?acao=encerrar-dia  (cron às 19:45 ou admin)
  if (acao === 'encerrar-dia') {
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

    return res.status(200).json({ mensagem: 'Encerramento realizado', acessos_encerrados: totalEncerrado, timestamp: agora });
  }

  return res.status(400).json({ erro: 'acao inválida. Use: registrar, encerrar ou encerrar-dia' });
};
