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
const { autenticado } = require('../../middleware/auth');

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
        .select('perfil, motivo, ocupa_vaga, validade, desconto_percentual')
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
        desconto_percentual: data.desconto_percentual,
      });

    } catch (err) {
      return res.status(500).json({ erro: err.message });
    }
  }

  // ── MINHA SOLICITAÇÃO — usuário vê o status da própria solicitação ──────────
  if (req.method === 'GET' && acao === 'minha-solicitacao') {
    const auth = autenticado(req, res);
    if (!auth.ok) return;
    if (auth.payload.tipo !== 'aluno') {
      return res.status(403).json({ erro: 'Apenas usuários podem consultar solicitação própria' });
    }

    try {
      const { data, error } = await supabase
        .from('acessos_especiais')
        .select('id, perfil, motivo, status, ativo, motivo_recusa, criado_em, atualizado_em')
        .eq('usuario_id', auth.payload.id)
        .maybeSingle();

      if (error) throw error;

      if (!data) return res.status(200).json({ existe: false });

      return res.status(200).json({
        existe: true,
        status: data.status,
        ativo:  data.ativo,
        perfil: data.perfil,
        perfil_label: PERFIS[data.perfil]?.label || data.perfil,
        motivo: data.motivo,
        motivo_recusa: data.motivo_recusa,
        criado_em: data.criado_em,
        atualizado_em: data.atualizado_em,
      });
    } catch (err) {
      return res.status(500).json({ erro: err.message });
    }
  }

  // ── SOLICITAR — usuário comum pede acesso especial pra si mesmo ─────────────
  if (req.method === 'POST' && acao === 'solicitar') {
    const auth = autenticado(req, res);
    if (!auth.ok) return;
    if (auth.payload.tipo !== 'aluno') {
      return res.status(403).json({ erro: 'Apenas usuários podem solicitar acesso especial' });
    }

    const usuario_id = auth.payload.id;
    const { perfil, motivo } = req.body || {};

    if (!perfil || !PERFIS[perfil]) {
      return res.status(400).json({ erro: 'perfil inválido', opcoes: Object.keys(PERFIS) });
    }

    try {
      const { data: existente, error: errExistente } = await supabase
        .from('acessos_especiais')
        .select('id, status, ativo')
        .eq('usuario_id', usuario_id)
        .maybeSingle();

      if (errExistente) throw errExistente;

      if (existente && existente.status === 'aprovado' && existente.ativo) {
        return res.status(409).json({
          erro: 'Você já possui acesso especial ativo',
          status: existente.status,
        });
      }

      if (existente && existente.status === 'pendente') {
        return res.status(409).json({
          erro: 'Você já possui uma solicitação em análise',
          status: 'pendente',
        });
      }

      let novoId;

      if (existente) {
        const { data, error } = await supabase
          .from('acessos_especiais')
          .update({
            perfil,
            motivo:        motivo || null,
            status:        'pendente',
            ativo:         false,
            motivo_recusa: null,
            atualizado_em: new Date().toISOString(),
          })
          .eq('id', existente.id)
          .select('id')
          .single();
        if (error) throw error;
        novoId = data.id;
      } else {
        const { data, error } = await supabase
          .from('acessos_especiais')
          .insert({
            usuario_id,
            perfil,
            motivo:        motivo || null,
            status:        'pendente',
            ativo:         false,
            criado_por:    usuario_id,
            criado_em:     new Date().toISOString(),
            atualizado_em: new Date().toISOString(),
          })
          .select('id')
          .single();
        if (error) throw error;
        novoId = data.id;
      }

      console.log(`[acessos-especiais] Solicitação criada/reaberta — usuario=${usuario_id} perfil=${perfil} id=${novoId}`);

      try {
        const { enviarPushInterno } = require('../push');
        await enviarPushInterno({
          titulo: '🎟️ Nova solicitação de acesso especial',
          corpo:  `${auth.payload.nome || 'Usuário'} solicitou acesso especial (${PERFIS[perfil].label})`,
          tipo:   'aviso',
          url:    '/admin?tab=solicitacoes',
          apenasStaff: true,
        });
      } catch (errPush) {
        console.error('[acessos-especiais] erro ao notificar staff:', errPush);
      }

      return res.status(201).json({ ok: true, id: novoId, status: 'pendente' });

    } catch (err) {
      return res.status(500).json({ erro: err.message });
    }
  }

  // ── LISTAR — somente admin ─────────────────────────────────────────────────
 if (req.method === 'GET' && acao === 'listar') {
    const auth = autenticado(req, res);
    if (!auth.ok) return;
    if (auth.payload.tipo !== 'admin') {
      return res.status(403).json({ erro: 'Apenas admin pode listar acessos especiais' });
    }

    try {
      const { data, error } = await supabase
        .from('acessos_especiais')
        .select(`
          id, perfil, motivo, ocupa_vaga, ativo, validade, criado_em, status, motivo_recusa,
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
    if (auth.payload.tipo !== 'admin') {
      return res.status(403).json({ erro: 'Apenas admin pode criar acessos especiais' });
    }

    const { usuario_id, perfil, motivo, validade } = req.body || {};

    if (!usuario_id) return res.status(400).json({ erro: 'usuario_id obrigatório' });
    if (!perfil || !PERFIS[perfil]) {
      return res.status(400).json({ erro: 'perfil inválido', opcoes: Object.keys(PERFIS) });
    }

    const desconto_percentual = req.body.desconto_percentual !== undefined
      ? Number(req.body.desconto_percentual)
      : 100; // default preserva isenção total pra quem não mandar o campo
    if (isNaN(desconto_percentual) || desconto_percentual < 0 || desconto_percentual > 100) {
      return res.status(400).json({ erro: 'desconto_percentual deve estar entre 0 e 100' });
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
          desconto_percentual,
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
    if (auth.payload.tipo !== 'admin') {
      return res.status(403).json({ erro: 'Apenas admin pode atualizar acessos especiais' });
    }

    const { id, perfil, motivo, validade, ocupa_vaga } = req.body || {};
    if (!id) return res.status(400).json({ erro: 'id obrigatório' });
    if (req.body.desconto_percentual !== undefined) {
      const dp = Number(req.body.desconto_percentual);
      if (isNaN(dp) || dp < 0 || dp > 100) {
        return res.status(400).json({ erro: 'desconto_percentual deve estar entre 0 e 100' });
      }
    }
    try {
      // Busca estado atual antes de atualizar — se estava 'pendente', esse
      // atualizar representa uma APROVAÇÃO (mesmo modal, reaproveitado).
      const { data: atual, error: errAtual } = await supabase
        .from('acessos_especiais')
        .select('usuario_id, status')
        .eq('id', id)
        .maybeSingle();
      if (errAtual) throw errAtual;
      if (!atual) return res.status(404).json({ erro: 'Acesso especial não encontrado' });

      const eraAprovacaoDePendente = atual.status === 'pendente';

      const update = { atualizado_em: new Date().toISOString() };
      if (perfil && PERFIS[perfil]) update.perfil = perfil;
      if (motivo  !== undefined)    update.motivo  = motivo || null;
      if (validade !== undefined)   update.validade = validade || null;
      if (ocupa_vaga !== undefined) update.ocupa_vaga = Boolean(ocupa_vaga);
      if (req.body.desconto_percentual !== undefined) update.desconto_percentual = Number(req.body.desconto_percentual);

      if (eraAprovacaoDePendente) {
        update.status = 'aprovado';
        update.ativo  = true;
        update.motivo_recusa = null;
      }

      const { error } = await supabase
        .from('acessos_especiais')
        .update(update)
        .eq('id', id);
      if (error) throw error;

      if (eraAprovacaoDePendente) {
        console.log(`[acessos-especiais] Solicitação aprovada — id=${id} usuario=${atual.usuario_id}`);
        try {
          const { enviarPushParaUsuario } = require('../push');
          await enviarPushParaUsuario(atual.usuario_id, {
            titulo: '✅ Acesso especial aprovado',
            corpo:  'Sua solicitação de acesso especial foi aprovada!',
            tipo:   'sucesso',
            url:    '/',
          });
        } catch (errPush) {
          console.error('[acessos-especiais] erro ao notificar usuário (aprovação):', errPush);
        }
      }

      return res.status(200).json({ ok: true });
    } catch (err) {
      return res.status(500).json({ erro: err.message });
    }
  }

  // ── RECUSAR — somente admin, apenas solicitações pendentes ──────────────────
  if (req.method === 'POST' && acao === 'recusar') {
    const auth = autenticado(req, res);
    if (!auth.ok) return;
    if (auth.payload.tipo !== 'admin') {
      return res.status(403).json({ erro: 'Apenas admin pode recusar solicitações' });
    }

    const { id, motivo_recusa } = req.body || {};
    if (!id) return res.status(400).json({ erro: 'id obrigatório' });

    try {
      const { data: atual, error: errAtual } = await supabase
        .from('acessos_especiais')
        .select('usuario_id, status')
        .eq('id', id)
        .maybeSingle();
      if (errAtual) throw errAtual;
      if (!atual) return res.status(404).json({ erro: 'Acesso especial não encontrado' });
      if (atual.status !== 'pendente') {
        return res.status(409).json({ erro: 'Apenas solicitações pendentes podem ser recusadas', status: atual.status });
      }

      const { error } = await supabase
        .from('acessos_especiais')
        .update({
          status: 'recusado',
          ativo: false,
          motivo_recusa: motivo_recusa || null,
          atualizado_em: new Date().toISOString(),
        })
        .eq('id', id);
      if (error) throw error;

      console.log(`[acessos-especiais] Solicitação recusada — id=${id} usuario=${atual.usuario_id}`);

      try {
        const { enviarPushParaUsuario } = require('../push');
        await enviarPushParaUsuario(atual.usuario_id, {
          titulo: '❌ Acesso especial recusado',
          corpo:  motivo_recusa
            ? `Sua solicitação foi recusada: ${motivo_recusa}`
            : 'Sua solicitação de acesso especial foi recusada.',
          tipo:   'aviso',
          url:    '/',
        });
      } catch (errPush) {
        console.error('[acessos-especiais] erro ao notificar usuário (recusa):', errPush);
      }

      return res.status(200).json({ ok: true });
    } catch (err) {
      return res.status(500).json({ erro: err.message });
    }
  }

  // ── TOGGLE ativo/bloqueado — somente admin ─────────────────────────────────
  if (req.method === 'POST' && acao === 'toggle') {
    const auth = autenticado(req, res);
    if (!auth.ok) return;
    if (auth.payload.tipo !== 'admin') {
      return res.status(403).json({ erro: 'Apenas admin pode alterar status de acessos especiais' });
    }

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
    if (auth.payload.tipo !== 'admin') {
      return res.status(403).json({ erro: 'Apenas admin pode excluir acessos especiais' });
    }

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
module.exports.config = { api: { bodyParser: { sizeLimit: '5mb' } } };
