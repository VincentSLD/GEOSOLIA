/**
 * API Vercel pour la synchronisation des projets GéoSolia avec Supabase.
 * Endpoints :
 *   POST /api/projects?action=save   — Sauvegarder un projet
 *   POST /api/projects?action=list   — Lister les projets de l'utilisateur
 *   POST /api/projects?action=load   — Charger un projet
 *   POST /api/projects?action=delete — Supprimer un projet
 */

const SUPABASE_URL = 'https://asuccniyofzvwgooxjah.supabase.co';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!serviceKey) return res.status(500).json({ error: 'SUPABASE_SERVICE_ROLE_KEY manquante' });

  // Vérifier le token utilisateur
  const authHeader = req.headers.authorization || '';
  const token = authHeader.replace('Bearer ', '');
  if (!token) return res.status(401).json({ error: 'Token requis' });

  // Décoder le JWT pour obtenir le user_id
  let userId;
  try {
    const payload = JSON.parse(Buffer.from(token.split('.')[1], 'base64').toString());
    userId = payload.sub;
    if (!userId) throw new Error('No sub');
  } catch (e) {
    return res.status(401).json({ error: 'Token invalide' });
  }

  const action = req.query.action || req.body?.action;
  const sbFetch = (path, opts = {}) => fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...opts,
    headers: {
      'Content-Type': 'application/json',
      'apikey': serviceKey,
      'Authorization': `Bearer ${serviceKey}`,
      'Prefer': opts.prefer || '',
      ...opts.headers
    }
  });

  try {
    if (action === 'save') {
      const { projectRef, projectName, projectData, files } = req.body;
      if (!projectRef) return res.status(400).json({ error: 'projectRef requis' });

      const meta = {
        user_id: userId,
        project_ref: projectRef,
        project_name: projectName || '',
        project_data: projectData,
        updated_at: new Date().toISOString()
      };

      const r = await sbFetch(
        `geosolia_projects?on_conflict=user_id,project_ref`,
        {
          method: 'POST',
          prefer: 'resolution=merge-duplicates,return=representation',
          body: JSON.stringify(meta)
        }
      );
      const data = await r.json();
      if (!r.ok) return res.status(r.status).json({ error: data.message || JSON.stringify(data) });

      const projectId = Array.isArray(data) ? data[0]?.id : data.id;

      // Sauvegarder les fichiers (plans, photos, images) un par un
      if (projectId && files && Array.isArray(files)) {
        // Supprimer les anciens fichiers
        await sbFetch(`geosolia_project_files?project_id=eq.${projectId}`, { method: 'DELETE' });
        // Insérer les nouveaux par batch de 1 (les base64 sont gros)
        for (const f of files) {
          if (!f.key || !f.data) continue;
          await sbFetch(
            `geosolia_project_files`,
            {
              method: 'POST',
              body: JSON.stringify({
                project_id: projectId,
                file_key: f.key,
                file_data: f.data,
                updated_at: new Date().toISOString()
              })
            }
          );
        }
      }

      return res.status(200).json({ ok: true, id: projectId });

    } else if (action === 'check') {
      // Vérifier si le projet cloud est plus récent que la version locale
      const { projectRef, localUpdatedAt } = req.body;
      if (!projectRef) return res.status(400).json({ error: 'projectRef requis' });

      const r = await sbFetch(
        `geosolia_projects?user_id=eq.${userId}&project_ref=eq.${encodeURIComponent(projectRef)}&select=id,updated_at`
      );
      const data = await r.json();
      if (!r.ok || !data.length) return res.status(200).json({ exists: false });

      const cloudDate = data[0].updated_at;
      const conflict = localUpdatedAt && cloudDate && new Date(cloudDate) > new Date(localUpdatedAt);
      return res.status(200).json({
        exists: true,
        id: data[0].id,
        cloudUpdatedAt: cloudDate,
        conflict: !!conflict
      });

    } else if (action === 'list') {
      const r = await sbFetch(
        `geosolia_projects?user_id=eq.${userId}&select=id,project_ref,project_name,updated_at&order=updated_at.desc`
      );
      const data = await r.json();
      if (!r.ok) return res.status(r.status).json({ error: data.message || JSON.stringify(data) });
      return res.status(200).json({ projects: data });

    } else if (action === 'load') {
      const { projectId } = req.body;
      if (!projectId) return res.status(400).json({ error: 'projectId requis' });

      // Charger les métadonnées
      const r = await sbFetch(
        `geosolia_projects?id=eq.${projectId}&user_id=eq.${userId}&select=*`
      );
      const data = await r.json();
      if (!r.ok || !data.length) return res.status(404).json({ error: 'Projet non trouvé' });

      // Charger les fichiers associés
      const r2 = await sbFetch(
        `geosolia_project_files?project_id=eq.${projectId}&select=file_key,file_data`
      );
      const files = await r2.json();

      return res.status(200).json({ project: data[0], files: Array.isArray(files) ? files : [] });

    } else if (action === 'delete') {
      const { projectId } = req.body;
      if (!projectId) return res.status(400).json({ error: 'projectId requis' });

      // Supprimer les fichiers d'abord
      await sbFetch(`geosolia_project_files?project_id=eq.${projectId}`, { method: 'DELETE' });
      // Supprimer le projet
      await sbFetch(`geosolia_projects?id=eq.${projectId}&user_id=eq.${userId}`, { method: 'DELETE' });

      return res.status(200).json({ ok: true });

    } else {
      return res.status(400).json({ error: 'Action inconnue: ' + action });
    }

  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
