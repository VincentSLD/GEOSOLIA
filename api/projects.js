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

  // Fonction partagée : enrichir les projets avec file_count et commande_ref
  async function enrichProjects(projects, sbFetch) {
    // Compter les fichiers par projet
    try {
      const rFiles = await sbFetch(`geosolia_project_files?select=project_id&limit=50000`);
      if (rFiles.ok) {
        const filesData = await rFiles.json();
        const fileCounts = {};
        (filesData || []).forEach(f => { fileCounts[f.project_id] = (fileCounts[f.project_id] || 0) + 1; });
        projects.forEach(p => { p.file_count = fileCounts[p.id] || 0; });
      }
    } catch (e) { /* ignore */ }

    // Liens commande depuis geoplan_interventions + geoplan_settings
    try {
      const cmdMap = {};
      const rInt = await sbFetch(`geoplan_interventions?select=geosolia_id,commande_id,commande_ref&limit=10000`);
      if (rInt.ok) {
        const intData = await rInt.json();
        const cmdIdToRef = {};
        (intData || []).forEach(i => {
          if (i.commande_id && i.commande_ref) cmdIdToRef[i.commande_id] = i.commande_ref;
          if (i.geosolia_id && i.commande_ref) cmdMap[i.geosolia_id] = i.commande_ref;
        });
        try {
          const rSettings = await sbFetch(`geoplan_settings?key=eq.geoplan_cmd_geosolia&select=value`);
          if (rSettings.ok) {
            const settingsData = await rSettings.json();
            if (settingsData && settingsData[0] && settingsData[0].value) {
              const links = settingsData[0].value;
              Object.entries(links).forEach(([cmdId, geoId]) => {
                if (geoId && !cmdMap[geoId]) {
                  cmdMap[geoId] = cmdIdToRef[cmdId] || cmdId;
                }
              });
            }
          }
        } catch (e2) { /* ignore */ }
      }
      projects.forEach(p => { if (cmdMap[p.id]) p.commande_ref = cmdMap[p.id]; });
    } catch (e) { /* ignore */ }
  }

  try {
    if (action === 'save') {
      const { projectRef, projectName, projectData, files, projectId: existingId } = req.body;
      if (!projectRef) return res.status(400).json({ error: 'projectRef requis' });

      let projectId = existingId || null;

      if (projectId) {
        // UPDATE existant par ID (sans filtre user_id pour pouvoir modifier un projet d'un autre utilisateur)
        const r = await sbFetch(
          `geosolia_projects?id=eq.${projectId}`,
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
        // Chercher si un projet avec la même ref existe déjà (tous utilisateurs)
        const rLookup = await sbFetch(
          `geosolia_projects?project_ref=eq.${encodeURIComponent(projectRef)}&select=id&limit=1`
        );
        if (rLookup.ok) {
          const existing = await rLookup.json();
          if (existing && existing.length > 0) {
            // Mettre à jour le projet existant (évite les doublons)
            projectId = existing[0].id;
            const rPatch = await sbFetch(
              `geosolia_projects?id=eq.${projectId}`,
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

      // Sync commentaires → GéoPlan (commandes) + Akuiteo (custom_data)
      const comment = (projectData && (
        (projectData.geocartoData && projectData.geocartoData.infosGeotech) ||
        projectData.infoGeotechnicien
      )) || '';
      if (projectId && comment !== undefined) {
        try {
          // 1. Trouver les commandes liées via geoplan_interventions
          const cmdIds = new Set();
          const rInt = await sbFetch(`geoplan_interventions?geosolia_id=eq.${projectId}&select=commande_id&limit=100`);
          if (rInt.ok) {
            const ints = await rInt.json();
            (ints || []).forEach(i => { if (i.commande_id) cmdIds.add(i.commande_id); });
          }
          // 2. Aussi vérifier geoplan_settings pour les liens commande↔geosolia
          try {
            const rSettings = await sbFetch(`geoplan_settings?key=eq.geoplan_cmd_geosolia&select=value`);
            if (rSettings.ok) {
              const settingsData = await rSettings.json();
              if (settingsData && settingsData[0] && settingsData[0].value) {
                const links = settingsData[0].value;
                Object.entries(links).forEach(([cmdId, geoId]) => {
                  if (geoId === projectId) cmdIds.add(cmdId);
                });
              }
            }
          } catch (e2) { /* ignore */ }

          // 3. Mettre à jour chaque commande liée
          for (const cmdId of cmdIds) {
            const rCmd = await sbFetch(`commandes?id=eq.${encodeURIComponent(cmdId)}&select=id,ref,custom_data`);
            if (!rCmd.ok) continue;
            const cmds = await rCmd.json();
            if (!cmds || !cmds[0]) continue;
            const cmd = cmds[0];
            const cd = cmd.custom_data || {};
            // Trouver la clé Commentaires (match exact puis partiel)
            let commentKey = null;
            for (const k in cd) {
              if (cd[k] && cd[k].name) {
                const n = cd[k].name.trim().toLowerCase();
                if (n === 'commentaires' || n === 'commentaire') { commentKey = k; break; }
              }
            }
            if (!commentKey) {
              for (const k in cd) {
                if (cd[k] && cd[k].name && cd[k].name.toLowerCase().indexOf('commentaire') >= 0) { commentKey = k; break; }
              }
            }
            if (commentKey) cd[commentKey].value = comment || null;
            // 3a. Supabase : commandes.description + custom_data
            await sbFetch(`commandes?id=eq.${encodeURIComponent(cmdId)}`, {
              method: 'PATCH',
              body: JSON.stringify({ description: comment, custom_data: cd })
            });
            // 3b. Supabase : interventions.infos_adv
            await sbFetch(`geoplan_interventions?commande_id=eq.${encodeURIComponent(cmdId)}`, {
              method: 'PATCH',
              body: JSON.stringify({ infos_adv: comment })
            });
            // 3c. Akuiteo : push custom_data via batch-update
            if (commentKey && cmd.ref) {
              try {
                const akUrl = process.env.AKUITEO_BASE_URL || 'https://novamingenierie-test.myakuiteo.com/akuiteo/rest';
                const akUser = process.env.AKUITEO_USER || 'API1';
                const akPass = process.env.AKUITEO_PASS || 'API1';
                const akAuth = 'Basic ' + Buffer.from(akUser + ':' + akPass).toString('base64');
                await fetch(akUrl + '/sales/orders/custom-data/batch-update', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json', 'Accept': 'application/json', 'Authorization': akAuth },
                  body: JSON.stringify({
                    ids: [cmd.ref],
                    customData: { [commentKey]: { type: cd[commentKey].type || 'ALPHANUMERIC', value: comment || null } }
                  })
                });
              } catch (akErr) { console.warn('[Sync Akuiteo] Erreur:', akErr.message); }
            }
          }
        } catch (e) { console.warn('[Sync GéoPlan+Akuiteo] Erreur sync commentaires:', e.message); }
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
        `geosolia_projects?project_ref=eq.${encodeURIComponent(projectRef)}&select=id,updated_at`
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
        `geosolia_projects?select=id,project_ref,project_name,updated_at,addr:project_data->>projectAddr,cp:project_data->>projectCp,ville:project_data->>projectVille,mission:project_data->>projectMission&order=updated_at.desc&limit=10000`
      );
      let data;
      let projects;
      if (r.ok) {
        data = await r.json();
        projects = (data || []).map(p => ({
          id: p.id,
          project_ref: p.project_ref,
          project_name: p.project_name,
          project_addr: p.addr || '',
          project_cp: p.cp || '',
          project_ville: p.ville || '',
          project_mission: p.mission || '',
          updated_at: p.updated_at, file_count: 0, commande_ref: ''
        }));
      } else {
        // Fallback : requête sans opérateurs JSON (plus lourd mais compatible)
        r = await sbFetch(
          `geosolia_projects?select=id,project_ref,project_name,project_data,updated_at&order=updated_at.desc&limit=10000`
        );
        data = await r.json();
        if (!r.ok) return res.status(r.status).json({ error: data.message || JSON.stringify(data) });
        projects = (data || []).map(p => ({
          id: p.id,
          project_ref: p.project_ref,
          project_name: p.project_name,
          project_addr: p.project_data?.projectAddr || '',
          project_cp: p.project_data?.projectCp || '',
          project_ville: p.project_data?.projectVille || '',
          project_mission: p.project_data?.projectMission || '',
          updated_at: p.updated_at, file_count: 0, commande_ref: ''
        }));
      }
      // Enrichir avec fichiers + commandes
      await enrichProjects(projects, sbFetch);
      return res.status(200).json({ projects });

    } else if (action === 'load') {
      const { projectId } = req.body;
      if (!projectId) return res.status(400).json({ error: 'projectId requis' });

      // Charger les métadonnées
      const r = await sbFetch(
        `geosolia_projects?id=eq.${projectId}&select=*`
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
      await sbFetch(`geosolia_projects?id=eq.${projectId}`, { method: 'DELETE' });

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
          updated_at: p.updated_at, file_count: 0, commande_ref: ''
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
          updated_at: p.updated_at, file_count: 0, commande_ref: ''
        }));
      }

      // Enrichir avec fichiers + commandes
      await enrichProjects(projects, sbFetch);
      return res.status(200).json({ projects });

    } else if (action === 'admin-delete') {
      // Admin only : supprimer un projet par ID (sans restriction user_id)
      if (!ADMIN_EMAILS.includes(userEmail)) return res.status(403).json({ error: 'Accès réservé aux administrateurs' });
      const { projectId } = req.body;
      if (!projectId) return res.status(400).json({ error: 'projectId requis' });
      await sbFetch(`geosolia_project_files?project_id=eq.${projectId}`, { method: 'DELETE' });
      await sbFetch(`geosolia_projects?id=eq.${projectId}`, { method: 'DELETE' });
      return res.status(200).json({ ok: true });

    } else if (action === 'admin-dedup') {
      // Admin only : supprimer les doublons (garder le plus récent par user_id+project_ref)
      if (!ADMIN_EMAILS.includes(userEmail)) return res.status(403).json({ error: 'Accès réservé aux administrateurs' });
      const r = await sbFetch(`geosolia_projects?select=id,user_id,project_ref,updated_at&order=updated_at.desc&limit=10000`);
      if (!r.ok) return res.status(r.status).json({ error: 'Erreur lecture projets' });
      const all = await r.json();
      const seen = {};
      const toDelete = [];
      for (const p of all) {
        const key = (p.user_id || '') + '|' + (p.project_ref || '');
        if (seen[key]) {
          toDelete.push(p.id); // doublon (plus ancien car trié desc)
        } else {
          seen[key] = p.id;
        }
      }
      // Supprimer les doublons et leurs fichiers
      for (const id of toDelete) {
        await sbFetch(`geosolia_project_files?project_id=eq.${id}`, { method: 'DELETE' });
        await sbFetch(`geosolia_projects?id=eq.${id}`, { method: 'DELETE' });
      }
      return res.status(200).json({ deleted: toDelete.length });

    } else {
      return res.status(400).json({ error: 'Action inconnue: ' + action });
    }

  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
