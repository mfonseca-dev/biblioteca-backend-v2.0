// lib/helpers/contar-vagas.js
//
// Conta vagas ocupadas = acessos com status 'ativo' + acessos 'encerrado'
// ainda dentro da janela de garantia (vaga_garantida_ate > agora).
// Usar esta função em TODO lugar que precisa saber quantas vagas
// estão ocupadas — nunca contar só status='ativo' isoladamente,
// senão quem está em garantia (saiu pela catraca, ainda pode voltar
// sem pagar de novo) fica invisível na contagem e permite overbooking.

const supabase = require('../supabase');

async function contarOcupadas() {
  const agora = new Date().toISOString();

  const [ativosResult, garantidosResult] = await Promise.all([
    supabase
      .from('acessos')
      .select('*', { count: 'exact', head: true })
      .eq('status', 'ativo'),
    supabase
      .from('acessos')
      .select('*', { count: 'exact', head: true })
      .eq('status', 'encerrado')
      .not('vaga_garantida_ate', 'is', null)
      .gt('vaga_garantida_ate', agora),
  ]);

  if (ativosResult.error) throw ativosResult.error;
  if (garantidosResult.error) throw garantidosResult.error;

  return (ativosResult.count || 0) + (garantidosResult.count || 0);
}

module.exports = { contarOcupadas };