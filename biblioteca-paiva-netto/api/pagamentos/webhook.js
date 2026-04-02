// api/pagamentos/webhook.js
// POST /api/pagamentos/webhook
// Recebe notificações do gateway de pagamento (Mercado Pago ou EfiBank)
// Este é o endpoint que confirma pagamentos Pix e libera a vaga

const supabase = require('../../lib/supabase');

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ erro: 'Método não permitido' });

  const body = req.body || {};
  console.log('[Webhook Pix] Recebido:', JSON.stringify(body));

  // ================================================================
  // MERCADO PAGO — formato do webhook
  // body.type === 'payment' e body.data.id = ID do pagamento
  // ================================================================
  if (body.type === 'payment' && body.data?.id) {
    const paymentId = String(body.data.id);

    // Busca o pagamento no banco pelo txid
    const { data: pagamento } = await supabase
      .from('pagamentos')
      .select('id, usuario_id, status')
      .eq('txid', paymentId)
      .maybeSingle();

    if (!pagamento) {
      console.warn(`[Webhook] Pagamento ${paymentId} não encontrado no banco`);
      return res.status(200).json({ ok: true }); // Retorna 200 para o gateway não retentar
    }

    if (pagamento.status === 'confirmado') {
      return res.status(200).json({ ok: true, mensagem: 'Já confirmado' });
    }

    // Confirma o pagamento
    await supabase
      .from('pagamentos')
      .update({ status: 'confirmado', confirmado_em: new Date().toISOString() })
      .eq('id', pagamento.id);

    // Registra o acesso automaticamente
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

    if ((ocupadas || 0) < totalVagas) {
      await supabase
        .from('acessos')
        .insert({
          usuario_id:      pagamento.usuario_id,
          pagamento_id:    pagamento.id,
          registrado_por:  'sistema',
          status:          'ativo'
        });

      console.log(`[Webhook] Acesso registrado para usuário ${pagamento.usuario_id}`);

      // TODO (Passo 4): Chamar API Control iD para liberar catraca
      // await liberarCatraca(pagamento.usuario_id);
    } else {
      console.warn(`[Webhook] Pagamento confirmado mas sala lotada! usuario=${pagamento.usuario_id}`);
      // TODO: Notificar usuário (SMS/WhatsApp) e fazer reembolso
    }

    return res.status(200).json({ ok: true, mensagem: 'Pagamento confirmado' });
  }

  // ================================================================
  // EFIBANK / GN — formato diferente
  // Adicionar aqui quando integrar EfiBank
  // ================================================================

  // Responde 200 para qualquer webhook não reconhecido (evita reenvios)
  return res.status(200).json({ ok: true });
};
