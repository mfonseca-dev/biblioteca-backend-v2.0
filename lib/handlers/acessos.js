// lib/handlers/acessos.js
//
// ROTAS:
//   GET  /api/acessos?acao=listar             → lista acessos por data/status (auth)
//   GET  /api/acessos?acao=historico-usuario  → histórico pessoal do usuário (público — app)
//   GET  /api/acessos?acao=vagas              → vagas livres/ocupadas (público)
//   POST /api/acessos?acao=registrar          → registra entrada manual (auth recepção)
//   POST /api/acessos?acao=encerrar           → registra saída (auth recepção)
//   POST /api/acessos?acao=registrar-saida    → alias de encerrar (app cliente)
//   POST /api/acessos?acao=reset-diario       → encerra todos os acessos ativos do dia (cron/admin)

const supabase = require("../supabase");
const { inserirAcessoAtivo } = require("../helpers/inserir-acesso-ativo");
const { autenticado } = require("../../middleware/auth");

module.exports = async function handler(req, res) {
  // ── CORS restrito ────────────────────────────────────────────
  const _ORIGENS_PERMITIDAS = (
    process.env.FRONTEND_URL || "https://biblioteca-backend-v2-0.vercel.app"
  )
    .split(",")
    .map((o) => o.trim());
  const _origem = req.headers.origin || "";
  res.setHeader(
    "Access-Control-Allow-Origin",
    _ORIGENS_PERMITIDAS.includes(_origem) ? _origem : _ORIGENS_PERMITIDAS[0],
  );
  res.setHeader("Vary", "Origin");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  res.setHeader(
    "Strict-Transport-Security",
    "max-age=31536000; includeSubDomains",
  );
  res.setHeader(
    "Permissions-Policy",
    "camera=(self), microphone=(), geolocation=()",
  );
  res.setHeader("Cross-Origin-Opener-Policy", "same-origin");
  res.setHeader("Cross-Origin-Resource-Policy", "same-origin");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  if (req.method === "OPTIONS") return res.status(200).end();

  const acao = req.query.acao;

  // ─────────────────────────────────────────────────────────────
  // 📊 VAGAS — público (app, totem, qualquer tela)
  // ─────────────────────────────────────────────────────────────
  if (req.method === "GET" && acao === "vagas") {
    try {
      const { data: cfg } = await supabase
        .from("configuracoes")
        .select("valor")
        .eq("chave", "total_vagas")
        .single();

      const total = parseInt(cfg?.valor || "30", 10);

      const { count: ocupadas } = await supabase
        .from("acessos")
        .select("*", { count: "exact", head: true })
        .eq("status", "ativo");

      const livres = Math.max(0, total - (ocupadas || 0));

      return res.status(200).json({
        total,
        ocupadas: ocupadas || 0,
        livres,
        lotado: livres === 0,
      });
    } catch (e) {
      console.error("[vagas]", e);
      return res.status(500).json({ erro: "Erro interno" });
    }
  }

  // ─────────────────────────────────────────────────────────────
  // 👤 MEU ACESSO — público (app do usuário)
  //    Retorna o acesso ativo do próprio usuário hoje
  // ─────────────────────────────────────────────────────────────
  if (req.method === "GET" && acao === "meu") {
    try {
      const { usuario_id } = req.query;
      if (!usuario_id)
        return res.status(400).json({ erro: "usuario_id obrigatório" });

      const hoje = new Date();
      hoje.setHours(0, 0, 0, 0);

      const { data, error } = await supabase
        .from("acessos")
        .select(
          `
          id, status, entrada_em, saida_em, registrado_por,
          pagamentos ( id, tipo, valor, status, confirmado_em )
        `,
        )
        .eq("usuario_id", usuario_id)
        .eq("status", "ativo")
        .gte("entrada_em", hoje.toISOString())
        .maybeSingle();

  if (error) {
        console.error("[meu]", error);
        return res.status(500).json({ erro: "Erro interno" });
      }
      // Sem acesso ativo? Verifica se existe garantia de vaga em andamento
      // (usuário saiu recentemente e ainda está dentro da janela de retorno,
      // seja pela garantia automática ou por ter travado manualmente).
      let garantia = null;
      if (!data) {
        const agora = new Date().toISOString();
        const { data: acessoGarantido, error: errGarantia } = await supabase
          .from("acessos")
          .select("id, saida_em, vaga_garantida_ate, trava_manual")
          .eq("usuario_id", usuario_id)
          .eq("status", "encerrado")
          .not("vaga_garantida_ate", "is", null)
          .gt("vaga_garantida_ate", agora)
          .order("saida_em", { ascending: false })
          .limit(1)
          .maybeSingle();
        if (errGarantia) {
          console.error("[meu][garantia]", errGarantia);
        } else {
          garantia = acessoGarantido || null;
        }
      }
      return res.status(200).json({ acesso: data || null, garantia });
    } catch (e) {
      console.error("[meu]", e);
      return res.status(500).json({ erro: "Erro interno" });
    }
  }

  // ─────────────────────────────────────────────────────────────
  // 📋 HISTÓRICO PESSOAL — público (app do usuário)
  //    Retorna apenas os acessos do próprio usuário.
  //    Não exige token — o usuario_id é passado via query string.
  //    Os dados retornados são apenas do próprio usuário, sem exposição
  //    de dados de terceiros.
  // ─────────────────────────────────────────────────────────────
  if (req.method === "GET" && acao === "historico-usuario") {
    try {
      const { usuario_id } = req.query;
      if (!usuario_id)
        return res.status(400).json({ erro: "usuario_id obrigatório" });

      // Busca até 60 acessos mais recentes do usuário
      const { data, error } = await supabase
        .from("acessos")
        .select(
          `
          id, status, entrada_em, saida_em, registrado_por,
          pagamentos ( id, tipo, valor, status, confirmado_em )
        `,
        )
        .eq("usuario_id", usuario_id)
        .order("entrada_em", { ascending: false })
        .limit(60);

      if (error) {
        console.error("[historico-usuario]", error);
        return res.status(500).json({ erro: "Erro interno" });
      }

      // Estatísticas agregadas
      const acessos = data || [];
      const inicioMes = new Date();
      inicioMes.setDate(1);
      inicioMes.setHours(0, 0, 0, 0);

      const doMes = acessos.filter((a) => new Date(a.entrada_em) >= inicioMes);

      let horasTotal = 0;
      acessos.forEach((a) => {
        if (a.saida_em) {
          horasTotal +=
            (new Date(a.saida_em) - new Date(a.entrada_em)) / 3600000;
        }
      });

      return res.status(200).json({
        acessos,
        stats: {
          total: acessos.length,
          mes: doMes.length,
          horas_total: Math.round(horasTotal),
        },
      });
    } catch (e) {
      console.error("[historico-usuario]", e);
      return res.status(500).json({ erro: "Erro interno" });
    }
  }

// ─────────────────────────────────────────────────────────────
  // 📋 LISTAR ACESSOS — auth (recepção/admin)
  // ─────────────────────────────────────────────────────────────
  if (req.method === "GET" && acao === "listar") {
    const auth = autenticado(req, res);
    if (!auth.ok) return;
    if (auth.payload.tipo !== "admin" && auth.payload.tipo !== "recepcao") {
      return res.status(403).json({ erro: "Apenas staff pode listar acessos" });
    }
    try {
      const { data: dataFiltro, status } = req.query;

      // ── status=ocupando: usado pelo painel de "quem está aqui agora".
      // Não inclui foto (não é necessária nessa visualização e deixa a
      // resposta pesada — foto continua disponível em /api/usuarios?acao=buscar
      // para telas de perfil/documentos). Duas queries separadas em vez de
      // .or() combinado, que se mostrou instável com filtros de timestamp.
      if (status === "ocupando") {
        const agora = new Date().toISOString();

        const [ativosResult, garantidosResult] = await Promise.all([
          supabase
            .from("acessos")
            .select(`
              id, status, entrada_em, saida_em, registrado_por, motivo_saida, vaga_garantida_ate,
              usuarios ( id, nome, cpf )
            `)
            .eq("status", "ativo"),
          supabase
            .from("acessos")
            .select(`
              id, status, entrada_em, saida_em, registrado_por, motivo_saida, vaga_garantida_ate,
              usuarios ( id, nome, cpf )
            `)
            .eq("status", "encerrado")
            .gt("vaga_garantida_ate", agora),
        ]);

        if (ativosResult.error || garantidosResult.error) {
          const err = ativosResult.error || garantidosResult.error;
          console.error("[listar/ocupando]", err);
          return res.status(500).json({ erro: "Erro interno" });
        }

        // Combina os dois grupos e ordena por horário de entrada mais
        // recente primeiro, misturando ativos e garantidos numa única
        // lista cronológica (mais intuitivo para acompanhar o fluxo do dia).
        const acessos = [...(ativosResult.data || []), ...(garantidosResult.data || [])]
          .sort((a, b) => new Date(b.entrada_em) - new Date(a.entrada_em));

        return res.status(200).json({ acessos, total: acessos.length });
      }

      // ── Demais filtros (histórico, por status específico, por data) —
      // comportamento original, com foto incluída (usado em telas que
      // precisam conferir identidade, ex.: aprovação de cadastro).
      let query = supabase
        .from("acessos")
        .select(
          `
          id, status, entrada_em, saida_em, registrado_por, motivo_saida, vaga_garantida_ate,
          usuarios ( id, nome, cpf, foto_url ),
          pagamentos ( id, tipo, valor, status )
        `,
        )
        .order("entrada_em", { ascending: false })
        .limit(200);

      if (dataFiltro) {
        const inicio = new Date(dataFiltro);
        inicio.setHours(0, 0, 0, 0);
        const fim = new Date(dataFiltro);
        fim.setHours(23, 59, 59, 999);
        query = query
          .gte("entrada_em", inicio.toISOString())
          .lte("entrada_em", fim.toISOString());
      }
      if (status) query = query.eq("status", status);

      const { data, error } = await query;
      if (error) {
        console.error("[listar]", error);
        return res.status(500).json({ erro: "Erro interno" });
      }
      return res
        .status(200)
        .json({ acessos: data || [], total: data?.length || 0 });
    } catch (e) {
      console.error("[listar]", e);
      return res.status(500).json({ erro: "Erro interno" });
    }
  }
// ─────────────────────────────────────────────────────────────
  // 🚏 EVENTO CATRACA — recebe eventos físicos processados pelo
  //    agente (poller de access_logs do iDFace). Idempotente:
  //    ignora eventos que não mudam o estado (ex: entrada já ativa).
  //    Saída física SEMPRE gera garantia de vaga (nunca forfeit —
  //    forfeit é exclusivo do botão "Sair e Liberar Vaga" no app).
  // ─────────────────────────────────────────────────────────────
  if (req.method === "POST" && acao === "evento-catraca") {
    const secretCatraca = req.headers["x-agent-secret"];
    if (!secretCatraca || secretCatraca !== process.env.AGENT_SECRET) {
      return res.status(401).json({ erro: "Não autorizado" });
    }

    const { eventos } = req.body || {};
    if (!Array.isArray(eventos) || !eventos.length) {
      return res.status(400).json({ erro: "eventos (array) obrigatório" });
    }

    const resultado = { processados: 0, entradas: 0, saidas: 0, ja_atualizados: 0, nao_identificados: 0 };

    try {
      // Processa em ordem crescente de log_id, para respeitar a sequência real
      const ordenados = [...eventos].sort((a, b) => a.log_id - b.log_id);

      for (const ev of ordenados) {
        const direcao = ev.portal?.includes("ENTRADA")
          ? "entrada"
          : ev.portal?.includes("Saida") || ev.portal?.includes("Saída")
          ? "saida"
          : "desconhecida";

        const semUsuario = !ev.controlid_user_id || ev.controlid_user_id === 0;

        if (semUsuario || direcao === "desconhecida") {
          await supabase.from("eventos_catraca_nao_identificados").upsert(
            {
              idface_log_id: ev.log_id,
              idface_time: ev.time,
              idface_user_id: ev.controlid_user_id || null,
              idface_user_name: ev.nome_dispositivo || null,
              portal: ev.portal || null,
              motivo: semUsuario ? "sem_usuario_identificado" : "direcao_desconhecida",
            },
            { onConflict: "idface_log_id" },
          );
          resultado.nao_identificados++;
          resultado.processados++;
          continue;
        }

        const { data: usuario } = await supabase
          .from("usuarios")
          .select("id, nome")
          .eq("controlid_person_id", String(ev.controlid_user_id))
          .maybeSingle();

        if (!usuario) {
          await supabase.from("eventos_catraca_nao_identificados").upsert(
            {
              idface_log_id: ev.log_id,
              idface_time: ev.time,
              idface_user_id: ev.controlid_user_id,
              idface_user_name: ev.nome_dispositivo || null,
              portal: ev.portal || null,
              motivo: "sem_usuario_correspondente_no_banco",
            },
            { onConflict: "idface_log_id" },
          );
          resultado.nao_identificados++;
          resultado.processados++;
          continue;
        }

        const horaEvento = new Date(ev.time * 1000).toISOString();

        if (direcao === "entrada") {
          // Idempotência: já está ativo? não faz nada.
          const { data: jaAtivo } = await supabase
            .from("acessos")
            .select("id")
            .eq("usuario_id", usuario.id)
            .eq("status", "ativo")
            .maybeSingle();

          if (jaAtivo) {
            resultado.ja_atualizados++;
            resultado.processados++;
            continue;
          }

          // Retorno dentro da janela de garantia? Reativa o mesmo acesso.
          const { data: garantido } = await supabase
            .from("acessos")
            .select("id")
            .eq("usuario_id", usuario.id)
            .eq("status", "encerrado")
            .not("vaga_garantida_ate", "is", null)
            .gt("vaga_garantida_ate", horaEvento)
            .order("saida_em", { ascending: false })
            .limit(1)
            .maybeSingle();

          if (garantido) {
            await supabase
              .from("acessos")
              .update({ status: "ativo", saida_em: null, vaga_garantida_ate: null, motivo_saida: null })
              .eq("id", garantido.id);
            resultado.entradas++;
            resultado.processados++;
            continue;
          }

          // Nenhum acesso ativo nem garantido — entrada sem vínculo claro
          // com um pagamento/liberação em aberto. Não cria acesso novo
          // automaticamente (evita ocupar vaga sem rastro de pagamento);
          // fica registrado para revisão do staff.
          await supabase.from("eventos_catraca_nao_identificados").upsert(
            {
              idface_log_id: ev.log_id,
              idface_time: ev.time,
              idface_user_id: ev.controlid_user_id,
              idface_user_name: usuario.nome,
              portal: ev.portal || null,
              motivo: "entrada_sem_acesso_ativo_ou_garantido",
            },
            { onConflict: "idface_log_id" },
          );
          resultado.nao_identificados++;
          resultado.processados++;
          continue;
        }

        if (direcao === "saida") {
          const { data: ativo } = await supabase
            .from("acessos")
            .select("id")
            .eq("usuario_id", usuario.id)
            .eq("status", "ativo")
            .maybeSingle();

          if (!ativo) {
            // Saída sem entrada ativa correspondente (já processada antes,
            // ou entrada nunca registrada) — idempotência: ignora.
            resultado.ja_atualizados++;
            resultado.processados++;
            continue;
          }

          const { data: cfgTrava } = await supabase
            .from("configuracoes")
            .select("valor")
            .eq("chave", "trava_vaga_automatica_minutos")
            .maybeSingle();
          const travaMinutos = parseInt(cfgTrava?.valor || "60", 10);
          const vagaGarantidaAte = new Date(
            new Date(horaEvento).getTime() + travaMinutos * 60000,
          ).toISOString();

          await supabase
            .from("acessos")
            .update({
              status: "encerrado",
              saida_em: horaEvento,
              motivo_saida: "catraca_fisica",
              vaga_garantida_ate: vagaGarantidaAte,
            })
            .eq("id", ativo.id);

          resultado.saidas++;
          resultado.processados++;
        }
      }

      return res.status(200).json({ mensagem: "Eventos processados", ...resultado });
    } catch (e) {
      console.error("[evento-catraca]", e);
      return res.status(500).json({ erro: "Erro interno", detalhe: e.message, ...resultado });
    }
  }
  // ─────────────────────────────────────────────────────────────
  // ✅ REGISTRAR ENTRADA MANUAL — auth recepção
  // ─────────────────────────────────────────────────────────────
  if (req.method === "POST" && acao === "registrar") {
    const auth = autenticado(req, res);
    if (!auth.ok) return;

    if (auth.payload.tipo !== "admin" && auth.payload.tipo !== "recepcao") {
      return res
        .status(403)
        .json({ erro: "Apenas staff pode registrar entrada manual" });
    }

    try {
      const { usuario_id, pagamento_id } = req.body || {};
      if (!usuario_id)
        return res.status(400).json({ erro: "usuario_id obrigatório" });

      // Verifica se já tem acesso ativo hoje
      const hoje = new Date();
      hoje.setHours(0, 0, 0, 0);
      const { data: jaExiste } = await supabase
        .from("acessos")
        .select("id")
        .eq("usuario_id", usuario_id)
        .eq("status", "ativo")
        .gte("entrada_em", hoje.toISOString())
        .maybeSingle();

      if (jaExiste) {
        return res
          .status(409)
          .json({ erro: "Usuário já possui acesso ativo hoje" });
      }

      // Verifica vagas
      const { data: cfg } = await supabase
        .from("configuracoes")
        .select("valor")
        .eq("chave", "total_vagas")
        .single();
      const total = parseInt(cfg?.valor || "30", 10);
      const { count: ocupadas } = await supabase
        .from("acessos")
        .select("*", { count: "exact", head: true })
        .eq("status", "ativo");

      if ((ocupadas || 0) >= total) {
        return res
          .status(409)
          .json({ erro: "Sala lotada — não há vagas disponíveis" });
      }

      const { data, error } = await inserirAcessoAtivo({
        usuario_id,
        pagamento_id: pagamento_id || null,
        registrado_por: "recepcao",
        status: "ativo",
      });

      if (error)
        return res.status(500).json({ erro: "Erro ao registrar acesso" });

      return res
        .status(201)
        .json({ mensagem: "Entrada registrada!", acesso: data });
    } catch (e) {
      console.error("[registrar]", e);
      return res.status(500).json({ erro: "Erro interno" });
    }
  }

  // ─────────────────────────────────────────────────────────────
  // 🚪 ENCERRAR ACESSO (saída) — auth recepção
  // ─────────────────────────────────────────────────────────────
  if (
    req.method === "POST" &&
    (acao === "encerrar" || acao === "registrar-saida")
  ) {
    const auth = autenticado(req, res);
    if (!auth.ok) return;
    try {
      const { acesso_id, usuario_id, revogar_imediato } = req.body || {};
      if (!acesso_id && !usuario_id) {
        return res
          .status(400)
          .json({ erro: "acesso_id ou usuario_id obrigatório" });
      }

      const ehStaff =
        auth.payload.tipo === "admin" || auth.payload.tipo === "recepcao";
      const motivoSaida = ehStaff ? "recepcao" : "usuario";

      // Revogação imediata (sem trava de vaga) quando:
      // - o próprio usuário saiu voluntariamente (motivoSaida === 'usuario'), ou
      // - staff pediu explicitamente via revogar_imediato (ex.: disciplina, erro de cadastro)
      const revogarNaHora =
        motivoSaida === "usuario" || (ehStaff && revogar_imediato === true);

      let vagaGarantidaAte = null;
      if (!revogarNaHora) {
        // Lê o tempo de garantia automática de vaga (padrão 60min se não configurado)
        const { data: cfgTrava } = await supabase
          .from("configuracoes")
          .select("valor")
          .eq("chave", "trava_vaga_automatica_minutos")
          .maybeSingle();
        const travaMinutos = parseInt(cfgTrava?.valor || "60", 10);
        vagaGarantidaAte = new Date(
          Date.now() + travaMinutos * 60000,
        ).toISOString();
      }

      let query = supabase
        .from("acessos")
        .update({
          status: "encerrado",
          saida_em: new Date().toISOString(),
          motivo_saida: motivoSaida,
          vaga_garantida_ate: vagaGarantidaAte,
        })
        .eq("status", "ativo");
      if (acesso_id) {
        query = query.eq("id", acesso_id);
      } else {
        query = query.eq("usuario_id", usuario_id);
      }
      const { data, error } = await query.select().maybeSingle();
      if (error) {
        console.error("[encerrar]", error);
        return res.status(500).json({ erro: "Erro interno" });
      }
      if (!data)
        return res.status(404).json({ erro: "Acesso ativo não encontrado" });

      if (revogarNaHora) {
        // Revogação imediata: enfileira 'revogar' para o agente remover o facial agora,
        // sem esperar o cron 'processar-garantias'.
        const { data: usuarioInfo } = await supabase
          .from("usuarios")
          .select("nome, controlid_person_id")
          .eq("id", data.usuario_id)
          .maybeSingle();
        const controlidUserId = usuarioInfo?.controlid_person_id
          ? parseInt(usuarioInfo.controlid_person_id, 10)
          : 0;
        if (controlidUserId) {
          const { error: errFila } = await supabase
            .from("liberacoes_catraca")
            .insert({
              usuario_id: data.usuario_id,
              controlid_user_id: controlidUserId,
              nome: usuarioInfo?.nome || null,
              acao: "revogar",
              status: "pendente",
              criado_em: new Date().toISOString(),
            });
          if (errFila)
            console.error(
              "[encerrar] Erro ao enfileirar revogação imediata:",
              errFila,
            );
        } else {
          console.warn(
            "[encerrar] Revogação imediata pulada — usuario sem controlid_person_id:",
            data.usuario_id,
          );
        }
      }
      // Nota: quando NÃO é revogação imediata, o facial permanece ativo até
      // vaga_garantida_ate expirar sem retorno — processado pelo cron
      // 'acao=processar-garantias' (ainda a implementar).
      return res.status(200).json({
        mensagem: "Saída registrada!",
        acesso: data,
        vaga_garantida_ate: vagaGarantidaAte,
        revogado_imediatamente: revogarNaHora,
      });
    } catch (e) {
      console.error("[encerrar]", e);
      return res.status(500).json({ erro: "Erro interno" });
    }
  }

  // ─────────────────────────────────────────────────────────────
  // 🔒 TRAVAR VAGA — usuário estende a garantia de vaga por mais tempo
  //    (ex.: precisa resolver algo fora, mas não quer perder o lugar).
  //    Só funciona enquanto a garantia automática de 1h ainda não
  //    expirou — depois disso a vaga já foi liberada e o facial revogado.
  // ─────────────────────────────────────────────────────────────
  if (req.method === "POST" && acao === "travar-vaga") {
    const auth = autenticado(req, res);
    if (!auth.ok) return;

    try {
      const ehStaff =
        auth.payload.tipo === "admin" || auth.payload.tipo === "recepcao";
      const { usuario_id: usuarioIdBody } = req.body || {};

      // Staff pode travar em nome de outro usuário; usuário comum só a própria vaga.
      const usuarioId =
        ehStaff && usuarioIdBody ? usuarioIdBody : auth.payload.id;

      if (!usuarioId) {
        return res
          .status(400)
          .json({ erro: "Não foi possível identificar o usuário" });
      }

      const agora = new Date().toISOString();

      // Busca o acesso encerrado mais recente deste usuário que ainda
      // está dentro da garantia automática (não expirou, não foi revogado).
      const { data: acesso, error: errBusca } = await supabase
        .from("acessos")
        .select("id, status, saida_em, vaga_garantida_ate")
        .eq("usuario_id", usuarioId)
        .eq("status", "encerrado")
        .not("vaga_garantida_ate", "is", null)
        .gt("vaga_garantida_ate", agora)
        .order("saida_em", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (errBusca) {
        console.error("[travar-vaga] busca:", errBusca);
        return res.status(500).json({ erro: "Erro interno" });
      }

      if (!acesso) {
        return res.status(404).json({
          erro: "Nenhuma vaga com garantia ativa encontrada. A garantia pode já ter expirado.",
        });
      }

      // Lê o tempo de trava manual (padrão 180min se não configurado)
      const { data: cfgTrava } = await supabase
        .from("configuracoes")
        .select("valor")
        .eq("chave", "trava_vaga_manual_minutos")
        .maybeSingle();
      const travaMinutos = parseInt(cfgTrava?.valor || "180", 10);
      const novaGarantia = new Date(
        Date.now() + travaMinutos * 60000,
      ).toISOString();

      const { data: atualizado, error: errUpdate } = await supabase
        .from("acessos")
        .update({ vaga_garantida_ate: novaGarantia, trava_manual: true })
        .eq("id", acesso.id)
        .select()
        .maybeSingle();

      if (errUpdate) {
        console.error("[travar-vaga] update:", errUpdate);
        return res.status(500).json({ erro: "Erro ao travar vaga" });
      }

      return res.status(200).json({
        mensagem: `Vaga travada por ${travaMinutos} minutos`,
        acesso: atualizado,
        vaga_garantida_ate: novaGarantia,
      });
    } catch (e) {
      console.error("[travar-vaga]", e);
      return res.status(500).json({ erro: "Erro interno" });
    }
  }
  // ─────────────────────────────────────────────────────────────
  // ⏱️ PROCESSAR GARANTIAS — revoga facial quando vaga_garantida_ate
  //    expira sem retorno (nova entrada). Deve rodar a cada poucos
  //    minutos via Vercel Cron (reaproveita o mesmo cron_token do
  //    reset-diario).
  //
  //    Configuração sugerida no vercel.json:
  //    {
  //      "crons": [{
  //        "path": "/api/acessos?acao=processar-garantias&token=SEU_TOKEN_SECRETO",
  //        "schedule": "*/5 * * * *"
  //      }]
  //    }
  if (
    (req.method === "POST" || req.method === "GET") &&
    acao === "processar-garantias"
  ) {
    const authHeader = req.headers.authorization;
    const cronSecretValido =
      process.env.CRON_SECRET &&
      authHeader === `Bearer ${process.env.CRON_SECRET}`;

    const tokenCron = req.query.token || req.body?.token;
    const { data: cfgToken } = await supabase
      .from("configuracoes")
      .select("valor")
      .eq("chave", "cron_token")
      .maybeSingle();

    const tokenValido = cfgToken?.valor && tokenCron === cfgToken.valor;

    if (!cronSecretValido && !tokenValido) {
      const auth = autenticado(req, res);
      if (!auth.ok) return;
      if (auth.payload.tipo !== "admin") {
        return res
          .status(403)
          .json({ erro: "Apenas admin pode executar manualmente" });
      }
    }
    try {
      const agora = new Date().toISOString();

      // Busca acessos encerrados cuja garantia já expirou
      const { data: expirados, error: errBusca } = await supabase
        .from("acessos")
        .select("id, usuario_id, saida_em, vaga_garantida_ate")
        .eq("status", "encerrado")
        .not("vaga_garantida_ate", "is", null)
        .lt("vaga_garantida_ate", agora);

      if (errBusca) {
        console.error("[processar-garantias] busca:", errBusca);
        return res
          .status(500)
          .json({ erro: "Erro ao buscar garantias expiradas" });
      }

      if (!expirados || expirados.length === 0) {
        return res
          .status(200)
          .json({ mensagem: "Nenhuma garantia expirada", processados: 0 });
      }

      let revogados = 0;
      let semFacial = 0;
      let jaNaFila = 0;

      for (const acesso of expirados) {
        // Confirma que não houve retorno depois da saída (nova entrada ativa)
        const { data: novoAtivo } = await supabase
          .from("acessos")
          .select("id")
          .eq("usuario_id", acesso.usuario_id)
          .eq("status", "ativo")
          .maybeSingle();

        if (novoAtivo) {
          // Usuário já voltou — só limpa a garantia, sem revogar
          await supabase
            .from("acessos")
            .update({ vaga_garantida_ate: null })
            .eq("id", acesso.id);
          continue;
        }

        const { data: usuarioInfo } = await supabase
          .from("usuarios")
          .select("nome, controlid_person_id")
          .eq("id", acesso.usuario_id)
          .maybeSingle();

        const controlidUserId = usuarioInfo?.controlid_person_id
          ? parseInt(usuarioInfo.controlid_person_id, 10)
          : 0;

        if (controlidUserId) {
          // Evita duplicar se já existir uma revogação pendente para este usuário
          const { data: pendenteExistente } = await supabase
            .from("liberacoes_catraca")
            .select("id")
            .eq("usuario_id", acesso.usuario_id)
            .eq("acao", "revogar")
            .eq("status", "pendente")
            .maybeSingle();

          if (!pendenteExistente) {
            const { error: errFila } = await supabase
              .from("liberacoes_catraca")
              .insert({
                usuario_id: acesso.usuario_id,
                controlid_user_id: controlidUserId,
                nome: usuarioInfo?.nome || null,
                acao: "revogar",
                status: "pendente",
                criado_em: new Date().toISOString(),
              });
            if (errFila) {
              console.error(
                "[processar-garantias] erro ao enfileirar revogação:",
                errFila,
              );
            } else {
              revogados++;
            }
          } else {
            jaNaFila++;
          }
        } else {
          semFacial++;
        }

        // Limpa a garantia deste acesso, marcando como processado
        await supabase
          .from("acessos")
          .update({ vaga_garantida_ate: null })
          .eq("id", acesso.id);
      }

      console.log(
        `[processar-garantias] ${expirados.length} expirado(s): ${revogados} enfileirado(s), ${semFacial} sem facial, ${jaNaFila} já na fila`,
      );

      return res.status(200).json({
        mensagem: "Processamento concluído",
        total_expirados: expirados.length,
        revogados_enfileirados: revogados,
        sem_facial: semFacial,
        ja_na_fila: jaNaFila,
      });
    } catch (e) {
      console.error("[processar-garantias]", e);
      return res
        .status(500)
        .json({ erro: "Erro interno no processamento de garantias" });
    }
  }
  // ─────────────────────────────────────────────────────────────
  // 🔄 RESET DIÁRIO — encerra todos os acessos ativos ao final do dia
  //
  //    Este endpoint deve ser chamado automaticamente às 20h00
  //    via Vercel Cron Job (vercel.json) ou Supabase pg_cron.
  //
  //    O que faz:
  //      1. Busca todos os acessos com status 'ativo'
  //      2. Marca todos como 'encerrado' com saida_em = 19:45 do dia
  //      3. Zera as vagas automaticamente (pois ocupadas = count de 'ativo')
  //
  //    Configuração no vercel.json:
  //    {
  //      "crons": [{
  //        "path": "/api/acessos?acao=reset-diario&token=SEU_TOKEN_SECRETO",
  //        "schedule": "0 23 * * *"
  //      }]
  //    }
  //    (23h UTC = 20h Brasília no horário de verão / 20h no horário padrão)
  //
  //    Também pode ser chamado manualmente pelo admin no painel.
  // ─────────────────────────────────────────────────────────────
  if (
    (req.method === "POST" || req.method === "GET") &&
    acao === "reset-diario"
  ) {
    // Aceita CRON_SECRET (header, usado pelo Vercel Cron) OU cron_token (query, chamada manual) OU admin
    const authHeader = req.headers.authorization;
    const cronSecretValido =
      process.env.CRON_SECRET &&
      authHeader === `Bearer ${process.env.CRON_SECRET}`;

    const tokenCron = req.query.token || req.body?.token;
    const { data: cfgToken } = await supabase
      .from("configuracoes")
      .select("valor")
      .eq("chave", "cron_token")
      .maybeSingle();

    const tokenValido = cfgToken?.valor && tokenCron === cfgToken.valor;

    if (!cronSecretValido && !tokenValido) {
      // Tenta autenticação normal de admin
      const auth = autenticado(req, res);
      if (!auth.ok) return;
    }

    try {
      // Horário de encerramento: 19h45 do dia atual
      const agora = new Date();
      const encerramento = new Date(agora);
      encerramento.setHours(19, 45, 0, 0);
      // Se já passou das 19h45, usa o horário atual
      const saidaFinal = agora > encerramento ? agora : encerramento;

      // Busca todos os acessos ativos
      const { data: ativos, error: errBusca } = await supabase
        .from("acessos")
        .select("id, usuario_id, entrada_em")
        .eq("status", "ativo");

      if (errBusca)
        return res.status(500).json({ erro: "Erro ao buscar acessos ativos" });

      if (!ativos || ativos.length === 0) {
        return res.status(200).json({
          mensagem: "Nenhum acesso ativo para encerrar",
          encerrados: 0,
        });
      }

      // Encerra todos de uma vez
      const { error: errUpdate } = await supabase
        .from("acessos")
        .update({
          status: "encerrado",
          saida_em: saidaFinal.toISOString(),
          motivo_saida: "fim_dia",
        })
        .eq("status", "ativo");

      if (errUpdate)
        return res.status(500).json({ erro: "Erro ao encerrar acessos" });

      console.log(
        `[reset-diario] ${ativos.length} acessos encerrados em ${saidaFinal.toISOString()}`,
      );

      return res.status(200).json({
        mensagem: `Reset diário concluído — ${ativos.length} acesso(s) encerrado(s)`,
        encerrados: ativos.length,
        horario_encerramento: saidaFinal.toISOString(),
      });
    } catch (e) {
      console.error("[reset-diario]", e);
      return res.status(500).json({ erro: "Erro interno no reset diário" });
    }
  }

  return res.status(405).json({ erro: "Método ou ação não permitidos" });
};
module.exports.config = { api: { bodyParser: { sizeLimit: "5mb" } } };
