// api/pagamentos.js
//
// FLUXO CORRETO — 100% automático, sem confirmação manual:
//
//   PIX (app/totem):
//     1. POST /api/pagamentos?acao=criar-cobranca-pix
//        → Cria cobrança no gateway (EfiBank/MP/Pagar.me)
//        → Retorna { qr_code, qr_code_base64, copia_cola, expiracao, pagamento_id }
//     2. Frontend exibe QR Code, poll GET /api/pagamentos?acao=status-hoje a cada 3s
//     3. Gateway recebe confirmação do Banco Central e chama:
//        POST /api/pagamentos?acao=webhook  (URL cadastrada no gateway)
//     4. Webhook confirma no banco + libera catraca Control iD
//     5. Poll detecta status='confirmado' → tela de sucesso
//
//   CARTÃO (recepção — Stone EYE PRO):
//     1. POST /api/pagamentos?acao=cobrar-stone
//        → Autentica na API Stone com STONE_CODE + STONE_SECRET_KEY
//        → Envia cobrança para o POS via serial STONE_SERIAL_POS
//        → Retorna { pagamento_id, stone_order_id }
//     2. Recepcionista apresenta maquininha ao cliente
//     3. Stone confirma via POST /api/pagamentos?acao=webhook-stone
//     4. Webhook registra acesso + libera catraca Control iD
//     5. ✅ Sem intervenção manual
//
//   CRÉDITO/DÉBITO (app — link gateway):
//     1. POST /api/pagamentos?acao=gerar-link
//     2. Usuário paga no site do gateway
//     3. Webhook confirma → catraca libera
//
//   RECEPÇÃO (backup apenas):
//     POST /api/pagamentos?acao=confirmar  (exige auth admin/recepcao)

const crypto   = require('crypto');
const supabase = require('../supabase');
const { autenticado } = require('../../middleware/auth');

// ═══════════════════════════════════════════════════════════════════
// HELPERS — CONTROL iD
// ═══════════════════════════════════════════════════════════════════

async function getConfig(chaves) {
  const { data } = await supabase
    .from('configuracoes')
    .select('chave, valor')
    .in('chave', Array.isArray(chaves) ? chaves : [chaves]);
  const cfg = {};
  (data || []).forEach(r => { cfg[r.chave] = r.valor; });
  return cfg;
}

// ═══════════════════════════════════════════════════════════════════
// HELPERS — STONE PAYMENTS
// Documentação: https://docs.stone.com.br
// Credenciais via variáveis de ambiente (NUNCA hardcoded):
//   STONE_CODE       → Stone Code da loja
//   STONE_SECRET_KEY → Chave secreta da API Stone
//   STONE_SERIAL_POS → Número de série do POS EYE PRO
// ═══════════════════════════════════════════════════════════════════

// Autentica na API Stone e retorna access_token
async function stoneAutenticar() {
  const stoneCode  = process.env.STONE_CODE;
  const secretKey  = process.env.STONE_SECRET_KEY;

  if (!stoneCode || !secretKey) {
    throw new Error('STONE_CODE ou STONE_SECRET_KEY não configurados');
  }

  // Stone usa autenticação OAuth2 client_credentials
  const resp = await fetch('https://sandbox-api.openbank.stone.com.br/api/v1/auth/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_id:     stoneCode,
      client_secret: secretKey,
      grant_type:    'client_credentials'
    }),
    signal: AbortSignal.timeout(8000)
  });

  if (!resp.ok) {
    const txt = await resp.text().catch(() => '');
    throw new Error(`Stone Auth ${resp.status}: ${txt}`);
  }

  const data = await resp.json();
  return data.access_token;
}

// Envia cobrança para o POS Stone EYE PRO
async function stoneCobrarPOS({ valor, tipo, pagamentoId, serialPOS }) {
  const token = await stoneAutenticar();
  const serial = serialPOS || process.env.STONE_SERIAL_POS;

  if (!serial) throw new Error('STONE_SERIAL_POS não configurado');

  // Mapeia tipo para método de pagamento Stone
  const metodoPagto = {
    credito: 'credit',
    debito:  'debit',
    pix:     'pix'
  }[tipo] || 'credit';

  const resp = await fetch(`https://sandbox-api.openbank.stone.com.br/api/v1/pos/${serial}/payment`, {
    method: 'POST',
    headers: {
      'Content-Type':  'application/json',
      'Authorization': `Bearer ${token}`
    },
    body: JSON.stringify({
      amount:           Math.round(valor * 100), // centavos
      payment_method:   metodoPagto,
      external_id:      pagamentoId,             // referência para o webhook
      capture:          true,
      installments:     1,
      description:      'Ala dos Estudantes — Acesso Diário'
    }),
    signal: AbortSignal.timeout(10000)
  });

  if (!resp.ok) {
    const txt = await resp.text().catch(() => '');
    throw new Error(`Stone POS ${resp.status}: ${txt}`);
  }

  return resp.json();
}

// Valida assinatura do webhook Stone
// Stone envia header x-stone-signature com HMAC-SHA256 do body
function stoneValidarWebhook(body, signature) {
  const secretKey = process.env.STONE_SECRET_KEY;
  if (!secretKey || !signature) return false;
  const expected = crypto
    .createHmac('sha256', secretKey)
    .update(typeof body === 'string' ? body : JSON.stringify(body))
    .digest('hex');
  return crypto.timingSafeEqual(
    Buffer.from(signature),
    Buffer.from(expected)
  );
}


async function controlIdRequest(endpoint, body, cfg) {
  const baseUrl = (cfg.controlid_url || '').replace(/\/$/, '');
  if (!baseUrl) throw new Error('URL do Control iD não configurada');
  const headers = { 'Content-Type': 'application/json' };
  if (cfg.controlid_token) headers['Authorization'] = `Bearer ${cfg.controlid_token}`;
  const resp = await fetch(`${baseUrl}${endpoint}`, {
    method: 'POST', headers, body: JSON.stringify(body),
    signal: AbortSignal.timeout(8000)
  });
  if (!resp.ok) {
    const txt = await resp.text().catch(() => '');
    throw new Error(`Control iD ${resp.status}: ${txt}`);
  }
  return resp.json().catch(() => ({}));
}

// ═══════════════════════════════════════════════════════════════════
// SUBSTITUA a função liberarCatraca atual (linhas ~161 a 235)
// por esta versão que usa a fila do Supabase em vez de chamar
// a catraca diretamente (impossível da Vercel — IP privado)
// ═══════════════════════════════════════════════════════════════════

async function liberarCatraca(usuarioId) {
  try {
    // Busca dados do usuário — precisa do controlid_person_id e nome
    const { data: usuario } = await supabase
      .from('usuarios')
      .select('controlid_person_id, nome, cpf')
      .eq('id', usuarioId)
      .maybeSingle();

    if (!usuario?.controlid_person_id) {
      console.warn(`[liberarCatraca] Usuário ${usuarioId} sem controlid_person_id`);
      return { ok: false, motivo: 'Usuário sem biometria cadastrada no Control iD' };
    }

    // Verifica se já tem liberação pendente para este usuário
    // (idempotência — evita duplicatas se webhook disparar duas vezes)
    const { data: existente } = await supabase
      .from('liberacoes_catraca')
      .select('id')
      .eq('usuario_id', usuarioId)
      .eq('status', 'pendente')
      .maybeSingle();

    if (existente) {
      console.log(`[liberarCatraca] Já na fila — id=${existente.id}`);
      return { ok: true, motivo: 'Já na fila de liberação', fila_id: existente.id };
    }

    // Insere na fila — o agente local pega em até 3 segundos e aciona a catraca
    const { data: fila, error } = await supabase
      .from('liberacoes_catraca')
      .insert({
        usuario_id:        usuarioId,
        controlid_user_id: parseInt(usuario.controlid_person_id, 10),
        nome:              usuario.nome || usuario.cpf || usuarioId,
        status:            'pendente',
        criado_em:         new Date().toISOString(),
      })
      .select('id')
      .single();

    if (error) {
      console.error('[liberarCatraca] Erro ao inserir na fila:', error.message);
      return { ok: false, motivo: `Erro ao enfileirar: ${error.message}` };
    }

    console.log(`[liberarCatraca] ✅ Enfileirado — fila_id=${fila.id} usuario=${usuario.nome}`);
    return { ok: true, motivo: 'Liberação enfileirada — catraca abrirá em até 3s', fila_id: fila.id };

  } catch (err) {
    console.error('[liberarCatraca]', err.message);
    return { ok: false, motivo: err.message };
  }
}

// ═══════════════════════════════════════════════════════════════════
// COMO SUBSTITUIR NO pagamentos.js:
//
// 1. Abra api/pagamentos.js no VS Code
// 2. Selecione TUDO da linha 161 até a linha 235 (a função inteira)
//    — começa em: async function liberarCatraca(usuarioId) {
//    — termina em: } (o fechamento da função, antes de processarPagamentoConfirmado)
// 3. Substitua pelo código acima
// 4. Salve, commit e push
//
// O restante do pagamentos.js não muda nada — o processarPagamentoConfirmado
// continua chamando liberarCatraca(usuarioId) exatamente igual.
// ═══════════════════════════════════════════════════════════════════
// ═══════════════════════════════════════════════════════════════════
// HELPER — CONFIRMAR NO BANCO + LIBERAR CATRACA
// Chamado pelo webhook e pelos endpoints de TEF
// ═══════════════════════════════════════════════════════════════════

async function processarPagamentoConfirmado({ pagamentoId, usuarioId, origem = 'webhook' }) {
  // 1. Idempotência — se já confirmado, não faz nada
  const { data: pag } = await supabase
    .from('pagamentos')
    .select('id, status')
    .eq('id', pagamentoId)
    .maybeSingle();

  if (!pag) return { ok: false, motivo: 'Pagamento não encontrado' };
  if (pag.status === 'confirmado') return { ok: true, motivo: 'Já confirmado anteriormente' };

  // 2. Confirma pagamento
  await supabase
    .from('pagamentos')
    .update({ status: 'confirmado', confirmado_em: new Date().toISOString() })
    .eq('id', pagamentoId);

  // 3. Verifica vagas
  const { data: cfgVagas } = await supabase
    .from('configuracoes').select('valor').eq('chave', 'total_vagas').single();
  const totalVagas = parseInt(cfgVagas?.valor || '30', 10);

  const { count: ocupadas } = await supabase
    .from('acessos').select('*', { count: 'exact', head: true }).eq('status', 'ativo');

  if ((ocupadas || 0) >= totalVagas) {
    return { ok: false, motivo: 'Sala lotada — pagamento confirmado mas sem vaga disponível' };
  }

  // 4. Verifica acesso duplicado no dia
  const hoje = new Date(); hoje.setHours(0, 0, 0, 0);
  const { data: acessoExiste } = await supabase
    .from('acessos').select('id').eq('usuario_id', usuarioId)
    .eq('status', 'ativo').gte('entrada_em', hoje.toISOString()).maybeSingle();

  let acessoId = acessoExiste?.id;
  if (!acessoExiste) {
    const { data: novoAcesso } = await supabase
      .from('acessos')
      .insert({ usuario_id: usuarioId, pagamento_id: pagamentoId, registrado_por: origem, status: 'ativo' })
      .select('id').single();
    acessoId = novoAcesso?.id;
  }

  // 5. Libera catraca
  const catraca = await liberarCatraca(usuarioId);
  console.log(`[processarPagamento] usuario=${usuarioId} acesso=${acessoId} catraca=${catraca.ok} motivo="${catraca.motivo}"`);

  return { ok: true, acesso_id: acessoId, catraca_liberada: catraca.ok, motivo_catraca: catraca.motivo };
}

// ═══════════════════════════════════════════════════════════════════
// HELPERS — GATEWAY PIX (EfiBank / Mercado Pago / Pagar.me)
// Abstração que detecta qual gateway está configurado e usa o correto
// ═══════════════════════════════════════════════════════════════════

async function criarCobrancaPix({ usuarioId, valor, pagamentoId }) {
  const cfg = await getConfig([
    'gateway_tipo',     // 'efi' | 'mercadopago' | 'pagarme' | 'manual'
    'gateway_chave',    // chave de API / token do gateway
    'gateway_chave_pix', // chave Pix (CNPJ, e-mail, etc.)
    'pix_chave',        // fallback
    'pix_nome'
  ]);

  const tipo = cfg.gateway_tipo || 'manual';

  // ── EfiBank (Gerencianet) ─────────────────────────────────────
  if (tipo === 'efi') {
    // SDK: npm install sdk-node-apis-efi
    // Documentação: https://dev.efipay.com.br/docs/api-pix/cobrancas
    try {
      const EfiPay = require('sdk-node-apis-efi');
      const efi = new EfiPay({
        client_id:     cfg.gateway_chave?.split(':')[0],
        client_secret: cfg.gateway_chave?.split(':')[1],
        sandbox: false
      });
      const expiracao = 300; // 5 minutos
      const body = {
        calendario: { expiracao },
        devedor: {},
        valor: { original: valor.toFixed(2) },
        chave: cfg.gateway_chave_pix || cfg.pix_chave,
        solicitacaoPagador: 'Ala dos Estudantes — Acesso Diário',
        infoAdicionais: [{ nome: 'pagamento_id', valor: pagamentoId }]
      };
      const cob = await efi.pixCreateImmediateCharge({}, body);
      const qr  = await efi.pixGenerateQRCode({ id: cob.loc.id });
      return {
        ok: true,
        txid:           cob.txid,
        qr_code:        qr.imagemQrcode,        // base64 PNG
        copia_cola:     qr.qrcode,              // string Pix copia e cola
        expiracao_seg:  expiracao,
        gateway:        'efi'
      };
    } catch (e) {
      throw new Error('EfiBank: ' + e.message);
    }
  }

  // ── Mercado Pago ──────────────────────────────────────────────
  if (tipo === 'mercadopago') {
    // Documentação: https://www.mercadopago.com.br/developers/pt/docs/checkout-api/integration-configuration/integrate-with-pix
    try {
      const resp = await fetch('https://api.mercadopago.com/v1/payments', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${cfg.gateway_chave}`,
          'X-Idempotency-Key': pagamentoId
        },
        body: JSON.stringify({
          transaction_amount: valor,
          description: 'Ala dos Estudantes — Acesso Diário',
          payment_method_id: 'pix',
          payer: { email: 'pagador@alaestudantes.com.br' },
          external_reference: `usuario_id:${usuarioId}:pagamento_id:${pagamentoId}`,
          date_of_expiration: new Date(Date.now() + 300000).toISOString()
        })
      });
      const data = await resp.json();
      if (!resp.ok) throw new Error(data.message || JSON.stringify(data));
      return {
        ok: true,
        txid:          data.id,
        qr_code:       data.point_of_interaction?.transaction_data?.qr_code_base64,
        copia_cola:    data.point_of_interaction?.transaction_data?.qr_code,
        expiracao_seg: 300,
        gateway:       'mercadopago'
      };
    } catch (e) {
      throw new Error('Mercado Pago: ' + e.message);
    }
  }

  // ── Pagar.me ─────────────────────────────────────────────────
  if (tipo === 'pagarme') {
    try {
      const resp = await fetch('https://api.pagar.me/core/v5/orders', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Basic ' + Buffer.from(cfg.gateway_chave + ':').toString('base64')
        },
        body: JSON.stringify({
          items: [{ amount: Math.round(valor * 100), description: 'Acesso Diário', quantity: 1 }],
          payments: [{
            payment_method: 'pix',
            pix: { expires_in: 300 },
            amount: Math.round(valor * 100)
          }],
          metadata: { pagamento_id: pagamentoId, usuario_id: usuarioId }
        })
      });
      const data = await resp.json();
      if (!resp.ok) throw new Error(data.message || JSON.stringify(data));
      const pix = data.charges?.[0]?.last_transaction;
      return {
        ok: true,
        txid:          data.id,
        qr_code:       pix?.qr_code_url,
        copia_cola:    pix?.qr_code,
        expiracao_seg: 300,
        gateway:       'pagarme'
      };
    } catch (e) {
      throw new Error('Pagar.me: ' + e.message);
    }
  }

  // ── Manual (sem gateway — exibe chave Pix estática) ──────────
  // Neste modo o usuário paga na chave e toca "Já Paguei".
  // O backend não verifica o pagamento automaticamente.
  // É um fallback temporário até o gateway ser configurado.
  return {
    ok: true,
    txid:          null,
    qr_code:       null,
    copia_cola:    cfg.gateway_chave_pix || cfg.pix_chave || '',
    expiracao_seg: 300,
    gateway:       'manual',
    aviso:         'Gateway não configurado — confirmação manual ativa como fallback'
  };
}

// ═══════════════════════════════════════════════════════════════════
// HELPER — GERAR LINK DE PAGAMENTO (crédito/débito no app)
// ═══════════════════════════════════════════════════════════════════

async function gerarLinkPagamento({ usuarioId, valor, pagamentoId, tipo }) {
  const cfg = await getConfig(['gateway_tipo', 'gateway_chave']);
  const gatewayTipo = cfg.gateway_tipo || 'manual';

  if (gatewayTipo === 'mercadopago') {
    const resp = await fetch('https://api.mercadopago.com/checkout/preferences', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${cfg.gateway_chave}`
      },
      body: JSON.stringify({
        items: [{
          title: 'Ala dos Estudantes — Acesso Diário',
          unit_price: valor,
          quantity: 1,
          currency_id: 'BRL'
        }],
        payment_methods: {
          excluded_payment_types: tipo === 'credito'
            ? [{ id: 'debit_card' }, { id: 'ticket' }]
            : [{ id: 'credit_card' }, { id: 'ticket' }]
        },
        external_reference: `usuario_id:${usuarioId}:pagamento_id:${pagamentoId}`,
        notification_url: `${process.env.VERCEL_URL || ''}/api/pagamentos?acao=webhook`,
        back_urls: {
          success: `${process.env.VERCEL_URL || ''}/sucesso`,
          failure: `${process.env.VERCEL_URL || ''}/erro`
        },
        auto_return: 'approved'
      })
    });
    const data = await resp.json();
    if (!resp.ok) throw new Error(data.message || 'Erro Mercado Pago');
    return { url: data.init_point };
  }

  if (gatewayTipo === 'pagarme') {
    const resp = await fetch('https://api.pagar.me/core/v5/orders', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Basic ' + Buffer.from(cfg.gateway_chave + ':').toString('base64')
      },
      body: JSON.stringify({
        items: [{ amount: Math.round(valor * 100), description: 'Acesso Diário', quantity: 1 }],
        payments: [{
          payment_method: tipo === 'credito' ? 'credit_card' : 'debit_card',
          amount: Math.round(valor * 100)
        }],
        metadata: { pagamento_id: pagamentoId, usuario_id: usuarioId }
      })
    });
    const data = await resp.json();
    if (!resp.ok) throw new Error(data.message || 'Erro Pagar.me');
    return { url: data.checkouts?.[0]?.payment_url || data.url };
  }

  throw new Error('Gateway não configurado para link de pagamento. Configure no painel Admin.');
}

// ═══════════════════════════════════════════════════════════════════
// HANDLER PRINCIPAL
// ═══════════════════════════════════════════════════════════════════

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, x-signature, x-request-id');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const acao = req.query.acao;

  // ───────────────────────────────────────────────────────────────
  // 🟡 CRIAR COBRANÇA PIX — público (app/totem)
  //    Retorna QR Code real gerado pelo gateway.
  //    Frontend faz poll em /status-hoje a cada 3s.
  //    Quando webhook chegar, poll detecta 'confirmado' e libera UI.
  // ───────────────────────────────────────────────────────────────
  if (req.method === 'POST' && acao === 'criar-cobranca-pix') {
    try {
      const { usuario_id, origem = 'app' } = req.body || {};
      if (!usuario_id) return res.status(400).json({ erro: 'usuario_id obrigatório' });

      const hoje = new Date(); hoje.setHours(0, 0, 0, 0);

      // Idempotência — reutiliza cobrança pendente do dia
      const { data: jaExiste } = await supabase
        .from('pagamentos')
        .select('id, status, gateway_txid, copia_cola, qr_code')
        .eq('usuario_id', usuario_id)
        .in('status', ['pendente', 'confirmado'])
        .gte('created_at', hoje.toISOString())
        .maybeSingle();

      if (jaExiste?.status === 'confirmado') {
        return res.status(200).json({ status: 'confirmado', mensagem: 'Acesso já confirmado hoje' });
      }

      if (jaExiste?.status === 'pendente' && jaExiste?.copia_cola) {
        // Retorna a cobrança existente sem criar nova
        return res.status(200).json({
          pagamento_id:  jaExiste.id,
          copia_cola:    jaExiste.copia_cola,
          qr_code:       jaExiste.qr_code,
          gateway:       'cached',
          expiracao_seg: 300
        });
      }

      // Carrega valor via getConfig (consistente com demais endpoints)
      const cfgValor = await getConfig(['valor_diaria']);
      const valor = parseFloat((cfgValor.valor_diaria || '10').replace(',', '.'));

      // Cria registro pendente primeiro (para ter o ID)
      const { data: pag, error: errPag } = await supabase
        .from('pagamentos')
        .insert({ usuario_id, tipo: 'pix', valor, status: 'pendente', origem })
        .select('id').single();

      if (errPag) return res.status(500).json({ erro: 'Erro ao criar pagamento' });

      // Cria cobrança no gateway
      const cobranca = await criarCobrancaPix({ usuarioId: usuario_id, valor, pagamentoId: pag.id });

      // Salva dados da cobrança no banco para reutilização e rastreio
      await supabase.from('pagamentos').update({
        gateway_txid: cobranca.txid || null,
        copia_cola:   cobranca.copia_cola || null,
        qr_code:      cobranca.qr_code || null
      }).eq('id', pag.id);

      return res.status(201).json({
        pagamento_id:  pag.id,
        copia_cola:    cobranca.copia_cola,
        qr_code:       cobranca.qr_code,
        expiracao_seg: cobranca.expiracao_seg,
        gateway:       cobranca.gateway,
        aviso:         cobranca.aviso || null
      });

    } catch (e) {
      console.error('[criar-cobranca-pix]', e);
      return res.status(500).json({ erro: e.message || 'Erro ao criar cobrança Pix' });
    }
  }

  // ───────────────────────────────────────────────────────────────
  // 🔗 GERAR LINK DE PAGAMENTO — cartão no app (público)
  // ───────────────────────────────────────────────────────────────
  if (req.method === 'POST' && acao === 'gerar-link') {
    try {
      const { usuario_id, tipo = 'credito', origem = 'app' } = req.body || {};
      if (!usuario_id) return res.status(400).json({ erro: 'usuario_id obrigatório' });

      const cfgValorL = await getConfig(['valor_diaria']);
      const valor = parseFloat((cfgValorL.valor_diaria || '10').replace(',', '.'));

      const { data: pag } = await supabase
        .from('pagamentos')
        .insert({ usuario_id, tipo, valor, status: 'pendente', origem })
        .select('id').single();

      const link = await gerarLinkPagamento({ usuarioId: usuario_id, valor, pagamentoId: pag.id, tipo });

      await supabase.from('pagamentos').update({ gateway_txid: link.order_id || null }).eq('id', pag.id);

      return res.status(201).json({ pagamento_id: pag.id, url: link.url });

    } catch (e) {
      console.error('[gerar-link]', e);
      return res.status(500).json({ erro: e.message || 'Erro ao gerar link de pagamento' });
    }
  }

  // ───────────────────────────────────────────────────────────────
  // 🖥️ INICIAR TEF — cartão no totem (público)
  //    Aciona o terminal Stone/Cielo/GetNet via backend.
  //    Se o terminal tiver integração automática, o webhook de
  //    confirmação chegará e a catraca será liberada sem mais ações.
  //    Se não tiver, retorna requer_confirmacao_manual=true.
  // ───────────────────────────────────────────────────────────────
  if (req.method === 'POST' && acao === 'iniciar-tef') {
    try {
      const { usuario_id, tipo = 'credito', origem = 'totem' } = req.body || {};
      if (!usuario_id) return res.status(400).json({ erro: 'usuario_id obrigatório' });

      const cfgValorT = await getConfig(['valor_diaria', 'tef_url', 'tef_tipo']);
      const valor = parseFloat((cfgValorT.valor_diaria || '10').replace(',', '.'));

      const { data: pag } = await supabase
        .from('pagamentos')
        .insert({ usuario_id, tipo, valor, status: 'pendente', origem })
        .select('id').single();

      // Tenta comunicar com o SDK do terminal (Stone/Cielo/GetNet)
      // Configuração: salvar no admin a URL local do serviço TEF
      // Ex: http://localhost:9090 (Stone SDK) ou http://localhost:8080 (Cielo LIO)
      const tefUrl = cfgValorT.tef_url;

      if (!tefUrl) {
        // Sem TEF configurado — retorna modo manual (operador confirma após cobrar)
        return res.status(200).json({
          pagamento_id: pag.id,
          requer_confirmacao_manual: true,
          mensagem: 'TEF não configurado — realize o pagamento na maquininha e confirme manualmente'
        });
      }

      // Envia solicitação ao daemon TEF local
      const tefResp = await fetch(`${tefUrl}/transacao`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          valor:       Math.round(valor * 100), // centavos
          tipo:        tipo === 'credito' ? 'credito_a_vista' : 'debito',
          referencia:  pag.id,
          descricao:   'Ala dos Estudantes — Acesso Diário'
        }),
        signal: AbortSignal.timeout(5000)
      }).then(r => r.json()).catch(() => null);

      if (!tefResp || tefResp.erro) {
        return res.status(200).json({
          pagamento_id: pag.id,
          requer_confirmacao_manual: true,
          mensagem: 'Terminal não respondeu — confirme manualmente após o pagamento'
        });
      }

      return res.status(200).json({
        pagamento_id: pag.id,
        ok: true,
        status: 'aguardando',
        mensagem: 'Terminal acionado — aguarde aprovação'
      });

    } catch (e) {
      console.error('[iniciar-tef]', e);
      return res.status(500).json({ erro: e.message });
    }
  }

  // ───────────────────────────────────────────────────────────────
  // 🔔 WEBHOOK — recebe confirmação automática do gateway
  //    Suporta: Mercado Pago, EfiBank, Pagar.me, TEF Stone/Cielo
  //    Esta rota é chamada pelo gateway, não pelo usuário.
  //    Retorna sempre 200 (gateways exigem isso).
  // ───────────────────────────────────────────────────────────────
  if (req.method === 'POST' && acao === 'webhook') {
    const body = req.body || {};
    console.log('[Webhook] recebido:', JSON.stringify(body).slice(0, 500));

    try {
      let pagamentoId = null;
      let usuarioId   = null;
      let aprovado    = false;

      // ── EfiBank ──────────────────────────────────────────────
      // Formato: { evento: 'PAGAMENTO_RECEBIDO', pix: [{ txid, valor, ... }] }
      if (body.evento === 'PAGAMENTO_RECEBIDO' && body.pix) {
        for (const pix of body.pix) {
          const infos = pix.infoAdicionais || [];
          const info  = infos.find(i => i.nome === 'pagamento_id');
          if (info?.valor) {
            const { data: pag } = await supabase
              .from('pagamentos').select('id, usuario_id, status')
              .eq('id', info.valor).maybeSingle();
            if (pag && pag.status !== 'confirmado') {
              pagamentoId = pag.id;
              usuarioId   = pag.usuario_id;
              aprovado    = true;
            }
          }
        }
      }

      // ── Mercado Pago ─────────────────────────────────────────
      // Formato: { action: 'payment.updated', data: { id: '...' } }
      if (!aprovado && body.action === 'payment.updated' && body.data?.id) {
        const mpResp = await fetch(`https://api.mercadopago.com/v1/payments/${body.data.id}`, {
          headers: { 'Authorization': `Bearer ${(await getConfig(['gateway_chave'])).gateway_chave}` }
        });
        const mpData = await mpResp.json();
        const ref = mpData.external_reference || '';
        const refParts = ref.split(':');
        const uId = refParts[1];
        const pId = refParts[3];
        if (mpData.status === 'approved' && uId && pId) {
          const { data: pag } = await supabase
            .from('pagamentos').select('id, usuario_id, status')
            .eq('id', pId).maybeSingle();
          if (pag && pag.status !== 'confirmado') {
            pagamentoId = pag.id;
            usuarioId   = pag.usuario_id;
            aprovado    = true;
          }
        }
      }

      // ── Pagar.me ─────────────────────────────────────────────
      // Formato: { type: 'order.paid', data: { id: '...', metadata: { pagamento_id, usuario_id } } }
      if (!aprovado && body.type === 'order.paid' && body.data?.metadata) {
        const meta = body.data.metadata;
        if (meta.pagamento_id && meta.usuario_id) {
          const { data: pag } = await supabase
            .from('pagamentos').select('id, usuario_id, status')
            .eq('id', meta.pagamento_id).maybeSingle();
          if (pag && pag.status !== 'confirmado') {
            pagamentoId = pag.id;
            usuarioId   = meta.usuario_id;
            aprovado    = true;
          }
        }
      }

      // ── TEF Stone/Cielo (webhook local encaminhado) ──────────
      // Formato: { evento: 'APROVADO', referencia: 'pagamento_id' }
      if (!aprovado && (body.evento === 'APROVADO' || body.status === 'approved') && body.referencia) {
        const { data: pag } = await supabase
          .from('pagamentos').select('id, usuario_id, status')
          .eq('id', body.referencia).maybeSingle();
        if (pag && pag.status !== 'confirmado') {
          pagamentoId = pag.id;
          usuarioId   = pag.usuario_id;
          aprovado    = true;
        }
      }

      // Processa se encontrou um pagamento válido
      if (aprovado && pagamentoId && usuarioId) {
        const resultado = await processarPagamentoConfirmado({
          pagamentoId, usuarioId, origem: 'webhook'
        });
        console.log(`[Webhook] Processado: pag=${pagamentoId} ok=${resultado.ok} catraca=${resultado.catraca_liberada}`);
      } else {
        console.log('[Webhook] Ignorado — pagamento não identificado ou já confirmado');
      }

    } catch (e) {
      console.error('[webhook] Erro:', e.message);
    }

    // Gateways exigem 200 sempre, mesmo em erro
    return res.status(200).json({ ok: true });
  }

  // ───────────────────────────────────────────────────────────────
  // 🔍 STATUS HOJE — poll do frontend (público)
  //    Frontend chama a cada 3s para detectar confirmação do webhook
  // ───────────────────────────────────────────────────────────────
  if (req.method === 'GET' && acao === 'status-hoje') {
    try {
      const { usuario_id } = req.query;
      if (!usuario_id) return res.status(400).json({ erro: 'usuario_id obrigatório' });

      const hoje = new Date(); hoje.setHours(0, 0, 0, 0);
      const { data } = await supabase
        .from('pagamentos')
        .select('id, status, tipo, confirmado_em, gateway_txid, copia_cola')
        .eq('usuario_id', usuario_id)
        .gte('created_at', hoje.toISOString())
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (!data) return res.status(200).json({ status: 'nenhum' });

      return res.status(200).json({
        status:        data.status,
        tipo:          data.tipo,
        confirmado_em: data.confirmado_em
      });
    } catch (e) {
      return res.status(500).json({ erro: 'Erro interno' });
    }
  }

  // ───────────────────────────────────────────────────────────────
  // 💳 CONFIRMAR MANUAL — BACKUP (auth recepção/admin APENAS)
  //    Não é o fluxo principal. Usar somente em falhas de sistema.
  //    Ex: gateway offline, TEF com defeito, emergência.
  // ───────────────────────────────────────────────────────────────
  if (req.method === 'POST' && acao === 'confirmar') {
    const auth = autenticado(req, res);
    if (!auth.ok) return;

    try {
      const { pagamento_id } = req.body || {};
      if (!pagamento_id) return res.status(400).json({ erro: 'pagamento_id obrigatório' });

      const { data: pag } = await supabase
        .from('pagamentos').select('id, usuario_id, status').eq('id', pagamento_id).maybeSingle();
      if (!pag) return res.status(404).json({ erro: 'Pagamento não encontrado' });
      if (pag.status === 'confirmado') return res.status(200).json({ mensagem: 'Já confirmado' });

      const resultado = await processarPagamentoConfirmado({
        pagamentoId: pag.id, usuarioId: pag.usuario_id, origem: 'recepcao_manual'
      });

      return res.status(200).json({
        mensagem: 'Confirmado manualmente (backup)',
        catraca_liberada: resultado.catraca_liberada,
        motivo_catraca:   resultado.motivo_catraca
      });
    } catch (e) {
      return res.status(500).json({ erro: 'Erro interno' });
    }
  }

  // ───────────────────────────────────────────────────────────────
  // ❌ CANCELAR (auth)
  // ───────────────────────────────────────────────────────────────
  if (req.method === 'POST' && acao === 'cancelar') {
    const auth = autenticado(req, res);
    if (!auth.ok) return;
    try {
      const { pagamento_id } = req.body || {};
      await supabase.from('pagamentos')
        .update({ status: 'cancelado', cancelado_em: new Date().toISOString() })
        .eq('id', pagamento_id).eq('status', 'pendente');
      return res.status(200).json({ mensagem: 'Cancelado' });
    } catch (e) {
      return res.status(500).json({ erro: 'Erro interno' });
    }
  }

  // ───────────────────────────────────────────────────────────────
  // 📋 PENDENTES (auth)
  // ───────────────────────────────────────────────────────────────
  if (req.method === 'GET' && acao === 'pendentes') {
    const auth = autenticado(req, res);
    if (!auth.ok) return;
    try {
      const hoje = new Date(); hoje.setHours(0, 0, 0, 0);
      const { data } = await supabase.from('pagamentos')
        .select('id, valor, tipo, status, origem, created_at, usuarios(id, nome, cpf)')
        .eq('status', 'pendente').gte('created_at', hoje.toISOString())
        .order('created_at', { ascending: false });
      return res.status(200).json({ pendentes: data || [], total: data?.length || 0 });
    } catch (e) { return res.status(500).json({ erro: 'Erro interno' }); }
  }

  // ───────────────────────────────────────────────────────────────
  // 💳 PAGOS HOJE (auth)
  // ───────────────────────────────────────────────────────────────
  if (req.method === 'GET' && acao === 'pagos-hoje') {
    const auth = autenticado(req, res);
    if (!auth.ok) return;
    try {
      const hoje = new Date(); hoje.setHours(0, 0, 0, 0);
      const { data } = await supabase.from('pagamentos')
        .select('id, valor, tipo, status, origem, confirmado_em, created_at, usuarios(id, nome, cpf)')
        .eq('status', 'confirmado').gte('created_at', hoje.toISOString())
        .order('confirmado_em', { ascending: false });
      return res.status(200).json({ pagamentos: data || [], total: data?.length || 0 });
    } catch (e) { return res.status(500).json({ erro: 'Erro interno' }); }
  }

  // ───────────────────────────────────────────────────────────────
  // ENVIAR FOTO + SINCRONIZAR CONTROL iD (mantidos do original)
  // ───────────────────────────────────────────────────────────────
  if (req.method === 'POST' && acao === 'enviar-foto') {
    const auth = autenticado(req, res);
    if (!auth.ok) return;
    try {
      const { usuario_id, foto_base64 } = req.body || {};
      if (!usuario_id || !foto_base64) return res.status(400).json({ erro: 'usuario_id e foto_base64 obrigatórios' });
      const { data: usuario } = await supabase.from('usuarios')
        .select('id, nome, cpf, controlid_person_id').eq('id', usuario_id).maybeSingle();
      if (!usuario) return res.status(404).json({ erro: 'Usuário não encontrado' });
      await supabase.from('usuarios').update({ foto_url: foto_base64 }).eq('id', usuario_id);
      const cfg = await getConfig(['controlid_url', 'controlid_token']);
      if (!cfg.controlid_url) return res.status(200).json({ ok: false, motivo: 'Control iD não configurado' });
      const fotoLimpa = foto_base64.replace(/^data:image\/\w+;base64,/, '');
      let personId = usuario.controlid_person_id;
      try {
        if (!personId) {
          const r = await controlIdRequest('/create_persons', {
            persons: [{ name: usuario.nome, registration: usuario.cpf, password: '', faces: [{ face_image: fotoLimpa }] }]
          }, cfg);
          personId = r?.ids?.[0] || r?.persons?.[0]?.id || null;
          if (personId) await supabase.from('usuarios').update({ controlid_person_id: String(personId) }).eq('id', usuario_id);
        } else {
          await controlIdRequest('/modify_persons', { persons: [{ id: personId, faces: [{ face_image: fotoLimpa }] }] }, cfg);
        }
        return res.status(200).json({ ok: true, motivo: `Foto sincronizada (person_id: ${personId})`, controlid_person_id: personId });
      } catch (cidErr) {
        return res.status(200).json({ ok: false, motivo: 'Foto salva localmente: ' + cidErr.message });
      }
    } catch (e) { return res.status(500).json({ erro: 'Erro interno' }); }
  }

  if (req.method === 'POST' && acao === 'sincronizar-controlid') {
    const auth = autenticado(req, res);
    if (!auth.ok) return;
    try {
      const cfg = await getConfig(['controlid_url', 'controlid_token']);
      const resp = await fetch(`${(cfg.controlid_url||'').replace(/\/$/,'')}/get_all_persons`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', ...(cfg.controlid_token ? { Authorization: `Bearer ${cfg.controlid_token}` } : {}) },
        body: JSON.stringify({}), signal: AbortSignal.timeout(10000)
      });
      const data = await resp.json();
      const pessoasCid = data.persons || data || [];
      if (!pessoasCid.length) return res.status(502).json({ erro: 'Control iD não retornou dados' });
      const mapaCpf = {};
      pessoasCid.forEach(p => { const cpf = (p.registration||p.cpf||'').replace(/\D/g,''); if(cpf.length===11) mapaCpf[cpf]=p.id; });
      const { data: nossosBanco } = await supabase.from('usuarios').select('id, cpf, controlid_person_id');
      let vinculados=0, jaVinculados=0, semCorrespondencia=0;
      for (const u of (nossosBanco||[])) {
        const cidId = mapaCpf[u.cpf];
        if (!cidId) { semCorrespondencia++; continue; }
        if (u.controlid_person_id === String(cidId)) { jaVinculados++; continue; }
        await supabase.from('usuarios').update({ controlid_person_id: String(cidId) }).eq('id', u.id);
        vinculados++;
      }
      return res.status(200).json({ mensagem: `Sincronização concluída — ${vinculados} vínculos criados`, vinculados, ja_vinculados: jaVinculados, sem_correspondencia_controlid: semCorrespondencia, total_controlid: pessoasCid.length, total_nosso_banco: nossosBanco?.length||0 });
    } catch (e) { return res.status(500).json({ erro: e.message }); }
  }

  // ── CONFIRMAR DIRETO MANUAL (fallback modo sem gateway — auth obrigatória)
  if (req.method === 'POST' && acao === 'confirmar-direto-manual') {
    const auth = autenticado(req, res);
    if (!auth.ok) return;
    try {
      const { usuario_id, tipo = 'pix', origem = 'app_manual' } = req.body || {};
      if (!usuario_id) return res.status(400).json({ erro: 'usuario_id obrigatório' });

      const hoje = new Date(); hoje.setHours(0,0,0,0);
      let { data: pag } = await supabase.from('pagamentos')
        .select('id, status').eq('usuario_id', usuario_id)
        .in('status', ['pendente','confirmado']).gte('created_at', hoje.toISOString()).maybeSingle();

      if (pag?.status === 'confirmado') {
        return res.status(200).json({ status: 'confirmado', mensagem: 'Já confirmado hoje', catraca_liberada: false });
      }

      if (!pag) {
        const cfgValorM = await getConfig(['valor_diaria']);
        const valor = parseFloat((cfgValorM.valor_diaria || '10').replace(',', '.'));
        const { data: novo } = await supabase.from('pagamentos')
          .insert({ usuario_id, tipo, valor, status: 'pendente', origem }).select('id').single();
        pag = novo;
      }

      const resultado = await processarPagamentoConfirmado({ pagamentoId: pag.id, usuarioId: usuario_id, origem });
      return res.status(200).json({ ok: true, status: 'confirmado', ...resultado });
    } catch(e) {
      return res.status(500).json({ erro: e.message });
    }
  }

  // ───────────────────────────────────────────────────────────────
  // 💳 COBRAR STONE — envia cobrança ao POS EYE PRO (auth recepção)
  //    Recepcionista clica → maquininha exibe valor → cliente paga
  //    Webhook Stone confirma automaticamente → catraca libera
  // ───────────────────────────────────────────────────────────────
  if (req.method === 'POST' && acao === 'cobrar-stone') {
    const auth = autenticado(req, res);
    if (!auth.ok) return;

    try {
      const { usuario_id, tipo = 'credito' } = req.body || {};
      if (!usuario_id) return res.status(400).json({ erro: 'usuario_id obrigatório' });

      // Verifica se já tem pagamento confirmado hoje
      const hoje = new Date(); hoje.setHours(0, 0, 0, 0);
      const { data: jaConfirmado } = await supabase
        .from('pagamentos').select('id, status')
        .eq('usuario_id', usuario_id).eq('status', 'confirmado')
        .gte('created_at', hoje.toISOString()).maybeSingle();

      if (jaConfirmado) {
        return res.status(409).json({ erro: 'Usuário já tem acesso confirmado hoje' });
      }

      // Verifica vagas
      const cfgVagas = await getConfig(['total_vagas']);
      const totalVagas = parseInt(cfgVagas.total_vagas || '30', 10);
      const { count: ocupadas } = await supabase
        .from('acessos').select('*', { count: 'exact', head: true }).eq('status', 'ativo');
      if ((ocupadas || 0) >= totalVagas) {
        return res.status(409).json({ erro: 'Sala lotada — não há vagas disponíveis' });
      }

      // Carrega valor
      const cfgValor = await getConfig(['valor_diaria']);
      const valor = parseFloat((cfgValor.valor_diaria || '10').replace(',', '.'));

      // Cria registro pendente
      const { data: pag, error: errPag } = await supabase
        .from('pagamentos')
        .insert({ usuario_id, tipo, valor, status: 'pendente', origem: 'recepcao_stone' })
        .select('id').single();

      if (errPag) return res.status(500).json({ erro: 'Erro ao criar registro de pagamento' });

      // Envia cobrança para o POS
      const stoneResp = await stoneCobrarPOS({
        valor,
        tipo,
        pagamentoId: pag.id,
        serialPOS: process.env.STONE_SERIAL_POS
      });

      // Salva referência Stone no banco
      await supabase.from('pagamentos')
        .update({ gateway_txid: stoneResp.id || stoneResp.order_id || null })
        .eq('id', pag.id);

      console.log(`[cobrar-stone] pagamento=${pag.id} stone_order=${stoneResp.id} valor=${valor}`);

      return res.status(201).json({
        ok: true,
        pagamento_id:   pag.id,
        stone_order_id: stoneResp.id || stoneResp.order_id,
        mensagem:       'Cobrança enviada para a maquininha — aguardando pagamento do cliente'
      });

    } catch (e) {
      console.error('[cobrar-stone]', e.message);
      return res.status(500).json({ erro: e.message || 'Erro ao cobrar na Stone' });
    }
  }

  // ───────────────────────────────────────────────────────────────
  // 🔔 WEBHOOK STONE — confirmação automática da maquininha
  //    URL para cadastrar no portal Stone:
  //    https://biblioteca-backend-v2-0.vercel.app/api/pagamentos?acao=webhook-stone
  //    Stone envia header: x-stone-signature (HMAC-SHA256)
  // ───────────────────────────────────────────────────────────────
  if (req.method === 'POST' && acao === 'webhook-stone') {
    const rawBody  = JSON.stringify(req.body || {});
    const signature = req.headers['x-stone-signature'] || '';

    // Valida assinatura — rejeita se inválida
    if (signature && !stoneValidarWebhook(rawBody, signature)) {
      console.warn('[webhook-stone] Assinatura inválida — rejeitado');
      return res.status(401).json({ erro: 'Assinatura inválida' });
    }

    const body = req.body || {};
    console.log('[webhook-stone] recebido:', JSON.stringify(body).slice(0, 400));

    try {
      // Stone envia: { type: 'payment.approved', data: { external_id, id, status } }
      const tipo   = body.type   || body.event || '';
      const data   = body.data   || body;
      const status = (data.status || '').toLowerCase();

      const aprovado = tipo === 'payment.approved'
        || tipo === 'transaction.approved'
        || status === 'approved'
        || status === 'paid';

      if (!aprovado) {
        console.log(`[webhook-stone] Ignorado — tipo=${tipo} status=${status}`);
        return res.status(200).json({ ok: true });
      }

      // Busca pagamento pelo external_id (nosso pagamento_id) ou gateway_txid
      const externalId = data.external_id || data.order_id || null;
      const stoneId    = data.id || null;

      let pag = null;

      if (externalId) {
        const { data: p } = await supabase
          .from('pagamentos').select('id, usuario_id, status')
          .eq('id', externalId).maybeSingle();
        pag = p;
      }

      if (!pag && stoneId) {
        const { data: p } = await supabase
          .from('pagamentos').select('id, usuario_id, status')
          .eq('gateway_txid', String(stoneId)).maybeSingle();
        pag = p;
      }

      if (!pag) {
        console.warn('[webhook-stone] Pagamento não encontrado', { externalId, stoneId });
        return res.status(200).json({ ok: true });
      }

      if (pag.status === 'confirmado') {
        console.log('[webhook-stone] Já confirmado — idempotência');
        return res.status(200).json({ ok: true });
      }

      const resultado = await processarPagamentoConfirmado({
        pagamentoId: pag.id,
        usuarioId:   pag.usuario_id,
        origem:      'webhook_stone'
      });

      console.log(`[webhook-stone] ✅ pag=${pag.id} catraca=${resultado.catraca_liberada}`);

    } catch (e) {
      console.error('[webhook-stone] Erro:', e.message);
    }

    // Stone exige 200 sempre
    return res.status(200).json({ ok: true });
  }

    return res.status(405).json({ erro: 'Método ou ação não permitidos' });
};
