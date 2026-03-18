import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = 'https://asuccniyofzvwgooxjah.supabase.co';
const ADMIN_EMAILS = ['vsalaud@be-gph.fr'];

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!serviceKey) return res.status(500).json({ error: 'SUPABASE_SERVICE_ROLE_KEY manquante' });

  const sb = createClient(SUPABASE_URL, serviceKey);

  // Verifier que l'appelant est admin via son token Supabase
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) return res.status(401).json({ error: 'Token manquant' });

  try {
    const userToken = authHeader.replace('Bearer ', '');
    const { data: { user }, error: authErr } = await sb.auth.getUser(userToken);
    if (authErr || !user) return res.status(401).json({ error: 'Token invalide', detail: authErr?.message });
    if (!ADMIN_EMAILS.includes(user.email)) return res.status(403).json({ error: 'Acces reserve aux administrateurs' });
  } catch (e) {
    return res.status(401).json({ error: 'Erreur auth: ' + e.message });
  }

  // GET = lister les utilisateurs
  if (req.method === 'GET') {
    try {
      const { data: pending, error } = await sb
        .from('geosolia_access')
        .select('user_id, approved, created_at')
        .order('created_at', { ascending: false });

      if (error) return res.status(500).json({ error: error.message });

      // Enrichir avec les emails depuis auth.users
      const enriched = await Promise.all(pending.map(async (row) => {
        try {
          const { data: { user: u } } = await sb.auth.admin.getUserById(row.user_id);
          return {
            user_id: row.user_id,
            email: u?.email || 'inconnu',
            name: u?.user_metadata?.full_name || '',
            approved: row.approved,
            created_at: row.created_at
          };
        } catch (e) {
          return { user_id: row.user_id, email: 'erreur', name: '', approved: row.approved, created_at: row.created_at };
        }
      }));

      return res.status(200).json({ users: enriched });
    } catch (e) {
      return res.status(500).json({ error: 'Erreur GET: ' + e.message });
    }
  }

  // POST = approuver ou rejeter
  if (req.method === 'POST') {
    const { user_id, action } = req.body || {};
    if (!user_id || !['approve', 'reject'].includes(action)) {
      return res.status(400).json({ error: 'user_id et action (approve/reject) requis' });
    }

    try {
      if (action === 'approve') {
        const { error } = await sb
          .from('geosolia_access')
          .update({ approved: true })
          .eq('user_id', user_id);
        if (error) return res.status(500).json({ error: error.message });
        return res.status(200).json({ ok: true, message: 'Utilisateur approuve' });
      }

      if (action === 'reject') {
        await sb.from('geosolia_access').delete().eq('user_id', user_id);
        await sb.auth.admin.deleteUser(user_id);
        return res.status(200).json({ ok: true, message: 'Utilisateur supprime' });
      }
    } catch (e) {
      return res.status(500).json({ error: 'Erreur POST: ' + e.message });
    }
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
