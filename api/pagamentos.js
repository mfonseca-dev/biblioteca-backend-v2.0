// api/pagamentos.js
// POST /api/pagamentos?acao=solicitar   → usuário solicita pagamento (cria registro pendente)
// GET  /api/pagamentos?acao=pendentes   → recepção vê lista de pendentes
// POST /api/pagamentos?acao=confirmar   → recepção confirma pagamento manual
// POST /api/pagamentos?acao=webhook     → webhook EfiBank/MercadoPago

const supabase = require('../lib/supabase');
const { autenticado } = require('../middleware/auth');

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const acao = req.query.acao;

  // ── Usuário solicita pagamento (cria pendente) ────────────────────────────
  if (req.method === 'POST' && acao === 'solicitar') {
    const { usuario_id } = req.body || {};
    if (!usuario_id) return res.status(400).json({ erro: 'usuario_id obrigatório' });

    // Verifica se já tem pagamento pendente ou acesso ativo hoje
    const hoje = new Date(); hoje.setHours(0,0,0,0);
    const { data: jaExiste } = await supabase
      .from('pagamentos')
      .select('id, status')
      .eq('usuario_id', usuario_id)
      .in('status', ['pendente','confirmado'])
      .gte('created_at', hoje.toISOString())
      .maybeSingle();

    if (jaExiste?.status === 'confirmado') {
      return res.status(409).json({ erro: 'Você já tem acesso confirmado hoje' });
    }
    if (jaExiste?.status === 'pendente') {
      return res.status(200).json({ mensagem: 'Pagamento já solicitado — aguarde confirmação da recepção', pagamento: jaExiste });
    }

    // Busca config de valor
    const { data: cfg } = await supabase
      .from('configuracoes').select('valor').eq('chave', 'valor_diaria').single();
    const valor = parseFloat((cfg?.valor || '10').replace(',', '.'));

    const { data: pag, error } = await supabase
      .from('pagamentos')
      .insert({ usuario_id, tipo: 'pix', valor, status: 'pendente' })
      .select().single();

    if (error) return res.status(500).json({ erro: 'Erro ao criar pagamento' });
    return res.status(201).json({ mensagem: 'Pagamento solicitado! Apresente o comprovante na recepção.', pagamento: pag });
  }

  // ── Recepção lista pagamentos pendentes ───────────────────────────────────
  if (req.method === 'GET' && acao === 'pendentes') {
    const auth = autenticado(req, res);
    if (!auth.ok) return;

    const hoje = new Date(); hoje.setHours(0,0,0,0);
    const { data, error } = await supabase
      .from('pagamentos')
      .select('id, valor, tipo, status, created_at, usuarios(id, nome, cpf)')
      .eq('status', 'pendente')
      .gte('created_at', hoje.toISOString())
      .order('created_at', { ascending: false });

    if (error) return res.status(500).json({ erro: 'Erro interno' });
    return res.status(200).json({ pendentes: data || [], total: data?.length || 0 });
  }

  // ── Recepção confirma pagamento manual ────────────────────────────────────
  if (req.method === 'POST' && acao === 'confirmar') {
    const auth = autenticado(req, res);
    if (!auth.ok) return;

    const { pagamento_id } = req.body || {};
    if (!pagamento_id) return res.status(400).json({ erro: 'pagamento_id obrigatório' });

    const { data: pag } = await supabase
      .from('pagamentos').select('id, usuario_id, status').eq('id', pagamento_id).maybeSingle();

    if (!pag) return res.status(404).json({ erro: 'Pagamento não encontrado' });
    if (pag.status === 'confirmado') return res.status(200).json({ mensagem: 'Já confirmado' });

    await supabase.from('pagamentos')
      .update({ status: 'confirmado', confirmado_em: new Date().toISOString() })
      .eq('id', pagamento_id);

    // Verifica vagas e registra acesso
    const { data: cfg } = await supabase.from('configuracoes').select('valor').eq('chave', 'total_vagas').single();
    const totalVagas = parseInt(cfg?.valor || '30', 10);
    const { count: ocupadas } = await supabase.from('acessos')
      .select('*', { count: 'exact', head: true }).eq('status', 'ativo');

    if ((ocupadas || 0) < totalVagas) {
      await supabase.from('acessos').insert({
        usuario_id: pag.usuario_id, pagamento_id: pag.id,
        registrado_por: 'recepcao', status: 'ativo'
      });
    }

    return res.status(200).json({ mensagem: 'Pagamento confirmado e entrada registrada!' });
  }

  // ── Webhook EfiBank / MercadoPago ─────────────────────────────────────────
  if (req.method === 'POST' && acao === 'webhook') {
    const body = req.body || {};
    console.log('[Webhook]', JSON.stringify(body));
    // TODO: implementar verificação de assinatura e confirmação automática
    return res.status(200).json({ ok: true });
  }

  return res.status(405).json({ erro: 'Método ou ação não permitidos' });
};
