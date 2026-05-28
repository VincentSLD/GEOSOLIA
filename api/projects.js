/**
 * API Vercel pour la synchronisation des projets GéoSolia avec Supabase.
 * Endpoints :
 *   POST /api/projects?action=save         — Sauvegarder un projet
 *   POST /api/projects?action=list         — Lister les projets de l'utilisateur
 *   POST /api/projects?action=load         — Charger un projet
 *   POST /api/projects?action=delete       — Supprimer un projet
 *   POST /api/projects?action=admin-list   — Lister TOUS les projets (admin only)
 *   POST /api/projects?action=admin-delete — Supprimer un projet par ID (admin only)
 */

const SUPABASE_URL = 'https://asuccniyofzvwgooxjah.supabase.co';
const ADMIN_EMAILS = ['vsalaud@be-gph.fr'];

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

  // Décoder le JWT pour obtenir le user_id et l'email
  let userId, userEmail;
  try {
    const payload = JSON.parse(Buffer.from(token.split('.')[1], 'base64').toString());
    userId = payload.sub;
    userEmail = payload.email || '';
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
      const { projectRef, projectName, projectData, files, projectId: existingId } = req.body;
      if (!projectRef) return res.status(400).json({ error: 'projectRef requis' });

      let projectId = existingId || null;

      if (projectId) {
        // UPDATE existant (la ref a pu changer)
        const r = await sbFetch(
          `geosolia_projects?id=eq.${projectId}&user_id=eq.${userId}`,
          {
            method: 'PATCH',
            prefer: 'return=representation',
            body: JSON.stringify({
              project_ref: projectRef,
              project_name: projectName || '',
              project_data: projectData,
              updated_at: new Date().toISOString()
            })
          }
        );
        const data = await r.json();
        if (!r.ok || !data.length) {
          // Fallback : si l'id n'existe plus, créer un nouveau
          projectId = null;
        } else {
          projectId = data[0].id;
        }
      }

      if (!projectId) {
        // Chercher si un projet avec la même ref existe déjà pour cet utilisateur
        const rLookup = await sbFetch(
          `geosolia_projects?user_id=eq.${userId}&project_ref=eq.${encodeURIComponent(projectRef)}&select=id&limit=1`
        );
        if (rLookup.ok) {
          const existing = await rLookup.json();
          if (existing && existing.length > 0) {
            // Mettre à jour le projet existant (évite les doublons)
            projectId = existing[0].id;
            const rPatch = await sbFetch(
              `geosolia_projects?id=eq.${projectId}&user_id=eq.${userId}`,
              {
                method: 'PATCH',
                prefer: 'return=representation',
                body: JSON.stringify({
                  project_ref: projectRef,
                  project_name: projectName || '',
                  project_data: projectData,
                  updated_at: new Date().toISOString()
                })
              }
            );
            const patchData = await rPatch.json();
            if (rPatch.ok && patchData.length) {
              projectId = patchData[0].id;
            }
          }
        }
      }

      if (!projectId) {
        // Aucun projet existant : INSERT
        const r = await sbFetch(
          `geosolia_projects`,
          {
            method: 'POST',
            prefer: 'return=representation',
            body: JSON.stringify({
              user_id: userId,
              project_ref: projectRef,
              project_name: projectName || '',
              project_data: projectData,
              updated_at: new Date().toISOString()
            })
          }
        );
        const data = await r.json();
        if (!r.ok) return res.status(r.status).json({ error: data.message || JSON.stringify(data) });
        projectId = Array.isArray(data) ? data[0]?.id : data.id;
      }

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

    } else if (action === 'savefile') {
      // Sauvegarder un fichier individuel (plan, photo, image)
      const { projectId, fileKey, fileData } = req.body;
      if (!projectId || !fileKey || !fileData) {
        return res.status(400).json({ error: 'projectId, fileKey et fileData requis' });
      }
      const r = await sbFetch(
        `geosolia_project_files?on_conflict=project_id,file_key`,
        {
          method: 'POST',
          prefer: 'resolution=merge-duplicates',
          body: JSON.stringify({
            project_id: projectId,
            file_key: fileKey,
            file_data: fileData,
            updated_at: new Date().toISOString()
          })
        }
      );
      if (!r.ok) {
        const data = await r.json();
        return res.status(r.status).json({ error: data.message || JSON.stringify(data) });
      }
      return res.status(200).json({ ok: true });

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
      // Essayer d'abord avec les opérateurs JSON PostgREST (léger)
      let r = await sbFetch(
        `geosolia_projects?user_id=eq.${userId}&select=id,project_ref,project_name,updated_at,addr:project_data->>projectAddr,cp:project_data->>projectCp,ville:project_data->>projectVille,mission:project_data->>projectMission&order=updated_at.desc&limit=10000`
      );
      let data;
      if (r.ok) {
        data = await r.json();
        const projects = (data || []).map(p => ({
          id: p.id,
          project_ref: p.project_ref,
          project_name: p.project_name,
          project_addr: p.addr || '',
          project_cp: p.cp || '',
          project_ville: p.ville || '',
          project_mission: p.mission || '',
          updated_at: p.updated_at
        }));
        return res.status(200).json({ projects });
      }
      // Fallback : requête sans opérateurs JSON (plus lourd mais compatible)
      r = await sbFetch(
        `geosolia_projects?user_id=eq.${userId}&select=id,project_ref,project_name,project_data,updated_at&order=updated_at.desc&limit=10000`
      );
      data = await r.json();
      if (!r.ok) return res.status(r.status).json({ error: data.message || JSON.stringify(data) });
      const projects = (data || []).map(p => ({
        id: p.id,
        project_ref: p.project_ref,
        project_name: p.project_name,
        project_addr: p.project_data?.projectAddr || '',
        project_cp: p.project_data?.projectCp || '',
        project_ville: p.project_data?.projectVille || '',
        project_mission: p.project_data?.projectMission || '',
        updated_at: p.updated_at
      }));
      return res.status(200).json({ projects });

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

    } else if (action === 'admin-list') {
      // Admin only : lister TOUS les projets de tous les utilisateurs
      if (!ADMIN_EMAILS.includes(userEmail)) return res.status(403).json({ error: 'Accès réservé aux administrateurs' });
      let r = await sbFetch(
        `geosolia_projects?select=id,user_id,project_ref,project_name,updated_at,addr:project_data->>projectAddr,cp:project_data->>projectCp,ville:project_data->>projectVille&order=updated_at.desc&limit=10000`
      );
      let data;
      let projects;
      if (r.ok) {
        data = await r.json();
        projects = (data || []).map(p => ({
          id: p.id, user_id: p.user_id,
          project_ref: p.project_ref, project_name: p.project_name,
          project_addr: p.addr || '', project_cp: p.cp || '', project_ville: p.ville || '',
          updated_at: p.updated_at, has_files: false, commande_ref: ''
        }));
      } else {
        // Fallback sans opérateurs JSON
        r = await sbFetch(
          `geosolia_projects?select=id,user_id,project_ref,project_name,project_data,updated_at&order=updated_at.desc&limit=10000`
        );
        data = await r.json();
        if (!r.ok) return res.status(r.status).json({ error: data.message || JSON.stringify(data) });
        projects = (data || []).map(p => ({
          id: p.id, user_id: p.user_id,
          project_ref: p.project_ref, project_name: p.project_name,
          project_addr: p.project_data?.projectAddr || '', project_cp: p.project_data?.projectCp || '', project_ville: p.project_data?.projectVille || '',
          updated_at: p.updated_at, has_files: false, commande_ref: ''
        }));
      }

      // Récupérer les project_id qui ont des fichiers cloud
      try {
        const rFiles = await sbFetch(`geosolia_project_files?select=project_id&limit=10000`);
        if (rFiles.ok) {
          const filesData = await rFiles.json();
          const idsWithFiles = new Set((filesData || []).map(f => f.project_id));
          projects.forEach(p => { if (idsWithFiles.has(p.id)) p.has_files = true; });
        }
      } catch (e) { /* ignore */ }

      // Récupérer les liens commande depuis geoplan_interventions
      try {
        const rInt = await sbFetch(`geoplan_interventions?select=geosolia_id,commande_ref&geosolia_id=not.is.null&limit=10000`);
        if (rInt.ok) {
          const intData = await rInt.json();
          const cmdMap = {};
          (intData || []).forEach(i => {
            if (i.geosolia_id && i.commande_ref) cmdMap[i.geosolia_id] = i.commande_ref;
          });
          projects.forEach(p => { if (cmdMap[p.id]) p.commande_ref = cmdMap[p.id]; });
        }
      } catch (e) { /* ignore */ }

      return res.status(200).json({ projects });

    } else if (action === 'admin-delete') {
      // Admin only : supprimer un projet par ID (sans restriction user_id)
      if (!ADMIN_EMAILS.includes(userEmail)) return res.status(403).json({ error: 'Accès réservé aux administrateurs' });
      const { projectId } = req.body;
      if (!projectId) return res.status(400).json({ error: 'projectId requis' });
      await sbFetch(`geosolia_project_files?project_id=eq.${projectId}`, { method: 'DELETE' });
      await sbFetch(`geosolia_projects?id=eq.${projectId}`, { method: 'DELETE' });
      return res.status(200).json({ ok: true });

    } else {
      return res.status(400).json({ error: 'Action inconnue: ' + action });
    }

  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
