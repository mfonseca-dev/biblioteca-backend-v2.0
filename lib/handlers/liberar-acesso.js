// lib/handlers/liberar-acesso.js
//
// Chamada pelo frontend (botão "Liberar" da recepção).
// Insere uma liberação pendente na fila — o agente local pega e aciona a catraca.

const supabase = require('../supabase');

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();

  if (req.method !== 'POST') {
    return res.status(405).json({ erro: 'Método não permitido' });
  }

 // Autenticação via JWT próprio
const { autenticado } = require('../../middleware/auth');
const auth = autenticado(req, res);
if (!auth.ok) return;

  const { usuario_id, controlid_user_id, nome } = req.body || {};
  if (!usuario_id || !controlid_user_id || !nome) {
    return res.status(400).json({ erro: 'usuario_id, controlid_user_id e nome são obrigatórios' });
  }

  try {
    // Verifica se já existe liberação pendente (evita duplicata)
    const { data: existente } = await supabase
      .from('liberacoes_catraca')
      .select('id')
      .eq('usuario_id', usuario_id)
      .eq('status', 'pendente')
      .maybeSingle();

    if (existente) {
      return res.status(200).json({ ok: true, msg: 'Já na fila', id: existente.id });
    }

    // Enfileira a liberação
    const { data, error } = await supabase
      .from('liberacoes_catraca')
      .insert({
        usuario_id,
        controlid_user_id,
        nome,
        status:       'pendente',
        liberado_por: user.id,
        criado_em:    new Date().toISOString(),
      })
      .select('id')
      .single();

    if (error) throw error;

    return res.status(200).json({ ok: true, id: data.id });

  } catch (err) {
    console.error('[liberar-acesso] Erro:', err.message);
    return res.status(500).json({ erro: 'Erro interno' });
  }
};
