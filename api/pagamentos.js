// api/pagamentos.js

const supabase = require('../lib/supabase');
const { autenticado } = require('../middleware/auth');

module.exports = async function handler(req, res) {

  // ═══════════════════════════════════════════════════════
  // 🔥 CORS GLOBAL (CORRIGIDO)
  // ═══════════════════════════════════════════════════════
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, Accept, X-Requested-With');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  const acao = req.query.acao;

  // ═══════════════════════════════════════════════════════
  // 🟡 SOLICITAR PAGAMENTO (USUÁRIO)
  // ═══════════════════════════════════════════════════════
  if (req.method === 'POST' && acao === 'solicitar') {
    try {
      const { usuario_id } = req.body || {};
      if (!usuario_id) {
        return res.status(400).json({ erro: 'usuario_id obrigatório' });
      }

      const hoje = new Date();
      hoje.setHours(0, 0, 0, 0);

      const { data: jaExiste } = await supabase
        .from('pagamentos')
        .select('id, status')
        .eq('usuario_id', usuario_id)
        .in('status', ['pendente', 'confirmado'])
        .gte('created_at', hoje.toISOString())
        .maybeSingle();

      if (jaExiste?.status === 'confirmado') {
        return res.status(409).json({ erro: 'Você já tem acesso confirmado hoje' });
      }

      if (jaExiste?.status === 'pendente') {
        return res.status(200).json({
          mensagem: 'Pagamento já solicitado — aguarde confirmação da recepção',
          pagamento: jaExiste
        });
      }

      const { data: cfg } = await supabase
        .from('configuracoes')
        .select('valor')
        .eq('chave', 'valor_diaria')
        .single();

      const valor = parseFloat((cfg?.valor || '10').replace(',', '.'));

      const { data: pag, error } = await supabase
        .from('pagamentos')
        .insert({
          usuario_id,
          tipo: 'pix',
          valor,
          status: 'pendente'
        })
        .select()
        .single();

      if (error) {
        console.error(error);
        return res.status(500).json({ erro: 'Erro ao criar pagamento' });
      }

      return res.status(201).json({
        mensagem: 'Pagamento solicitado! Apresente o comprovante na recepção.',
        pagamento: pag
      });

    } catch (e) {
      console.error(e);
      return res.status(500).json({ erro: 'Erro interno' });
    }
  }

  // ═══════════════════════════════════════════════════════
  // 🔵 LISTAR PENDENTES (RECEPÇÃO)
  // ═══════════════════════════════════════════════════════
  if (req.method === 'GET' && acao === 'pendentes') {
    const auth = autenticado(req, res);
    if (!auth.ok) return;

    try {
      const hoje = new Date();
      hoje.setHours(0, 0, 0, 0);

      const { data, error } = await supabase
        .from('pagamentos')
        .select('id, valor, tipo, status, created_at, usuarios(id, nome, cpf)')
        .eq('status', 'pendente')
        .gte('created_at', hoje.toISOString())
        .order('created_at', { ascending: false });

      if (error) {
        console.error(error);
        return res.status(500).json({ erro: 'Erro interno' });
      }

      return res.status(200).json({
        pendentes: data || [],
        total: data?.length || 0
      });

    } catch (e) {
      console.error(e);
      return res.status(500).json({ erro: 'Erro interno' });
    }
  }

  // ═══════════════════════════════════════════════════════
  // 🟢 CONFIRMAR PAGAMENTO (RECEPÇÃO)
  // ═══════════════════════════════════════════════════════
  if (req.method === 'POST' && acao === 'confirmar') {
    const auth = autenticado(req, res);
    if (!auth.ok) return;

    try {
      const { pagamento_id } = req.body || {};
      if (!pagamento_id) {
        return res.status(400).json({ erro: 'pagamento_id obrigatório' });
      }

      const { data: pag } = await supabase
        .from('pagamentos')
        .select('id, usuario_id, status')
        .eq('id', pagamento_id)
        .maybeSingle();

      if (!pag) {
        return res.status(404).json({ erro: 'Pagamento não encontrado' });
      }

      if (pag.status === 'confirmado') {
        return res.status(200).json({ mensagem: 'Já confirmado' });
      }

      await supabase
        .from('pagamentos')
        .update({
          status: 'confirmado',
          confirmado_em: new Date().toISOString()
        })
        .eq('id', pagamento_id);

      const { data: cfg } = await supabase
        .from('configuracoes')
        .select('valor')
        .eq('chave', 'total_vagas')
        .single();

      const totalVagas = parseInt(cfg?.valor || '30', 10);

      const { count: ocupadas } = await supabase
        .from('acessos')
        .select('*', { count: 'exact', head: true })
        .eq('status', 'ativo');

      if ((ocupadas || 0) < totalVagas) {
        await supabase.from('acessos').insert({
          usuario_id: pag.usuario_id,
          pagamento_id: pag.id,
          registrado_por: 'recepcao',
          status: 'ativo'
        });
      }

      return res.status(200).json({
        mensagem: 'Pagamento confirmado e entrada registrada!'
      });

    } catch (e) {
      console.error(e);
      return res.status(500).json({ erro: 'Erro interno' });
    }
  }

  // ═══════════════════════════════════════════════════════
  // 🟣 WEBHOOK (FUTURO)
  // ═══════════════════════════════════════════════════════
  if (req.method === 'POST' && acao === 'webhook') {
    console.log('[Webhook]', JSON.stringify(req.body || {}));
    return res.status(200).json({ ok: true });
  }

  // ═══════════════════════════════════════════════════════
  // ❌ FALLBACK
  // ═══════════════════════════════════════════════════════
  return res.status(405).json({
    erro: 'Método ou ação não permitidos'
  });
};
