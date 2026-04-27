// api/acessos-especiais.js
//
// Gerencia usuários isentos de pagamento (funcionários, voluntários, etc.)
//
// Ações disponíveis:
//   GET  ?acao=listar              → lista todos (admin)
//   GET  ?acao=verificar&uid=UUID  → verifica se usuário tem acesso especial
//   POST ?acao=criar               → cadastra novo acesso especial (admin)
//   POST ?acao=atualizar           → edita acesso especial (admin)
//   POST ?acao=toggle              → ativa/bloqueia acesso (admin)
//   POST ?acao=excluir             → remove acesso especial (admin)

const supabase = require('../supabase');
const { autenticado } = require('../middleware/auth');

// Rótulos para exibição
const PERFIS = {
  funcionario: { label: 'Funcionário',  emoji: '👔', ocupa_vaga: false },
  voluntario:  { label: 'Voluntário',   emoji: '🤝', ocupa_vaga: false },
  parceiro:    { label: 'Parceiro',     emoji: '🤲', ocupa_vaga: false },
  convidado:   { label: 'Convidado',    emoji: '🎟️', ocupa_vaga: true  },
  pcd:         { label: 'PCD',          emoji: '♿', ocupa_vaga: true  },
  outro:       { label: 'Outro',        emoji: '⭐', ocupa_vaga: true  },
};

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const { acao, uid } = req.query;

  // ── VERIFICAR — público (chamado pelo pagamentos.js e pelo agente) ─────────
  // Verifica se um usuário tem acesso especial ativo sem precisar de auth admin
  if (req.method === 'GET' && acao === 'verificar') {
    if (!uid) return res.status(400).json({ erro: 'uid obrigatório' });

    try {
      const { data, error } = await supabase
        .from('acessos_especiais')
        .select('perfil, motivo, ocupa_vaga, validade')
        .eq('usuario_id', uid)
        .eq('ativo', true)
        .or(`validade.is.null,validade.gte.${new Date().toISOString().split('T')[0]}`)
        .maybeSingle();

      if (error) throw error;

      if (!data) {
        return res.status(200).json({ tem_acesso: false });
      }

      return res.status(200).json({
        tem_acesso:  true,
        ocupa_vaga:  data.ocupa_vaga,
        perfil:      data.perfil,
        perfil_label: PERFIS[data.perfil]?.label || data.perfil,
        emoji:       PERFIS[data.perfil]?.emoji || '⭐',
        motivo:      data.motivo,
        validade:    data.validade,
      });

    } catch (err) {
      return res.status(500).json({ erro: err.message });
    }
  }

  // ── LISTAR — somente admin ─────────────────────────────────────────────────
  if (req.method === 'GET' && acao === 'listar') {
    const auth = autenticado(req, res);
    if (!auth.ok) return;

    try {
      const { data, error } = await supabase
        .from('acessos_especiais')
        .select(`
          id, perfil, motivo, ocupa_vaga, ativo, validade, criado_em,
          usuarios!acessos_especiais_usuario_id_fkey (id, nome, cpf, email, foto_url)
        `)
        .order('criado_em', { ascending: false });

      if (error) throw error;

      const lista = (data || []).map(ae => ({
        ...ae,
        perfil_label: PERFIS[ae.perfil]?.label || ae.perfil,
        emoji:        PERFIS[ae.perfil]?.emoji || '⭐',
        nome:         ae.usuarios?.nome,
        cpf:          ae.usuarios?.cpf,
        email:        ae.usuarios?.email,
        foto_url:     ae.usuarios?.foto_url,
        expirado:     ae.validade && new Date(ae.validade) < new Date(),
      }));

      return res.status(200).json({ acessos: lista, perfis: PERFIS });

    } catch (err) {
      return res.status(500).json({ erro: err.message });
    }
  }

  // ── CRIAR — somente admin ──────────────────────────────────────────────────
  if (req.method === 'POST' && acao === 'criar') {
    const auth = autenticado(req, res);
    if (!auth.ok) return;

    const { usuario_id, perfil, motivo, validade } = req.body || {};

    if (!usuario_id) return res.status(400).json({ erro: 'usuario_id obrigatório' });
    if (!perfil || !PERFIS[perfil]) {
      return res.status(400).json({ erro: 'perfil inválido', opcoes: Object.keys(PERFIS) });
    }

    try {
      // Verifica se já existe acesso especial para este usuário
      const { data: existente } = await supabase
        .from('acessos_especiais')
        .select('id, ativo')
        .eq('usuario_id', usuario_id)
        .maybeSingle();

      if (existente) {
        return res.status(409).json({
          erro: 'Usuário já possui acesso especial cadastrado',
          id: existente.id,
          ativo: existente.ativo,
        });
      }

      // ocupa_vaga vem do perfil por padrão, mas pode ser sobrescrito
      const ocupa_vaga = req.body.ocupa_vaga !== undefined
        ? Boolean(req.body.ocupa_vaga)
        : PERFIS[perfil].ocupa_vaga;

      const { data, error } = await supabase
        .from('acessos_especiais')
        .insert({
          usuario_id,
          perfil,
          motivo:     motivo || null,
          ocupa_vaga,
          ativo:      true,
          validade:   validade || null,   // null = permanente
          criado_por: auth.usuario?.id || null,
          criado_em:  new Date().toISOString(),
          atualizado_em: new Date().toISOString(),
        })
        .select('id')
        .single();

      if (error) throw error;

      console.log(`[acessos-especiais] Criado — usuario=${usuario_id} perfil=${perfil} ocupa_vaga=${ocupa_vaga}`);
      return res.status(201).json({ ok: true, id: data.id });

    } catch (err) {
      return res.status(500).json({ erro: err.message });
    }
  }

  // ── ATUALIZAR — somente admin ──────────────────────────────────────────────
  if (req.method === 'POST' && acao === 'atualizar') {
    const auth = autenticado(req, res);
    if (!auth.ok) return;

    const { id, perfil, motivo, validade, ocupa_vaga } = req.body || {};
    if (!id) return res.status(400).json({ erro: 'id obrigatório' });

    try {
      const update = { atualizado_em: new Date().toISOString() };
      if (perfil && PERFIS[perfil]) update.perfil = perfil;
      if (motivo  !== undefined)    update.motivo  = motivo || null;
      if (validade !== undefined)   update.validade = validade || null;
      if (ocupa_vaga !== undefined) update.ocupa_vaga = Boolean(ocupa_vaga);

      const { error } = await supabase
        .from('acessos_especiais')
        .update(update)
        .eq('id', id);

      if (error) throw error;
      return res.status(200).json({ ok: true });

    } catch (err) {
      return res.status(500).json({ erro: err.message });
    }
  }

  // ── TOGGLE ativo/bloqueado — somente admin ─────────────────────────────────
  if (req.method === 'POST' && acao === 'toggle') {
    const auth = autenticado(req, res);
    if (!auth.ok) return;

    const { id } = req.body || {};
    if (!id) return res.status(400).json({ erro: 'id obrigatório' });

    try {
      const { data: atual } = await supabase
        .from('acessos_especiais')
        .select('ativo')
        .eq('id', id)
        .single();

      const novoStatus = !atual?.ativo;

      const { error } = await supabase
        .from('acessos_especiais')
        .update({ ativo: novoStatus, atualizado_em: new Date().toISOString() })
        .eq('id', id);

      if (error) throw error;

      console.log(`[acessos-especiais] Toggle id=${id} ativo=${novoStatus}`);
      return res.status(200).json({ ok: true, ativo: novoStatus });

    } catch (err) {
      return res.status(500).json({ erro: err.message });
    }
  }

  // ── EXCLUIR — somente admin ────────────────────────────────────────────────
  if (req.method === 'POST' && acao === 'excluir') {
    const auth = autenticado(req, res);
    if (!auth.ok) return;

    const { id } = req.body || {};
    if (!id) return res.status(400).json({ erro: 'id obrigatório' });

    try {
      const { error } = await supabase
        .from('acessos_especiais')
        .delete()
        .eq('id', id);

      if (error) throw error;
      return res.status(200).json({ ok: true });

    } catch (err) {
      return res.status(500).json({ erro: err.message });
    }
  }

  return res.status(405).json({ erro: 'Método ou ação não permitidos' });
};
