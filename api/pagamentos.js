// api/pagamentos.js
// POST /api/pagamentos?acao=webhook  → recebe notificações Pix (Mercado Pago / EfiBank)

const supabase = require('../lib/supabase');

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ erro: 'Método não permitido' });

  const body = req.body || {};
  console.log('[Webhook Pix] Recebido:', JSON.stringify(body));

  // ── Mercado Pago ───────────────────────────────────────────────────────────
  if (body.type === 'payment' && body.data?.id) {
    const paymentId = String(body.data.id);

    const { data: pagamento } = await supabase
      .from('pagamentos').select('id, usuario_id, status')
      .eq('txid', paymentId).maybeSingle();

    if (!pagamento) {
      console.warn(`[Webhook] Pagamento ${paymentId} não encontrado no banco`);
      return res.status(200).json({ ok: true });
    }

    if (pagamento.status === 'confirmado') return res.status(200).json({ ok: true, mensagem: 'Já confirmado' });

    await supabase
      .from('pagamentos')
      .update({ status: 'confirmado', confirmado_em: new Date().toISOString() })
      .eq('id', pagamento.id);

    const { data: config } = await supabase
      .from('configuracoes').select('valor').eq('chave', 'total_vagas').single();
    const totalVagas = parseInt(config?.valor || '30', 10);

    const { count: ocupadas } = await supabase
      .from('acessos').select('*', { count: 'exact', head: true }).eq('status', 'ativo');

    if ((ocupadas || 0) < totalVagas) {
      await supabase.from('acessos').insert({
        usuario_id:     pagamento.usuario_id,
        pagamento_id:   pagamento.id,
        registrado_por: 'sistema',
        status:         'ativo'
      });
      console.log(`[Webhook] Acesso registrado para usuário ${pagamento.usuario_id}`);
      // TODO (Passo 4): await liberarCatraca(pagamento.usuario_id);
    } else {
      console.warn(`[Webhook] Pagamento confirmado mas sala lotada! usuario=${pagamento.usuario_id}`);
      // TODO: Notificar usuário e fazer reembolso
    }

    return res.status(200).json({ ok: true, mensagem: 'Pagamento confirmado' });
  }

  // ── EfiBank / GN ─────────────────────────────────────────────────────────
  // Adicionar aqui quando integrar EfiBank

  return res.status(200).json({ ok: true });
};
