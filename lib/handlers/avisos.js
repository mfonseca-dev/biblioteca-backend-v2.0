// api/avisos.js
// GET  /api/avisos         → lista avisos ativos (público)
// POST /api/avisos         → cria aviso (admin)
// PUT  /api/avisos         → edita/arquiva aviso (admin)  body: { id, ...campos }
// DELETE /api/avisos       → remove aviso (admin)         body: { id }

const supabase = require('../supabase');
const { autenticado, soAdmin } = require('../../middleware/auth');

module.exports = async function handler(req, res) {
  // ── CORS restrito ────────────────────────────────────────────
const _ORIGENS_PERMITIDAS = (process.env.FRONTEND_URL || 'https://biblioteca-backend-v2-0.vercel.app').split(',').map(o => o.trim());
const _origem = req.headers.origin || '';
res.setHeader('Access-Control-Allow-Origin', _ORIGENS_PERMITIDAS.includes(_origem) ? _origem : _ORIGENS_PERMITIDAS[0]);
res.setHeader('Vary', 'Origin');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  res.setHeader('Permissions-Policy', 'camera=(self), microphone=(), geolocation=()');
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();

  // GET — público
  if (req.method === 'GET') {
    const { data, error } = await supabase
      .from('avisos')
      .select('id, titulo, conteudo, tipo, ativo, created_at')
      .eq('ativo', true)
      .order('created_at', { ascending: false })
      .limit(50);
    if (error) return res.status(500).json({ erro: 'Erro interno' });
    return res.status(200).json({ avisos: data || [] });
  }

  // POST — admin
  if (req.method === 'POST') {
    const auth = soAdmin(req, res);
    if (!auth.ok) return;

    const { titulo, conteudo, tipo = 'info' } = req.body || {};
    if (!titulo || !conteudo) return res.status(400).json({ erro: 'titulo e conteudo são obrigatórios' });

    const { data, error } = await supabase
      .from('avisos').insert({ titulo, conteudo, tipo, ativo: true }).select().single();
    if (error) return res.status(500).json({ erro: 'Erro ao criar aviso' });
    return res.status(201).json({ mensagem: 'Aviso criado', aviso: data });
  }

  // PUT — admin
  if (req.method === 'PUT') {
    const auth = soAdmin(req, res);
    if (!auth.ok) return;

    const { id, ...campos } = req.body || {};
    if (!id) return res.status(400).json({ erro: 'id é obrigatório' });

    const { data, error } = await supabase
      .from('avisos').update({ ...campos, updated_at: new Date().toISOString() })
      .eq('id', id).select().single();
    if (error || !data) return res.status(404).json({ erro: 'Aviso não encontrado' });
    return res.status(200).json({ mensagem: 'Aviso atualizado', aviso: data });
  }

  // DELETE — admin
  if (req.method === 'DELETE') {
    const auth = soAdmin(req, res);
    if (!auth.ok) return;

    const { id } = req.body || {};
    if (!id) return res.status(400).json({ erro: 'id é obrigatório' });

    await supabase.from('avisos').delete().eq('id', id);
    return res.status(200).json({ mensagem: 'Aviso removido' });
  }

  return res.status(405).json({ erro: 'Método não permitido' });
};
module.exports.config = { api: { bodyParser: { sizeLimit: '5mb' } } };
