-- Adicionar colunas de assinatura à tabela usuarios
-- Execute no SQL Editor do Supabase

ALTER TABLE usuarios
  ADD COLUMN IF NOT EXISTS termo_aceito_em  TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS assinatura_svg   TEXT,
  ADD COLUMN IF NOT EXISTS termo_ip         TEXT;
