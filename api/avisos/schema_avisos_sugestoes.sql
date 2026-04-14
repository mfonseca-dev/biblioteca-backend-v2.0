-- Execute no SQL Editor do Supabase

-- TABELA DE AVISOS (criados pelo admin)
CREATE TABLE IF NOT EXISTS avisos (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  titulo      TEXT NOT NULL,
  conteudo    TEXT NOT NULL,
  tipo        TEXT NOT NULL DEFAULT 'aviso' CHECK (tipo IN ('aviso','urgente','info')),
  ativo       BOOLEAN NOT NULL DEFAULT true,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Avisos de exemplo
INSERT INTO avisos (titulo, conteudo, tipo) VALUES
  ('Silêncio obrigatório', 'Silêncio obrigatório nas áreas de estudo. Conversas apenas nas áreas de convivência.', 'aviso'),
  ('Wi-Fi disponível', 'Internet de alta velocidade disponível em todas as áreas.', 'info')
ON CONFLICT DO NOTHING;

-- TABELA DE SUGESTÕES (enviadas pelos usuários)
CREATE TABLE IF NOT EXISTS sugestoes (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  usuario_id  UUID REFERENCES usuarios(id) ON DELETE SET NULL,
  tipo        TEXT,
  area        TEXT,
  mensagem    TEXT NOT NULL,
  lida        BOOLEAN NOT NULL DEFAULT false,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
