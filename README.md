# Ala dos Estudantes — Paiva Netto
## Backend API — Guia de Deploy

---

## ✅ Pré-requisitos
- Conta no GitHub
- Conta no Supabase
- Conta na Vercel
- Node.js 18+ instalado localmente

---

## 📦 Passo a Passo Completo

### 1. Criar o banco no Supabase

1. Acesse supabase.com → **New Project**
2. Nome: `biblioteca-paiva-netto` | Região: South America (São Paulo)
3. Aguarde criar (~2 min)
4. Vá em **SQL Editor** → **New Query**
5. Cole o conteúdo de `sql/schema.sql` e clique **Run**
6. Vá em **Project Settings → API** e copie:
   - `Project URL` → `SUPABASE_URL`
   - `service_role` secret → `SUPABASE_SERVICE_ROLE_KEY`

---

### 2. Subir o código no GitHub

```bash
git init
git add .
git commit -m "feat: backend inicial da Ala dos Estudantes"
git branch -M main
git remote add origin https://github.com/SEU_USUARIO/biblioteca-paiva-netto.git
git push -u origin main