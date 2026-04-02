-- ============================================================
--  Ala dos Estudantes — Paiva Netto
--  Schema do banco de dados (Supabase / PostgreSQL)
--  Execute este arquivo no SQL Editor do Supabase
-- ============================================================

-- 1. USUARIOS
CREATE TABLE IF NOT EXISTS usuarios (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  nome          TEXT NOT NULL,
  cpf           TEXT UNIQUE NOT NULL,
  email         TEXT,
  telefone      TEXT,
  foto_url      TEXT,                        -- URL no Supabase Storage
  tipo          TEXT NOT NULL DEFAULT 'aluno' CHECK (tipo IN ('aluno','visitante','admin')),
  ativo         BOOLEAN NOT NULL DEFAULT true,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 2. CONFIGURACOES
CREATE TABLE IF NOT EXISTS configuracoes (
  chave         TEXT PRIMARY KEY,
  valor         TEXT NOT NULL,
  descricao     TEXT,
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Valores padrão
INSERT INTO configuracoes (chave, valor, descricao) VALUES
  ('total_vagas',          '30',    'Capacidade máxima da sala'),
  ('horario_abertura',     '07:00', 'Horário de abertura'),
  ('horario_encerramento', '19:45', 'Horário de encerramento automático'),
  ('timeout_vaga_minutos', '30',    'Minutos para liberar vaga ociosa após pagamento'),
  ('valor_diaria',         '5.00',  'Valor da diária em reais'),
  ('controlid_url',        '',      'URL da API Control iD'),
  ('controlid_token',      '',      'Token de autenticação Control iD')
ON CONFLICT (chave) DO NOTHING;

-- 3. PAGAMENTOS
CREATE TABLE IF NOT EXISTS pagamentos (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  usuario_id       UUID REFERENCES usuarios(id) ON DELETE SET NULL,
  tipo             TEXT NOT NULL CHECK (tipo IN ('pix','dinheiro','isento')),
  valor            NUMERIC(10,2) NOT NULL DEFAULT 0,
  status           TEXT NOT NULL DEFAULT 'pendente' CHECK (status IN ('pendente','confirmado','expirado','cancelado')),
  txid             TEXT UNIQUE,              -- ID da transação Pix
  qrcode_texto     TEXT,                     -- Pix Copia e Cola
  qrcode_imagem    TEXT,                     -- Base64 do QR Code
  expira_em        TIMESTAMPTZ,             -- Quando o Pix expira
  confirmado_em    TIMESTAMPTZ,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 4. ACESSOS (cada entrada/saída registrada)
CREATE TABLE IF NOT EXISTS acessos (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  usuario_id      UUID REFERENCES usuarios(id) ON DELETE SET NULL,
  pagamento_id    UUID REFERENCES pagamentos(id) ON DELETE SET NULL,
  entrada_em      TIMESTAMPTZ NOT NULL DEFAULT now(),
  saida_em        TIMESTAMPTZ,
  status          TEXT NOT NULL DEFAULT 'ativo' CHECK (status IN ('ativo','encerrado','ocioso')),
  registrado_por  TEXT NOT NULL DEFAULT 'sistema' CHECK (registrado_por IN ('sistema','recepcao','catraca','admin')),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============================================================
-- ÍNDICES para performance
-- ============================================================
CREATE INDEX IF NOT EXISTS idx_usuarios_cpf        ON usuarios(cpf);
CREATE INDEX IF NOT EXISTS idx_pagamentos_txid      ON pagamentos(txid);
CREATE INDEX IF NOT EXISTS idx_pagamentos_status    ON pagamentos(status);
CREATE INDEX IF NOT EXISTS idx_acessos_usuario      ON acessos(usuario_id);
CREATE INDEX IF NOT EXISTS idx_acessos_status       ON acessos(status);
CREATE INDEX IF NOT EXISTS idx_acessos_entrada      ON acessos(entrada_em);

-- ============================================================
-- FUNÇÃO para contar vagas ocupadas em tempo real
-- ============================================================
CREATE OR REPLACE FUNCTION vagas_ocupadas()
RETURNS INTEGER AS $$
  SELECT COUNT(*)::INTEGER FROM acessos WHERE status = 'ativo';
$$ LANGUAGE SQL STABLE;

-- ============================================================
-- FUNÇÃO para atualizar updated_at automaticamente
-- ============================================================
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER usuarios_updated_at
  BEFORE UPDATE ON usuarios
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER configuracoes_updated_at
  BEFORE UPDATE ON configuracoes
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ============================================================
-- ROW LEVEL SECURITY (RLS) — Supabase
-- Deixa desligado por enquanto; o backend usa a service_role key
-- ============================================================
ALTER TABLE usuarios      DISABLE ROW LEVEL SECURITY;
ALTER TABLE pagamentos    DISABLE ROW LEVEL SECURITY;
ALTER TABLE acessos       DISABLE ROW LEVEL SECURITY;
ALTER TABLE configuracoes DISABLE ROW LEVEL SECURITY;
