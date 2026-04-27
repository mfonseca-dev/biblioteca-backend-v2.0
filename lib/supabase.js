// lib/supabase.js
// Cliente Supabase usado por todas as API functions
// Usa a service_role key (acesso total, sem RLS) — NUNCA exponha no frontend
const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = process.env.SUPABASE_URL        || '';
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

if (!supabaseUrl || !supabaseKey) {
  console.warn('[supabase] ATENÇÃO: SUPABASE_URL ou SUPABASE_SERVICE_ROLE_KEY não definidas');
}

const supabase = createClient(supabaseUrl || 'https://placeholder.supabase.co', supabaseKey || 'placeholder', {
  auth: { persistSession: false }
});

module.exports = supabase;
