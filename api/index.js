import acessosEspeciais from '../lib/handlers/acessos-especiais.js';
import acessos from '../lib/handlers/acessos.js';
import auth from '../lib/handlers/auth.js';
import avisos from '../lib/handlers/avisos.js';
import configuracoes from '../lib/handlers/configuracoes.js';
import gerarTokens from '../lib/handlers/gerar-tokens.js';
import liberarAcesso from '../lib/handlers/liberar-acesso.js';
import pagamentos from '../lib/handlers/pagamentos.js';
import sugestoes from '../lib/handlers/sugestoes.js';
import totem from '../lib/handlers/totem.js';
import usuarios from '../lib/handlers/usuarios.js';
import vagas from '../lib/handlers/vagas.js';
import agenteConfirmar from '../lib/handlers/agente/confirmar.js';
import agenteFila from '../lib/handlers/agente/fila.js';

const rotas = {
  '/api/acessos-especiais': acessosEspeciais,
  '/api/acessos': acessos,
  '/api/auth': auth,
  '/api/avisos': avisos,
  '/api/configuracoes': configuracoes,
  '/api/gerar-tokens': gerarTokens,
  '/api/liberar-acesso': liberarAcesso,
  '/api/pagamentos': pagamentos,
  '/api/sugestoes': sugestoes,
  '/api/totem': totem,
  '/api/usuarios': usuarios,
  '/api/vagas': vagas,
  '/api/agente/confirmar': agenteConfirmar,
  '/api/agente/fila': agenteFila,
};

export default function handler(req, res) {
  const url = new URL(req.url, 'http://localhost');
  const path = url.pathname.replace(/\/$/, '');

  const fn = rotas[path];

  if (fn) {
    return fn(req, res);
  }

  res.status(404).json({ erro: `Rota não encontrada: ${path}` });
}