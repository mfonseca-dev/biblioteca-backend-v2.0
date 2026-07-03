// lib/rateLimit.js
// Rate limit em memória — sem dependências externas
// Reseta automaticamente quando o processo reinicia (Vercel cold start)

const _store = new Map();

/**
 * Verifica e registra tentativa.
 * @param {string} chave  — ex: `login:${ip}` ou `login-staff:${ip}`
 * @param {object} opts
 *   max       {number} — tentativas antes de bloquear (default 5)
 *   janela    {number} — janela em ms (default 60_000 = 1 min)
 *   bloqueio  {number} — tempo de bloqueio em ms (default 300_000 = 5 min)
 * @returns {{ permitido: boolean, restantes: number, bloqueadoAte: number|null }}
 */
function checar(chave, opts = {}) {
  const max      = opts.max      ?? 5;
  const janela   = opts.janela   ?? 60_000;
  const bloqueio = opts.bloqueio ?? 300_000;
  const agora    = Date.now();

  let entrada = _store.get(chave);

  // Primeiro acesso
  if (!entrada) {
    entrada = { tentativas: 1, inicio: agora, bloqueadoAte: null };
    _store.set(chave, entrada);
    return { permitido: true, restantes: max - 1, bloqueadoAte: null };
  }

  // Ainda bloqueado?
  if (entrada.bloqueadoAte && agora < entrada.bloqueadoAte) {
    return { permitido: false, restantes: 0, bloqueadoAte: entrada.bloqueadoAte };
  }

  // Janela expirou — reseta
  if (agora - entrada.inicio > janela) {
    entrada.tentativas = 1;
    entrada.inicio     = agora;
    entrada.bloqueadoAte = null;
    _store.set(chave, entrada);
    return { permitido: true, restantes: max - 1, bloqueadoAte: null };
  }

  // Incrementa
  entrada.tentativas++;

  // Atingiu o limite?
  if (entrada.tentativas > max) {
    entrada.bloqueadoAte = agora + bloqueio;
    _store.set(chave, entrada);
    return { permitido: false, restantes: 0, bloqueadoAte: entrada.bloqueadoAte };
  }

  _store.set(chave, entrada);
  return { permitido: true, restantes: max - entrada.tentativas, bloqueadoAte: null };
}

/** Reseta manualmente uma chave (após login bem-sucedido) */
function resetar(chave) {
  _store.delete(chave);
}

/** Retorna o IP real considerando proxies (Vercel usa x-forwarded-for) */
function getIp(req) {
  return (
    req.headers['x-forwarded-for']?.split(',')[0]?.trim() ||
    req.headers['x-real-ip'] ||
    req.socket?.remoteAddress ||
    'desconhecido'
  );
}

module.exports = { checar, resetar, getIp };