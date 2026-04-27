/**
 * importar-controlid.js
 * 
 * Importa usuários do CSV exportado do Control iD para o Supabase.
 * 
 * USO:
 *   node importar-controlid.js pessoas.csv
 * 
 * O que faz:
 *   - Lê o CSV linha por linha
 *   - Para cada pessoa: verifica se CPF já existe no Supabase
 *   - Se não existe: insere com controlid_person_id vinculado
 *   - Se já existe: atualiza controlid_person_id e dados faltantes
 *   - Gera relatório final com totais
 * 
 * Colunas usadas do CSV:
 *   ID, Usuário, CPF, Celular, E-mail
 * 
 * ATENÇÃO: rode apenas uma vez. Em caso de erro, rode novamente —
 * o script é idempotente (não duplica registros).
 */

require('dotenv').config({ path: '.env.local' });
const fs      = require('fs');
const path    = require('path');
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

// ── Utilitários ──────────────────────────────────────────────
function limparCpf(cpf) {
  if (!cpf) return null;
  const limpo = String(cpf).replace(/\D/g, '');
  return limpo.length === 11 ? limpo : null;
}

function limparTelefone(tel) {
  if (!tel) return null;
  return String(tel).replace(/\D/g, '').slice(0, 20) || null;
}

function limparEmail(email) {
  if (!email) return null;
  const e = String(email).trim().toLowerCase();
  return e.includes('@') ? e : null;
}

function limparNome(nome) {
  if (!nome) return null;
  return String(nome).trim().replace(/\s+/g, ' ') || null;
}

// ── Parser CSV simples (suporta campos com aspas) ────────────
function parseCsvLine(line) {
  const result = [];
  let current  = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      inQuotes = !inQuotes;
    } else if (ch === ',' && !inQuotes) {
      result.push(current.trim());
      current = '';
    } else {
      current += ch;
    }
  }
  result.push(current.trim());
  return result;
}

// ── Principal ────────────────────────────────────────────────
async function main() {
  const csvFile = process.argv[2];
  if (!csvFile) {
    console.error('❌ Uso: node importar-controlid.js pessoas.csv');
    process.exit(1);
  }

  if (!fs.existsSync(csvFile)) {
    console.error(`❌ Arquivo não encontrado: ${csvFile}`);
    process.exit(1);
  }

  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_KEY) {
    console.error('❌ SUPABASE_URL ou SUPABASE_SERVICE_KEY não configurados no .env.local');
    process.exit(1);
  }

  const conteudo = fs.readFileSync(csvFile, 'utf8');
  const linhas   = conteudo.split('\n').filter(l => l.trim());

  // Cabeçalho
  const cabecalho = parseCsvLine(linhas[0]);
 const idx = {
  id: cabecalho.findIndex(c => c.toLowerCase().includes('id')),
  nome: cabecalho.findIndex(c => {
    const col = c.toLowerCase();
    return col.includes('usuario') || col.includes('usu') || col.includes('nome');
  }),
  cpf: cabecalho.findIndex(c => c.toLowerCase().includes('cpf')),
  cel: cabecalho.findIndex(c => c.toLowerCase().includes('cel')),
  email: cabecalho.findIndex(c => c.toLowerCase().includes('mail')),
};

  console.log(`\n📋 Colunas encontradas: ${JSON.stringify(idx)}`);

  if (idx.id < 0 || idx.nome < 0 || idx.cpf < 0) {
    console.error('❌ Colunas obrigatórias não encontradas: ID, Usuário, CPF');
    process.exit(1);
  }

  const dados = linhas.slice(1); // remove cabeçalho
  console.log(`\n👥 ${dados.length} pessoa(s) encontrada(s) no CSV\n`);
  console.log('─'.repeat(60));

  let inseridos    = 0;
  let atualizados  = 0;
  let semCpf       = 0;
  let erros        = 0;
  let jaCompletos  = 0;

  for (let i = 0; i < dados.length; i++) {
    const cols    = parseCsvLine(dados[i]);
    const cidId   = String(cols[idx.id] || '').trim();
    const nome    = limparNome(cols[idx.nome]);
    const cpf     = limparCpf(cols[idx.cpf]);
    const tel     = limparTelefone(cols[idx.cel]);
    const email   = limparEmail(cols[idx.email]);

    process.stdout.write(`[${i + 1}/${dados.length}] ${nome || '—'} `);

    if (!cpf) {
      console.log('⚠️  CPF inválido — ignorado');
      semCpf++;
      continue;
    }

    if (!cidId) {
      console.log('⚠️  ID Control iD vazio — ignorado');
      semCpf++;
      continue;
    }

    try {
      // Verifica se já existe pelo CPF
      const { data: existente } = await supabase
        .from('usuarios')
        .select('id, nome, cpf, controlid_person_id, email, telefone')
        .eq('cpf', cpf)
        .maybeSingle();

      if (existente) {
        // Já existe — atualiza controlid_person_id e dados faltantes
        if (existente.controlid_person_id === cidId &&
            existente.email && existente.telefone) {
          console.log('✅ já completo');
          jaCompletos++;
          continue;
        }

        const update = {};
        if (!existente.controlid_person_id) update.controlid_person_id = cidId;
        if (!existente.email   && email)    update.email   = email;
        if (!existente.telefone && tel)     update.telefone = tel;
        if (Object.keys(update).length === 0) {
          // só vincula o ID mesmo que já tenha email/tel
          update.controlid_person_id = cidId;
        }

        const { error } = await supabase
          .from('usuarios')
          .update({ ...update, updated_at: new Date().toISOString() })
          .eq('id', existente.id);

        if (error) throw error;
        console.log(`🔄 atualizado (person_id: ${cidId})`);
        atualizados++;

      } else {
        // Não existe — insere novo
        const { error } = await supabase
          .from('usuarios')
          .insert({
            nome:                 nome || 'Sem nome',
            cpf,
            email:                email || null,
            telefone:             tel   || null,
            tipo:                 'aluno',
            ativo:                true,
            controlid_person_id:  cidId,
            // sem senha_hash e sem termo_aceito_em intencionalmente
            // → sistema vai pedir no primeiro acesso
          });

        if (error) throw error;
        console.log(`➕ inserido (person_id: ${cidId})`);
        inseridos++;
      }

    } catch (e) {
      console.log(`❌ erro: ${e.message}`);
      erros++;
    }

    // Pequena pausa para não sobrecarregar o Supabase
    await new Promise(r => setTimeout(r, 80));
  }

  console.log('\n' + '═'.repeat(60));
  console.log('📊 RESULTADO DA IMPORTAÇÃO');
  console.log('═'.repeat(60));
  console.log(`➕ Inseridos (novos):     ${inseridos}`);
  console.log(`🔄 Atualizados:           ${atualizados}`);
  console.log(`✅ Já completos:          ${jaCompletos}`);
  console.log(`⚠️  Sem CPF/ID válido:    ${semCpf}`);
  console.log(`❌ Erros:                 ${erros}`);
  console.log(`👥 Total processado:      ${dados.length}`);
  console.log('═'.repeat(60));
  console.log('\n✅ Importação concluída!');
  console.log('💡 Usuários inseridos não têm senha — serão solicitados no primeiro acesso.\n');
}

main().catch(e => {
  console.error('❌ Erro fatal:', e.message);
  process.exit(1);
});
