// lib/supabase.js
// Cliente Supabase usado por todas as API functions
// Usa a service_role key (acesso total, sem RLS) — NUNCA exponha no frontend

const { createClient } = require('@supabase/supabase-js');

const supabaseUrl   = process.env.SUPABASE_URL;
const supabaseKey   = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseKey) {
  throw new Error('Variáveis SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY são obrigatórias');
}

const supabase = createClient(supabaseUrl, supabaseKey, {
  auth: { persistSession: false }
});

module.exports = supabase;
