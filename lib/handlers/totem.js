// api/totem.js
//
// POST /api/totem?acao=enviar-foto
//   body: { usuario_id, imagem }   ← imagem em base64 (data:image/jpeg;base64,...)
//   1. Valida campos
//   2. Faz upload da imagem para o Supabase Storage (bucket: fotos-usuarios)
//   3. Salva a URL pública no campo foto_url do usuário no banco
//   4. Envia a foto para o Control iD (cadastro facial para a catraca)
//   5. Salva o controlid_person_id no banco (se criado agora)
//   Retorna: { ok: true, foto_url }

const supabase = require('../lib/supabase');

// ═══════════════════════════════════════════════════════════════
//  HELPERS — SUPABASE STORAGE
// ═══════════════════════════════════════════════════════════════

/**
 * Faz upload de uma imagem base64 para o Supabase Storage.
 * Retorna a URL pública do arquivo.
 */
async function uploadFotoSupabase(usuarioId, imagemBase64) {
  // Remove o prefixo "data:image/jpeg;base64," se existir
  const base64Limpo = imagemBase64.replace(/^data:image\/\w+;base64,/, '');
  const buffer = Buffer.from(base64Limpo, 'base64');

  // Detecta extensão a partir do prefixo
  const match   = imagemBase64.match(/^data:(image\/\w+);base64,/);
  const mimeType = match ? match[1] : 'image/jpeg';
  const ext      = mimeType.split('/')[1] || 'jpg';

  const caminho = `usuarios/${usuarioId}/foto.${ext}`;

  const { error } = await supabase.storage
    .from('fotos-usuarios')
    .upload(caminho, buffer, {
      contentType: mimeType,
      upsert: true   // sobrescreve se já existir
    });

  if (error) throw new Error(`Supabase Storage: ${error.message}`);

  const { data: publicUrl } = supabase.storage
    .from('fotos-usuarios')
    .getPublicUrl(caminho);

  return publicUrl.publicUrl;
}

// ═══════════════════════════════════════════════════════════════
//  HELPERS — CONTROL iD
// ═══════════════════════════════════════════════════════════════

async function getConfig(chaves) {
  const { data } = await supabase
    .from('configuracoes')
    .select('chave, valor')
    .in('chave', Array.isArray(chaves) ? chaves : [chaves]);
  const cfg = {};
  (data || []).forEach(r => { cfg[r.chave] = r.valor; });
  return cfg;
}

/**
 * Faz login no Control iD e retorna o session token.
 */
async function controlIdLogin(baseUrl, login, senha) {
  const resp = await fetch(`${baseUrl}/login.fcgi`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({ login, password: senha }),
    signal:  AbortSignal.timeout(8000)
  });

  if (!resp.ok) {
    const txt = await resp.text().catch(() => '');
    throw new Error(`Control iD login falhou ${resp.status}: ${txt}`);
  }

  const data = await resp.json().catch(() => ({}));
  if (!data.session) throw new Error('Control iD não retornou session token');
  return data.session;
}

/**
 * Cadastra ou atualiza a pessoa no Control iD e envia a foto para o facial.
 * Retorna o person_id criado/existente no Control iD.
 */
async function cadastrarFotoControlId({ baseUrl, session, usuario, imagemBase64 }) {
  const headers = {
    'Content-Type': 'application/json',
    'Cookie':        `session=${session}`
  };

  const base64Limpo = imagemBase64.replace(/^data:image\/\w+;base64,/, '');

  // ── 1. Verifica se a pessoa já existe pelo CPF ─────────────────────────
  let personId = usuario.controlid_person_id || null;

  if (!personId) {
    // Tenta encontrar pelo CPF no Control iD
    const searchResp = await fetch(`${baseUrl}/load_objects.fcgi`, {
      method:  'POST',
      headers,
      body:    JSON.stringify({
        object: 'person',
        where:  { 'person.registration': usuario.cpf }
      }),
      signal: AbortSignal.timeout(8000)
    });

    if (searchResp.ok) {
      const searchData = await searchResp.json().catch(() => ({}));
      const pessoas    = searchData.person || [];
      if (pessoas.length > 0) personId = String(pessoas[0].id);
    }
  }

  // ── 2. Se não existe, cria a pessoa no Control iD ──────────────────────
  if (!personId) {
    const createResp = await fetch(`${baseUrl}/create_objects.fcgi`, {
      method:  'POST',
      headers,
      body:    JSON.stringify({
        object: 'person',
        values: [{
          name:         usuario.nome,
          registration: usuario.cpf,
          password:     '',    // sem PIN
          begin_time:   0,
          end_time:     0
        }]
      }),
      signal: AbortSignal.timeout(8000)
    });

    if (!createResp.ok) {
      const txt = await createResp.text().catch(() => '');
      throw new Error(`Control iD criar pessoa ${createResp.status}: ${txt}`);
    }

    const createData = await createResp.json().catch(() => ({}));
    // Control iD retorna array de IDs criados
    const ids = createData.ids || createData.id || [];
    personId  = String(Array.isArray(ids) ? ids[0] : ids);

    if (!personId || personId === 'undefined') {
      throw new Error('Control iD não retornou person_id após criação');
    }
  }

  // ── 3. Envia a foto para o reconhecimento facial ───────────────────────
  const faceResp = await fetch(`${baseUrl}/set_object_face_image.fcgi`, {
    method:  'POST',
    headers,
    body:    JSON.stringify({
      person_id: parseInt(personId, 10),
      face:      base64Limpo   // base64 puro, sem prefixo
    }),
    signal: AbortSignal.timeout(15000)
  });

  if (!faceResp.ok) {
    const txt = await faceResp.text().catch(() => '');
    // Não lança erro fatal — a foto foi salva no Storage, apenas loga
    console.warn(`[Control iD] Falha ao enviar foto facial ${faceResp.status}: ${txt}`);
    return { personId, faceCadastrada: false };
  }

  return { personId, faceCadastrada: true };
}

// ═══════════════════════════════════════════════════════════════
//  HANDLER PRINCIPAL
// ═══════════════════════════════════════════════════════════════

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin',  '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const { acao } = req.query;

  // ── POST /api/totem?acao=enviar-foto ──────────────────────────────────────
  if (req.method === 'POST' && acao === 'enviar-foto') {
    const { usuario_id, imagem } = req.body || {};

    // ── Validações ────────────────────────────────────────────────────────
    if (!usuario_id) {
      return res.status(400).json({ erro: 'usuario_id obrigatório' });
    }
    if (!imagem) {
      return res.status(400).json({ erro: 'imagem obrigatória (base64)' });
    }
    if (imagem.length > 5 * 1024 * 1024 * 1.37) {
      // base64 aumenta ~37%, então 5MB de imagem → ~6.85MB de string
      return res.status(413).json({ erro: 'Imagem muito grande. Máximo: 5 MB' });
    }

    // ── Busca o usuário no banco ──────────────────────────────────────────
    const { data: usuario, error: errUsuario } = await supabase
      .from('usuarios')
      .select('id, nome, cpf, foto_url, controlid_person_id')
      .eq('id', usuario_id)
      .maybeSingle();

    if (errUsuario || !usuario) {
      return res.status(404).json({ erro: 'Usuário não encontrado' });
    }

    // ── 1. Upload para o Supabase Storage ─────────────────────────────────
    let foto_url;
    try {
      foto_url = await uploadFotoSupabase(usuario_id, imagem);
    } catch (e) {
      console.error('[enviar-foto] Erro no Storage:', e.message);
      return res.status(500).json({ erro: `Falha ao salvar imagem: ${e.message}` });
    }

    // ── 2. Salva foto_url no banco ────────────────────────────────────────
    const { error: errUpdate } = await supabase
      .from('usuarios')
      .update({ foto_url, updated_at: new Date().toISOString() })
      .eq('id', usuario_id);

    if (errUpdate) {
      console.error('[enviar-foto] Erro ao atualizar usuário:', errUpdate.message);
      return res.status(500).json({ erro: 'Foto salva no storage mas falhou ao atualizar o banco' });
    }

    // ── 3. Integração Control iD (cadastro facial para a catraca) ─────────
    let controlIdStatus = { ok: false, motivo: 'Não configurado' };

    try {
      const cfg = await getConfig(['controlid_url', 'controlid_login', 'controlid_senha']);
      const baseUrl = (cfg.controlid_url || '').replace(/\/$/, '');

      if (!baseUrl) {
        controlIdStatus = { ok: false, motivo: 'URL do Control iD não configurada' };
      } else {
        const login = cfg.controlid_login || process.env.CONTROLID_LOGIN || 'admin';
        const senha = cfg.controlid_senha || process.env.CONTROLID_SENHA || 'admin';

        const session = await controlIdLogin(baseUrl, login, senha);

        const { personId, faceCadastrada } = await cadastrarFotoControlId({
          baseUrl,
          session,
          usuario,
          imagemBase64: imagem
        });

        // Salva/atualiza o person_id do Control iD no banco
        if (personId && personId !== usuario.controlid_person_id) {
          await supabase
            .from('usuarios')
            .update({ controlid_person_id: personId })
            .eq('id', usuario_id);
        }

        controlIdStatus = {
          ok:              true,
          person_id:       personId,
          face_cadastrada: faceCadastrada
        };
      }
    } catch (e) {
      // Não bloqueia — foto já foi salva. Control iD pode ser retentado depois.
      console.warn('[enviar-foto] Control iD:', e.message);
      controlIdStatus = { ok: false, motivo: e.message };
    }

    console.log(`[enviar-foto] usuário=${usuario_id} foto_url=${foto_url} controlId=${JSON.stringify(controlIdStatus)}`);

    return res.status(200).json({
      ok:        true,
      foto_url,
      control_id: controlIdStatus
    });
  }

  // ── Método/ação não reconhecido ───────────────────────────────────────────
  return res.status(404).json({ erro: 'Ação não encontrada' });
};
