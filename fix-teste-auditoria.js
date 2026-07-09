const fs = require('fs');
const caminho = 'lib/handlers/pagamentos.js';
let conteudo = fs.readFileSync(caminho, 'utf-8');

const antigo = `    // Log persistente para debug — grava o payload completo no banco
    supabase.from('auditoria').insert({
      acao: 'webhook_pagamento_recebido',
      ip: 'gateway',
      detalhes: { type: body.type || body.evento || body.action || 'desconhecido', payload: body },
      criado_em: new Date().toISOString()
    }).catch(() => {});`;

const novo = `    // TEMPORARIAMENTE DESATIVADO PARA TESTE
    // supabase.from('auditoria').insert({...}).catch(() => {});`;

if (!conteudo.includes(antigo)) {
  console.log('❌ Trecho não encontrado.');
  process.exit(1);
}
conteudo = conteudo.replace(antigo, novo);
fs.writeFileSync(caminho, conteudo, 'utf-8');
console.log('✅ Auditoria comentada temporariamente.');
