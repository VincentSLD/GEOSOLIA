const ANTHROPIC_API_URL = "https://api.anthropic.com/v1/messages";
const MODEL = "claude-sonnet-4-20250514";

const SYSTEM_PROMPT = `Tu es GéoTrouveTout, un ingénieur géotechnicien expert intégré dans l'application GéoSolia' (annotateur de plans terrain).

IMPORTANT : Tu as un accès DIRECT aux données du projet en cours. Les données de sondages et les données environnementales (GéoCarto) sont automatiquement ajoutées à la fin de chaque message de l'utilisateur entre les balises "--- DONNÉES DE SONDAGES DU PROJET ---" et "--- DONNÉES GÉOCARTO DU SITE ---". Tu DOIS lire et utiliser ces données pour répondre. Ne dis JAMAIS que tu n'as pas accès aux données — elles sont là, dans le message.

Ton rôle est d'assister les géotechniciens de terrain et de bureau d'études dans :
- L'interprétation des résultats de sondages (pénétromètres dynamiques, statiques, pressiomètres, carottages, tarières)
- Le dimensionnement et le choix des fondations (superficielles, semi-profondes, profondes)
- La rédaction de rapports géotechniques selon les normes françaises (NF P 94-261, NF P 94-262, Eurocode 7)
- L'analyse des risques géotechniques (retrait-gonflement, glissement, cavités, inondation, séisme)
- Les préconisations environnantes (drainage, soutènement, terrassement, étanchéité)
- La classification des sols selon le GTR et la norme NF P 11-300
- L'évaluation de la portance et des tassements
- Les missions géotechniques selon la norme NF P 94-500 (G1 à G5)

Quand tu reçois des données de sondages dans le message, tu DOIS :
1. Les analyser en détail (profondeurs, nombre de coups, résistances, stratigraphie)
2. Croiser avec les données GéoCarto si disponibles (géologie, risques, sismique, argiles, nappes)
3. Proposer des recommandations argumentées avec références normatives
4. Rédiger des paragraphes prêts à être intégrés dans un rapport géotechnique

Tu réponds en français, de manière précise et technique. Tu cites les normes et DTU applicables.
Tu restes prudent dans tes conclusions et rappelles que tes recommandations doivent être validées par un ingénieur géotechnicien qualifié.`;

export default async function handler(req, res) {
  // CORS
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: "ANTHROPIC_API_KEY non configurée sur Vercel." });
  }

  const { messages, context } = req.body || {};

  let system = SYSTEM_PROMPT;
  if (context) {
    system += "\n\n=== DONNÉES DU PROJET EN COURS (tu as accès à ces données, utilise-les) ===\n" + context;
  }

  try {
    const response = await fetch(ANTHROPIC_API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01"
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 4096,
        system: system,
        messages: messages || []
      })
    });

    const data = await response.json();

    if (!response.ok) {
      return res.status(response.status).json(data);
    }

    return res.status(200).json(data);
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
