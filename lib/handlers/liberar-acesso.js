/**
 * /api/liberar-acesso.js
 * 
 * Chamada pelo frontend (botão "Liberar" da recepção).
 * Insere uma liberação pendente na fila — o agente local pega e aciona a catraca.
 * 
 * Coloque em: /api/liberar-acesso.js no seu projeto Vercel
 */

import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ erro: 'Método não permitido' });
  }

  // Autenticação da recepcionista (session token do Supabase)
  const token = req.headers['authorization']?.replace('Bearer ', '');
  if (!token) {
    return res.status(401).json({ erro: 'Não autenticado' });
  }

  // Valida o usuário logado
  const { data: { user }, error: authError } = await supabase.auth.getUser(token);
  if (authError || !user) {
    return res.status(401).json({ erro: 'Token inválido' });
  }

  const { usuario_id, controlid_user_id, nome } = req.body;

  if (!usuario_id || !controlid_user_id || !nome) {
    return res.status(400).json({ erro: 'usuario_id, controlid_user_id e nome são obrigatórios' });
  }

  try {
    // Verifica se já existe uma liberação pendente para este usuário
    // (evita enfileirar duplicado se a recepcionista clicar duas vezes)
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
        status:         'pendente',
        liberado_por:   user.id,
        criado_em:      new Date().toISOString(),
      })
      .select('id')
      .single();

    if (error) throw error;

    return res.status(200).json({ ok: true, id: data.id });

  } catch (err) {
    console.error('[liberar-acesso] Erro:', err.message);
    return res.status(500).json({ erro: 'Erro interno' });
  }
}
