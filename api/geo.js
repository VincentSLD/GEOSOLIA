// Proxy léger pour contourner un réseau filtrant l'accès direct aux services
// cartographiques (BRGM / Géorisques / IGN). Le navigateur appelle /api/geo?url=<cible>
// et le serveur Vercel va chercher la ressource (tuile WMS, légende, JSON) et la renvoie.
// Utilisé en SECOURS uniquement (voir createTile dans index.html) : les postes non filtrés
// chargent en direct, sans ralentissement.
const ALLOWED = ['brgm.fr', 'georisques.gouv.fr', 'data.geopf.fr', 'geopf.fr', 'ign.fr', 'cartes.gouv.fr', 'arcgis.com'];

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const q = req.query || {};
  let target = q.url;
  if (!target) return res.status(400).send('Paramètre url manquant');
  if (Array.isArray(target)) target = target[0];

  // Les autres paramètres (SERVICE, VERSION, BBOX…) ajoutés par Leaflet sont réinjectés
  const extra = [];
  for (const k in q) {
    if (k === 'url') continue;
    const v = Array.isArray(q[k]) ? q[k][0] : q[k];
    extra.push(encodeURIComponent(k) + '=' + encodeURIComponent(v));
  }
  if (extra.length) target += (target.indexOf('?') >= 0 ? '&' : '?') + extra.join('&');

  let host;
  try { host = new URL(target).hostname; } catch (e) { return res.status(400).send('URL invalide'); }
  if (!ALLOWED.some(h => host === h || host.endsWith('.' + h))) {
    return res.status(403).send('Hôte non autorisé : ' + host);
  }

  try {
    const r = await fetch(target, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0 Safari/537.36',
        'Accept': 'image/avif,image/webp,image/png,application/json,*/*',
        'Accept-Language': 'fr-FR,fr;q=0.9',
        'Referer': 'https://' + host + '/'
      }
    });
    const ct = r.headers.get('content-type') || 'application/octet-stream';
    const buf = Buffer.from(await r.arrayBuffer());
    res.setHeader('Content-Type', ct);
    res.setHeader('Cache-Control', 'public, max-age=86400');
    return res.status(r.status).send(buf);
  } catch (e) {
    return res.status(502).send('Erreur proxy : ' + e.message);
  }
}
