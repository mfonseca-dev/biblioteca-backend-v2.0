/**
 * /api/agente/fila.js
 * 
 * Rota da Vercel consultada pelo agente local a cada 3 segundos.
 * Retorna as liberações pendentes (status = 'pendente').
 * 
 * Coloque este arquivo em: /api/agente/fila.js no seu projeto Vercel
 */

import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY  // service_role key (nunca exposta ao browser)
);

const AGENT_SECRET = process.env.AGENT_SECRET; // mesma chave do agente.js

export default async function handler(req, res) {
  // Só aceita GET
  if (req.method !== 'GET') {
    return res.status(405).json({ erro: 'Método não permitido' });
  }

  // Valida o secret do agente
  const secret = req.headers['x-agent-secret'];
  if (!secret || secret !== AGENT_SECRET) {
    return res.status(401).json({ erro: 'Não autorizado' });
  }

  try {
    // Busca liberações com status 'pendente'
    // Tabela: liberacoes_catraca
    const { data, error } = await supabase
      .from('liberacoes_catraca')
      .select('id, usuario_id, controlid_user_id, nome, criado_em')
      .eq('status', 'pendente')
      .order('criado_em', { ascending: true })
      .limit(10); // processa no máximo 10 por ciclo

    if (error) throw error;

    return res.status(200).json({ pendentes: data || [] });

  } catch (err) {
    console.error('[fila] Erro:', err.message);
    return res.status(500).json({ erro: 'Erro interno', pendentes: [] });
  }
}
