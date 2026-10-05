import { createClient } from '@supabase/supabase-js';

// Proxy Microsoft Graph : liste des collaborateurs de l'annuaire Entra (Azure AD).
// Utilise le flux "client credentials". Variables d'environnement Vercel requises :
//   GRAPH_TENANT_ID, GRAPH_CLIENT_ID, GRAPH_CLIENT_SECRET
// L'app Entra doit avoir la permission APPLICATION "User.Read.All" + consentement admin.
const SUPABASE_URL = 'https://asuccniyofzvwgooxjah.supabase.co';
const BOOTSTRAP_ADMINS = ['vsalaud@be-gph.fr'];

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  // 1) Vérifier le JWT de l'appelant
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) return res.status(401).json({ error: 'Token manquant' });
  let email = null;
  try {
    const t = authHeader.replace('Bearer ', '');
    const p = JSON.parse(Buffer.from(t.split('.')[1], 'base64').toString());
    if (!p.email || !p.exp) return res.status(401).json({ error: 'Token invalide' });
    if (p.exp * 1000 < Date.now()) return res.status(401).json({ error: 'Token expiré' });
    email = String(p.email).toLowerCase();
  } catch (e) {
    return res.status(401).json({ error: 'Erreur décodage token: ' + e.message });
  }

  // 2) L'appelant est-il admin ? (bootstrap + table geosolia_roles)
  let isAdmin = BOOTSTRAP_ADMINS.includes(email);
  if (!isAdmin) {
    const sk = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (sk) {
      try {
        const sb = createClient(SUPABASE_URL, sk);
        const { data } = await sb.from('geosolia_roles').select('is_admin').eq('email', email).maybeSingle();
        isAdmin = !!(data && data.is_admin);
      } catch (e) { /* ignore */ }
    }
  }
  if (!isAdmin) return res.status(403).json({ error: 'Accès réservé aux administrateurs' });

  // 3) Credentials Graph
  const tenant = process.env.GRAPH_TENANT_ID;
  const clientId = process.env.GRAPH_CLIENT_ID;
  const secret = process.env.GRAPH_CLIENT_SECRET;
  if (!tenant || !clientId || !secret) {
    return res.status(500).json({ error: 'Variables GRAPH_TENANT_ID / GRAPH_CLIENT_ID / GRAPH_CLIENT_SECRET manquantes sur Vercel' });
  }

  try {
    const tokRes = await fetch(`https://login.microsoftonline.com/${tenant}/oauth2/v2.0/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: secret,
        scope: 'https://graph.microsoft.com/.default',
        grant_type: 'client_credentials'
      })
    });
    const tok = await tokRes.json();
    if (!tok.access_token) {
      return res.status(500).json({ error: 'Token Graph refusé: ' + (tok.error_description || JSON.stringify(tok)) });
    }

    let url = 'https://graph.microsoft.com/v1.0/users?$select=displayName,mail,userPrincipalName,department,jobTitle,accountEnabled&$top=999';
    const out = [];
    let guard = 0;
    while (url && guard < 25) {
      const r = await fetch(url, { headers: { Authorization: 'Bearer ' + tok.access_token } });
      const j = await r.json();
      if (j.error) return res.status(500).json({ error: 'Graph: ' + (j.error.message || JSON.stringify(j.error)) });
      (j.value || []).forEach(u => {
        const mail = (u.mail || u.userPrincipalName || '').toLowerCase();
        if (!mail) return;
        out.push({
          email: mail,
          name: u.displayName || '',
          department: u.department || '',
          jobTitle: u.jobTitle || '',
          enabled: u.accountEnabled !== false
        });
      });
      url = j['@odata.nextLink'] || null;
      guard++;
    }
    out.sort((a, b) => (a.name || a.email).localeCompare(b.name || b.email));
    return res.status(200).json({ users: out, count: out.length });
  } catch (e) {
    return res.status(500).json({ error: 'Erreur Graph: ' + e.message });
  }
}
