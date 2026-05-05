// lib/handlers/liberar-acesso.js
//
// Chamada pelo frontend (acesso especial ou botão da recepção).
// 1. Busca foto e controlid_person_id do usuário
// 2. Enfileira liberação da catraca (com foto para o agente cadastrar no iDFace)
// 3. Registra acesso no banco (para contabilizar vaga)

const supabase        = require('../supabase');
const { autenticado } = require('../../middleware/auth');

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();

  if (req.method !== 'POST') {
    return res.status(405).json({ erro: 'Método não permitido' });
  }

  const auth = autenticado(req, res);
  if (!auth.ok) return;

  const { usuario_id, nome } = req.body || {};

  if (!usuario_id || !nome) {
    return res.status(400).json({ erro: 'usuario_id e nome são obrigatórios' });
  }

  try {
    // 1. Busca foto e controlid_person_id do usuário no banco
    const { data: usuario } = await supabase
      .from('usuarios')
      .select('foto_url, controlid_person_id')
      .eq('id', usuario_id)
      .maybeSingle();

    const foto_url            = usuario?.foto_url            || null;
    const controlid_person_id = usuario?.controlid_person_id || null;
    const controlid_user_id   = req.body?.controlid_user_id
                                || (controlid_person_id ? parseInt(controlid_person_id, 10) : 0);

    // 2. Verifica se já existe liberação pendente (evita duplicata na fila)
    const { data: existente } = await supabase
      .from('liberacoes_catraca')
      .select('id')
      .eq('usuario_id', usuario_id)
      .eq('status', 'pendente')
      .maybeSingle();

    if (!existente) {
      // Enfileira com foto e controlid_user_id para o agente cadastrar no iDFace
      const { error: errFila } = await supabase
        .from('liberacoes_catraca')
        .insert({
          usuario_id,
          controlid_user_id,
          nome,
          foto_url,             // ← agente usa para cadastrar face no iDFace
          status:    'pendente',
          criado_em: new Date().toISOString(),
        });

      if (errFila) throw errFila;
    }

    // 3. Registra acesso no banco se não existir hoje (para contabilizar vaga)
    const hoje = new Date();
    hoje.setHours(0, 0, 0, 0);

    const { data: acessoExiste } = await supabase
      .from('acessos')
      .select('id')
      .eq('usuario_id', usuario_id)
      .eq('status', 'ativo')
      .gte('entrada_em', hoje.toISOString())
      .maybeSingle();

    if (!acessoExiste) {
      await supabase
        .from('acessos')
        .insert({
          usuario_id,
          registrado_por: 'acesso_especial',
          status:         'ativo',
          entrada_em:     new Date().toISOString(),
        });
    }

    return res.status(200).json({ ok: true });

  } catch (err) {
    console.error('[liberar-acesso] Erro:', err.message);
    return res.status(500).json({ erro: 'Erro interno' });
  }
};
