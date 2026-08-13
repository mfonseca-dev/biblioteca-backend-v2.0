const supabase = require("../../supabase");

const STATUS_VALIDOS = ["ok", "corrigido", "nao_encontrado", "cpf_duplicado", "erro"];

module.exports = async function handler(req, res) {
  const secret = req.headers["x-agent-secret"];
  if (!secret || secret !== process.env.AGENT_SECRET) {
    return res.status(401).json({ erro: "Não autorizado" });
  }
  if (req.method !== "POST") {
    return res.status(405).json({ erro: "Método não permitido" });
  }

  const { usuario_id, status, controlid_person_id_novo } = req.body || {};
  if (!usuario_id || !STATUS_VALIDOS.includes(status)) {
    return res.status(400).json({ erro: "usuario_id e status válido são obrigatórios" });
  }
  if (status === "corrigido" && !controlid_person_id_novo) {
    return res.status(400).json({ erro: "controlid_person_id_novo obrigatório quando status=corrigido" });
  }

  const agora = new Date().toISOString();
  const update = {
    controlid_person_id_ultima_tentativa_em: agora,
    controlid_person_id_verificacao_status: status,
  };

  // 'erro' nunca marca verificado_em — não foi uma checagem concluída,
  // só uma tentativa que falhou (rede/timeout/HTTP diferente de 200).
  if (status !== "erro") {
    update.controlid_person_id_verificado_em = agora;
  }
  if (status === "corrigido") {
    update.controlid_person_id = String(controlid_person_id_novo);
  }

  try {
    const { error } = await supabase.from("usuarios").update(update).eq("id", usuario_id);
    if (error) {
      console.error("[verificar-vinculo]", error);
      return res.status(500).json({ erro: "Erro interno" });
    }
    return res.status(200).json({ ok: true });
  } catch (e) {
    console.error("[verificar-vinculo]", e);
    return res.status(500).json({ erro: "Erro interno" });
  }
};