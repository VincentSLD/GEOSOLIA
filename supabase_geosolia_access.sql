-- ═══════════════════════════════════════════════════════
-- Table geosolia_access : controle d'acces a GeoSolia
-- A executer dans le SQL Editor de Supabase
-- ═══════════════════════════════════════════════════════

-- 1. Creer la table
CREATE TABLE IF NOT EXISTS geosolia_access (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID UNIQUE NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- 2. Activer RLS
ALTER TABLE geosolia_access ENABLE ROW LEVEL SECURITY;

-- 3. Policy : les utilisateurs authentifies peuvent lire leur propre acces
CREATE POLICY "Users can read own access" ON geosolia_access
  FOR SELECT
  USING (auth.uid() = user_id);

-- 4. Ajouter un utilisateur autorise (remplacer le UUID par celui de auth.users)
-- INSERT INTO geosolia_access (user_id) VALUES ('xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx');

-- Pour trouver les UUID des utilisateurs :
-- SELECT id, email FROM auth.users ORDER BY created_at;
