const supabase = require("../../supabase");

module.exports = async function handler(req, res) {
  const secret = req.headers["x-agent-secret"];
  if (!secret || secret !== process.env.AGENT_SECRET) {
    return res.status(401).json({ erro: "Não autorizado" });
  }
  if (req.method !== "GET") {
    return res.status(405).json({ erro: "Método não permitido" });
  }

  const limite = parseInt(req.query.limite || "10", 10);

  try {
   // NULLS FIRST garante que quem nunca foi tentado entra primeiro — isso
    // cobre tanto quem já teve controlid_person_id e precisa revalidar
    // quanto quem NUNCA teve vínculo nenhum (controlid_person_id null),
    // caso comum de pagamento cuja sincronização falhou silenciosamente
    // (ver investigação de 12/08/2026 — 11 usuários reais sem vínculo
    // acumulados desde abril). Depois disso, sempre o que está esperando
    // há mais tempo — inclusive quem falhou por erro, porque
    // ultima_tentativa_em (não verificado_em) é o que governa essa ordenação.
    // origem_cadastro='app' filtra os ~4588 registros importados em massa
    // do Control iD (nunca tiveram contato com o app) — só verifica quem
    // é usuário real.
    const { data, error } = await supabase
      .from("usuarios")
      .select("id, cpf, controlid_person_id")
      .eq("origem_cadastro", "app")
      .not("cpf", "is", null)
      .order("controlid_person_id_ultima_tentativa_em", { ascending: true, nullsFirst: true })
      .limit(limite);

    if (error) {
      console.error("[vinculos-para-verificar]", error);
      return res.status(500).json({ erro: "Erro interno" });
    }

    return res.status(200).json({ vinculos: data || [] });
  } catch (e) {
    console.error("[vinculos-para-verificar]", e);
    return res.status(500).json({ erro: "Erro interno" });
  }
};