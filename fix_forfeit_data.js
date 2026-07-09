const fs = require('fs');
const path = "lib/handlers/pagamentos.js";
let content = fs.readFileSync(path, "utf-8");

let nA = 0, nB = 0;

// ── Bloco A: criar-cobranca-pix ──
const oldA = `      const { data: ultimaSaida } = await supabase
        .from('acessos')
        .select('motivo_saida')
        .eq('usuario_id', usuario_id)
        .eq('status', 'encerrado')
        .gte('saida_em', hoje.toISOString())
        .order('saida_em', { ascending: false })
        .limit(1)
        .maybeSingle();
      const forfeitPorSaidaManual = ultimaSaida?.motivo_saida === 'usuario';
      // Idempotência — reutiliza cobrança pendente do dia
      const { data: jaExiste } = await supabase
        .from('pagamentos')
        .select('id, status, gateway_txid, copia_cola, qr_code')
        .eq('usuario_id', usuario_id)
        .in('status', ['pendente', 'confirmado'])
        .gte('created_at', hoje.toISOString())
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();
if (jaExiste?.status === 'confirmado' && !forfeitPorSaidaManual) {`;

const newA = `      const { data: ultimaSaida } = await supabase
        .from('acessos')
        .select('motivo_saida, saida_em')
        .eq('usuario_id', usuario_id)
        .eq('status', 'encerrado')
        .gte('saida_em', hoje.toISOString())
        .order('saida_em', { ascending: false })
        .limit(1)
        .maybeSingle();
      // Idempotência — reutiliza cobrança pendente do dia
      const { data: jaExiste } = await supabase
        .from('pagamentos')
        .select('id, status, confirmado_em, gateway_txid, copia_cola, qr_code')
        .eq('usuario_id', usuario_id)
        .in('status', ['pendente', 'confirmado'])
        .gte('created_at', hoje.toISOString())
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      // Forfeit só vale se a saída voluntária for POSTERIOR à confirmação do pagamento
      // (senão um pagamento novo, pago depois da saída, ficaria bloqueado para sempre)
      const forfeitAtivo = ultimaSaida?.motivo_saida === 'usuario'
        && jaExiste?.confirmado_em
        && new Date(ultimaSaida.saida_em) > new Date(jaExiste.confirmado_em);
if (jaExiste?.status === 'confirmado' && !forfeitAtivo) {`;

if (content.includes(oldA)) {
  content = content.replace(oldA, newA);
  nA = 1;
}

// ── Bloco B: status-hoje ──
const oldB = `      const { data: ultimaSaida } = await supabase
        .from('acessos')
        .select('motivo_saida')
        .eq('usuario_id', usuario_id)
        .eq('status', 'encerrado')
        .gte('saida_em', hoje.toISOString())
        .order('saida_em', { ascending: false })
        .limit(1)
        .maybeSingle();
      const forfeitPorSaidaManual = ultimaSaida?.motivo_saida === 'usuario';
      const { data } = await supabase
        .from('pagamentos')
        .select('id, status, tipo, confirmado_em, gateway_txid, copia_cola')
        .eq('usuario_id', usuario_id)
        .gte('created_at', hoje.toISOString())
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (!data) return res.status(200).json({ status: 'nenhum' });
      if (data.status === 'confirmado' && forfeitPorSaidaManual) {
        return res.status(200).json({ status: 'nenhum' });
      }`;

const newB = `      const { data: ultimaSaida } = await supabase
        .from('acessos')
        .select('motivo_saida, saida_em')
        .eq('usuario_id', usuario_id)
        .eq('status', 'encerrado')
        .gte('saida_em', hoje.toISOString())
        .order('saida_em', { ascending: false })
        .limit(1)
        .maybeSingle();
      const { data } = await supabase
        .from('pagamentos')
        .select('id, status, tipo, confirmado_em, gateway_txid, copia_cola')
        .eq('usuario_id', usuario_id)
        .gte('created_at', hoje.toISOString())
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (!data) return res.status(200).json({ status: 'nenhum' });
      // Forfeit só vale se a saída voluntária for POSTERIOR à confirmação do pagamento
      const forfeitAtivo = ultimaSaida?.motivo_saida === 'usuario'
        && data.confirmado_em
        && new Date(ultimaSaida.saida_em) > new Date(data.confirmado_em);
      if (data.status === 'confirmado' && forfeitAtivo) {
        return res.status(200).json({ status: 'nenhum' });
      }`;

if (content.includes(oldB)) {
  content = content.replace(oldB, newB);
  nB = 1;
}

fs.writeFileSync(path, content, "utf-8");
console.log(`Bloco A (criar-cobranca-pix): ${nA} substituição(ões)`);
console.log(`Bloco B (status-hoje): ${nB} substituição(ões)`);
if (nA === 0 || nB === 0) console.log("⚠️ Algum bloco não bateu — confira manualmente.");
