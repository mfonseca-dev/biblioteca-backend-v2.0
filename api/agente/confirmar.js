/**
 * /api/agente/confirmar.js
 * 
 * Chamada pelo agente após acionar (ou tentar acionar) a catraca.
 * Atualiza o status da liberação para 'executado' ou 'falhou'.
 * 
 * Coloque em: /api/agente/confirmar.js no seu projeto Vercel
 */

import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

const AGENT_SECRET = process.env.AGENT_SECRET;

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ erro: 'Método não permitido' });
  }

  const secret = req.headers['x-agent-secret'];
  if (!secret || secret !== AGENT_SECRET) {
    return res.status(401).json({ erro: 'Não autorizado' });
  }

  const { id, sucesso } = req.body;

  if (!id) {
    return res.status(400).json({ erro: 'id obrigatório' });
  }

  try {
    const { error } = await supabase
      .from('liberacoes_catraca')
      .update({
        status:       sucesso ? 'executado' : 'falhou',
        executado_em: new Date().toISOString(),
      })
      .eq('id', id);

    if (error) throw error;

    return res.status(200).json({ ok: true });

  } catch (err) {
    console.error('[confirmar] Erro:', err.message);
    return res.status(500).json({ erro: 'Erro interno' });
  }
}
