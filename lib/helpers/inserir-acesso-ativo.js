const supabase = require('../supabase');

/**
 * Insere um acesso ativo para o usuário, tratando corretamente a colisão
 * com o índice único acessos_usuario_ativo_unico (usuario_id WHERE status='ativo').
 *
 * Se duas chamadas concorrentes tentarem inserir ao mesmo tempo, o Postgres
 * deixa uma passar e rejeita a outra com erro 23505 (unique_violation).
 * Em vez de propagar esse erro, a chamada "perdedora" busca e retorna
 * o acesso que a chamada "vencedora" já criou — comportamento idêntico
 * para quem chamou, só que sem duplicar registro nem gerar erro 500.
 *
 * @param {object} dadosInsert - campos a inserir (usuario_id, pagamento_id, registrado_por, status: 'ativo', ...)
 * @returns {Promise<{ data: object|null, error: object|null, jaExistia: boolean }>}
 */
async function inserirAcessoAtivo(dadosInsert) {
  const { data, error } = await supabase
    .from('acessos')
    .insert(dadosInsert)
    .select()
    .single();

  if (!error) {
    return { data, error: null, jaExistia: false };
  }

  // 23505 = unique_violation — colisão pega pelo índice acessos_usuario_ativo_unico
  if (error.code === '23505') {
    const { data: existente, error: errBusca } = await supabase
      .from('acessos')
      .select('*')
      .eq('usuario_id', dadosInsert.usuario_id)
      .eq('status', 'ativo')
      .maybeSingle();

    if (existente) {
      console.warn(`[inserirAcessoAtivo] Colisão evitada pelo índice único — usuario=${dadosInsert.usuario_id}, reaproveitando acesso=${existente.id}`);
      return { data: existente, error: null, jaExistia: true };
    }
    // Caso raro: colisão detectada mas o acesso não foi encontrado
    // (pode ter sido encerrado entre o erro e esta busca)
    return { data: null, error: errBusca || error, jaExistia: true };
  }

  return { data: null, error, jaExistia: false };
}

module.exports = { inserirAcessoAtivo };
