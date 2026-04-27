/**
 * gerar-tokens.js
 * Roda UMA VEZ para gerar os valores seguros do .env
 * Execute: node gerar-tokens.js
 * Depois DELETE este arquivo ou adicione ao .gitignore
 */

const crypto  = require('crypto');
const bcrypt  = require('bcryptjs');
const readline = require('readline');

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const p  = (q) => new Promise(r => rl.question(q, r));

async function main() {
  console.log('\n🔐 Gerador de tokens e hashes — Ala dos Estudantes\n');
  console.log('─'.repeat(55));

  // JWT_SECRET
  const jwt = crypto.randomBytes(48).toString('hex');
  console.log('\n✅ JWT_SECRET (cole no painel Vercel → Environment Variables):');
  console.log(`JWT_SECRET=${jwt}`);

  // CRON_TOKEN
  const cron = crypto.randomBytes(32).toString('hex');
  console.log('\n✅ CRON_TOKEN (cole no painel Vercel → Environment Variables):');
  console.log(`CRON_TOKEN=${cron}`);

  // SENHA_RECEPCAO_HASH
  console.log('\n─'.repeat(55));
  const senhaRecep = await p('\n📝 Digite a senha da RECEPÇÃO (mín. 8 chars): ');
  if (senhaRecep.length < 8) { console.log('❌ Senha muito curta'); process.exit(1); }
  const hashRecep = await bcrypt.hash(senhaRecep, 12);
  console.log('\n✅ SENHA_RECEPCAO_HASH (cole no painel Vercel):');
  console.log(`SENHA_RECEPCAO_HASH=${hashRecep}`);

  // SENHA_ADMIN_HASH
  const senhaAdmin = await p('\n📝 Digite a senha do ADMIN (mín. 8 chars): ');
  if (senhaAdmin.length < 8) { console.log('❌ Senha muito curta'); process.exit(1); }
  const hashAdmin = await bcrypt.hash(senhaAdmin, 12);
  console.log('\n✅ SENHA_ADMIN_HASH (cole no painel Vercel):');
  console.log(`SENHA_ADMIN_HASH=${hashAdmin}`);

  console.log('\n' + '═'.repeat(55));
  console.log('📋 RESUMO — cole tudo no painel Vercel → Settings → Environment Variables:');
  console.log('═'.repeat(55));
  console.log(`JWT_SECRET=${jwt}`);
  console.log(`CRON_TOKEN=${cron}`);
  console.log(`SENHA_RECEPCAO_HASH=${hashRecep}`);
  console.log(`SENHA_ADMIN_HASH=${hashAdmin}`);
  console.log('═'.repeat(55));
  console.log('\n⚠️  IMPORTANTE:');
  console.log('   1. Cole os valores acima no painel Vercel (não no .env.local em produção)');
  console.log('   2. Delete este arquivo após usar: rm gerar-tokens.js');
  console.log('   3. Nunca commite estes valores no Git\n');

  rl.close();
}

main().catch(e => { console.error(e); process.exit(1); });
