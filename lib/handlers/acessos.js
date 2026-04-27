// api/acessos.js
//
// ROTAS:
//   GET  /api/acessos?acao=listar             → lista acessos por data/status (auth)
//   GET  /api/acessos?acao=historico-usuario  → histórico pessoal do usuário (público — app)
//   GET  /api/acessos?acao=vagas              → vagas livres/ocupadas (público)
//   POST /api/acessos?acao=registrar          → registra entrada manual (auth recepção)
//   POST /api/acessos?acao=encerrar           → registra saída (auth recepção)
//   POST /api/acessos?acao=reset-diario       → encerra todos os acessos ativos do dia (cron/admin)

const supabase = require('../lib/supabase');
const { autenticado } = require('../middleware/auth');

module.exports = async function handler(req, res) {

  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const acao = req.query.acao;

  // ─────────────────────────────────────────────────────────────
  // 📊 VAGAS — público (app, totem, qualquer tela)
  // ─────────────────────────────────────────────────────────────
  if (req.method === 'GET' && acao === 'vagas') {
    try {
      const { data: cfg } = await supabase
        .from('configuracoes')
        .select('valor')
        .eq('chave', 'total_vagas')
        .single();

      const total = parseInt(cfg?.valor || '30', 10);

      const { count: ocupadas } = await supabase
        .from('acessos')
        .select('*', { count: 'exact', head: true })
        .eq('status', 'ativo');

      const livres = Math.max(0, total - (ocupadas || 0));

      return res.status(200).json({
        total,
        ocupadas: ocupadas || 0,
        livres,
        lotado: livres === 0
      });
    } catch (e) {
      console.error('[vagas]', e);
      return res.status(500).json({ erro: 'Erro interno' });
    }
  }

  // ─────────────────────────────────────────────────────────────
  // 📋 HISTÓRICO PESSOAL — público (app do usuário)
  //    Retorna apenas os acessos do próprio usuário.
  //    Não exige token — o usuario_id é passado via query string.
  //    Os dados retornados são apenas do próprio usuário, sem exposição
  //    de dados de terceiros.
  // ─────────────────────────────────────────────────────────────
  if (req.method === 'GET' && acao === 'historico-usuario') {
    try {
      const { usuario_id } = req.query;
      if (!usuario_id) return res.status(400).json({ erro: 'usuario_id obrigatório' });

      // Busca até 60 acessos mais recentes do usuário
      const { data, error } = await supabase
        .from('acessos')
        .select(`
          id, status, entrada_em, saida_em, registrado_por,
          pagamentos ( id, tipo, valor, status, confirmado_em )
        `)
        .eq('usuario_id', usuario_id)
        .order('entrada_em', { ascending: false })
        .limit(60);

      if (error) {
        console.error('[historico-usuario]', error);
        return res.status(500).json({ erro: 'Erro interno' });
      }

      // Estatísticas agregadas
      const acessos = data || [];
      const inicioMes = new Date();
      inicioMes.setDate(1); inicioMes.setHours(0, 0, 0, 0);

      const doMes = acessos.filter(a => new Date(a.entrada_em) >= inicioMes);

      let horasTotal = 0;
      acessos.forEach(a => {
        if (a.saida_em) {
          horasTotal += (new Date(a.saida_em) - new Date(a.entrada_em)) / 3600000;
        }
      });

      return res.status(200).json({
        acessos,
        stats: {
          total:       acessos.length,
          mes:         doMes.length,
          horas_total: Math.round(horasTotal)
        }
      });
    } catch (e) {
      console.error('[historico-usuario]', e);
      return res.status(500).json({ erro: 'Erro interno' });
    }
  }

  // ─────────────────────────────────────────────────────────────
  // 📋 LISTAR ACESSOS — auth (recepção/admin)
  // ─────────────────────────────────────────────────────────────
  if (req.method === 'GET' && acao === 'listar') {
    const auth = autenticado(req, res);
    if (!auth.ok) return;

    try {
      const { data: dataFiltro, status } = req.query;

      let query = supabase
        .from('acessos')
        .select(`
          id, status, entrada_em, saida_em, registrado_por,
          usuarios ( id, nome, cpf, foto_url ),
          pagamentos ( id, tipo, valor, status )
        `)
        .order('entrada_em', { ascending: false })
        .limit(200);

      if (dataFiltro) {
        const inicio = new Date(dataFiltro);
        inicio.setHours(0, 0, 0, 0);
        const fim = new Date(dataFiltro);
        fim.setHours(23, 59, 59, 999);
        query = query
          .gte('entrada_em', inicio.toISOString())
          .lte('entrada_em', fim.toISOString());
      }

      if (status) query = query.eq('status', status);

      const { data, error } = await query;
      if (error) return res.status(500).json({ erro: 'Erro interno' });

      return res.status(200).json({ acessos: data || [], total: data?.length || 0 });
    } catch (e) {
      console.error('[listar]', e);
      return res.status(500).json({ erro: 'Erro interno' });
    }
  }

  // ─────────────────────────────────────────────────────────────
  // ✅ REGISTRAR ENTRADA MANUAL — auth recepção
  // ─────────────────────────────────────────────────────────────
  if (req.method === 'POST' && acao === 'registrar') {
    const auth = autenticado(req, res);
    if (!auth.ok) return;

    try {
      const { usuario_id, pagamento_id } = req.body || {};
      if (!usuario_id) return res.status(400).json({ erro: 'usuario_id obrigatório' });

      // Verifica se já tem acesso ativo hoje
      const hoje = new Date(); hoje.setHours(0, 0, 0, 0);
      const { data: jaExiste } = await supabase
        .from('acessos')
        .select('id')
        .eq('usuario_id', usuario_id)
        .eq('status', 'ativo')
        .gte('entrada_em', hoje.toISOString())
        .maybeSingle();

      if (jaExiste) {
        return res.status(409).json({ erro: 'Usuário já possui acesso ativo hoje' });
      }

      // Verifica vagas
      const { data: cfg } = await supabase
        .from('configuracoes').select('valor').eq('chave', 'total_vagas').single();
      const total = parseInt(cfg?.valor || '30', 10);
      const { count: ocupadas } = await supabase
        .from('acessos').select('*', { count: 'exact', head: true }).eq('status', 'ativo');

      if ((ocupadas || 0) >= total) {
        return res.status(409).json({ erro: 'Sala lotada — não há vagas disponíveis' });
      }

      const { data, error } = await supabase
        .from('acessos')
        .insert({
          usuario_id,
          pagamento_id: pagamento_id || null,
          registrado_por: 'recepcao',
          status: 'ativo'
        })
        .select()
        .single();

      if (error) return res.status(500).json({ erro: 'Erro ao registrar acesso' });

      return res.status(201).json({ mensagem: 'Entrada registrada!', acesso: data });
    } catch (e) {
      console.error('[registrar]', e);
      return res.status(500).json({ erro: 'Erro interno' });
    }
  }

  // ─────────────────────────────────────────────────────────────
  // 🚪 ENCERRAR ACESSO (saída) — auth recepção
  // ─────────────────────────────────────────────────────────────
  if (req.method === 'POST' && acao === 'encerrar') {
    const auth = autenticado(req, res);
    if (!auth.ok) return;

    try {
      const { acesso_id } = req.body || {};
      if (!acesso_id) return res.status(400).json({ erro: 'acesso_id obrigatório' });

      const { data, error } = await supabase
        .from('acessos')
        .update({
          status: 'encerrado',
          saida_em: new Date().toISOString()
        })
        .eq('id', acesso_id)
        .select()
        .single();

      if (error || !data) return res.status(404).json({ erro: 'Acesso não encontrado' });

      return res.status(200).json({ mensagem: 'Saída registrada!', acesso: data });
    } catch (e) {
      console.error('[encerrar]', e);
      return res.status(500).json({ erro: 'Erro interno' });
    }
  }

  // ─────────────────────────────────────────────────────────────
  // 🔄 RESET DIÁRIO — encerra todos os acessos ativos ao final do dia
  //
  //    Este endpoint deve ser chamado automaticamente às 19h45
  //    via Vercel Cron Job (vercel.json) ou Supabase pg_cron.
  //
  //    O que faz:
  //      1. Busca todos os acessos com status 'ativo'
  //      2. Marca todos como 'encerrado' com saida_em = 19:45 do dia
  //      3. Zera as vagas automaticamente (pois ocupadas = count de 'ativo')
  //
  //    Configuração no vercel.json (✅ JÁ CORRETO):
  //    {
  //      "crons": [{
  //        "path": "/api/acessos?acao=reset-diario&token=SEU_TOKEN_SECRETO",
  //        "schedule": "45 22 * * *"
  //      }]
  //    }
  //    (22h45 UTC = 19h45 Brasília — UTC-3)
  //
  //    Também pode ser chamado manualmente pelo admin no painel.
  // ─────────────────────────────────────────────────────────────
  if (req.method === 'POST' && acao === 'reset-diario') {

    // Aceita token de cron OU autenticação de admin
    const tokenCron = req.query.token || req.body?.token;

    // Token lido da variável de ambiente CRON_TOKEN (nunca hardcoded)
    const tokenValido = process.env.CRON_TOKEN && tokenCron === process.env.CRON_TOKEN;

    if (!tokenValido) {
      // Tenta autenticação normal de admin
      const auth = autenticado(req, res);
      if (!auth.ok) return;
    }

    try {
      // Horário de encerramento: 19h45 do dia atual
      const agora = new Date();
      const encerramento = new Date(agora);
      encerramento.setHours(19, 45, 0, 0);
      // Se já passou das 19h45, usa o horário atual
      const saidaFinal = agora > encerramento ? agora : encerramento;

      // Busca todos os acessos ativos
      const { data: ativos, error: errBusca } = await supabase
        .from('acessos')
        .select('id, usuario_id, entrada_em')
        .eq('status', 'ativo');

      if (errBusca) return res.status(500).json({ erro: 'Erro ao buscar acessos ativos' });

      if (!ativos || ativos.length === 0) {
        return res.status(200).json({
          mensagem: 'Nenhum acesso ativo para encerrar',
          encerrados: 0
        });
      }

      // Encerra todos de uma vez
      const { error: errUpdate } = await supabase
        .from('acessos')
        .update({
          status: 'encerrado',
          saida_em: saidaFinal.toISOString()
        })
        .eq('status', 'ativo');

      if (errUpdate) return res.status(500).json({ erro: 'Erro ao encerrar acessos' });

      console.log(`[reset-diario] ${ativos.length} acessos encerrados em ${saidaFinal.toISOString()}`);

      return res.status(200).json({
        mensagem: `Reset diário concluído — ${ativos.length} acesso(s) encerrado(s)`,
        encerrados: ativos.length,
        horario_encerramento: saidaFinal.toISOString()
      });

    } catch (e) {
      console.error('[reset-diario]', e);
      return res.status(500).json({ erro: 'Erro interno no reset diário' });
    }
  }

  return res.status(405).json({ erro: 'Método ou ação não permitidos' });
};
