const acessosEspeciais = require('../lib/handlers/acessos-especiais.js');
const acessos          = require('../lib/handlers/acessos.js');
const auth             = require('../lib/handlers/auth.js');
const avisos           = require('../lib/handlers/avisos.js');
const configuracoes    = require('../lib/handlers/configuracoes.js');
const liberarAcesso    = require('../lib/handlers/liberar-acesso.js');
const pagamentos       = require('../lib/handlers/pagamentos.js');
const sugestoes        = require('../lib/handlers/sugestoes.js');
const totem            = require('../lib/handlers/totem.js');
const usuarios         = require('../lib/handlers/usuarios.js');
const vagas            = require('../lib/handlers/vagas.js');
const agenteConfirmar    = require('../lib/handlers/agente/confirmar.js');
const agenteFila         = require('../lib/handlers/agente/fila.js');
const agenteSalvarPerson = require('../lib/handlers/agente/salvar-person-id.js');

const rotas = {
  '/api/acessos-especiais': acessosEspeciais,
  '/api/acessos':           acessos,
  '/api/auth':              auth,
  '/api/avisos':            avisos,
  '/api/configuracoes':     configuracoes,
  '/api/liberar-acesso':    liberarAcesso,
  '/api/pagamentos':        pagamentos,
  '/api/sugestoes':         sugestoes,
  '/api/totem':             totem,
  '/api/usuarios':          usuarios,
  '/api/vagas':             vagas,
  '/api/agente/confirmar':       agenteConfirmar,
  '/api/agente/fila':            agenteFila,
  '/api/agente/salvar-person-id': agenteSalvarPerson,
};

module.exports = function handler(req, res) {
  const url  = new URL(req.url, 'http://localhost');
  const path = url.pathname.replace(/\/$/, '');

  const fn = rotas[path];

  if (fn) return fn(req, res);

  res.status(404).json({ erro: `Rota não encontrada: ${path}` });
};
