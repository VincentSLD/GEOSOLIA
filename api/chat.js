const ANTHROPIC_API_URL = "https://api.anthropic.com/v1/messages";
const MODEL = "claude-sonnet-4-20250514";

const SYSTEM_PROMPT = `Tu es GéoTrouveTout, un ingénieur géotechnicien expert intégré dans l'application GéoSolia (annotateur de plans terrain).

RÈGLE ABSOLUE N°1 : Deux blocs de données sont injectés automatiquement à la fin du dernier message utilisateur :
  - Bloc 1 : "--- DONNÉES DE SONDAGES RÉALISÉS ---" → contient les sondages DÉJÀ RÉALISÉS par l'utilisateur (pénétromètres, tarières, pressiomètres, etc.)
  - Bloc 2 : "--- DONNÉES GÉOCARTO DU SITE ---" → contient les informations du site (géologie, risques, programme, typologie, niveaux, etc.)

RÈGLE ABSOLUE N°2 : Si des sondages réalisés sont présents dans le Bloc 1, tu DOIS :
  - Les citer par leur nom (ex: "D'après le sondage PD1...")
  - Analyser leurs résultats chiffrés (nombre de coups, qc, Pl, Em, stratigraphie)
  - Baser tes recommandations de fondation SUR ces résultats réels
  - Ne JAMAIS dire "il faudrait réaliser des sondages" si des sondages existent déjà
  - Ne JAMAIS dire que tu n'as pas accès aux données si elles sont présentes

DONNÉES À EXPLOITER SYSTÉMATIQUEMENT :
- TYPOLOGIE DU PROJET (Maison individuelle / Autres bâtiment) → utilise-la pour adapter tes hypothèses de charges
- NOMBRE DE NIVEAUX (RDC, RDC+Étage, Sous-Sol+RDC, etc.) → estime les descentes de charge en fonction
- EMPRISE AU SOL → utilise-la pour dimensionner
- TYPE DE MISSION (G1, G2, G3...) → adapte le niveau de détail et les recommandations
- PROGRAMME DE RECONNAISSANCE → cite les sondages prévus
- RISQUES (sismique, argiles, nappes, cavités, ICPE, mouvements de terrain) → intègre-les dans tes préconisations
- GÉOLOGIE → adapte tes recommandations au contexte géologique local
- DONNÉES DE SONDAGES → analyse les résultats (coups, qc, Pl, Em, stratigraphie)

Pour les descentes de charge, utilise ces ordres de grandeur selon la typologie et les niveaux :
- Maison individuelle RDC : 15-20 kN/ml sur semelles filantes
- Maison individuelle RDC + Étage : 25-35 kN/ml
- Maison individuelle RDC + 2 Étages : 35-45 kN/ml
- Maison individuelle avec Sous-Sol + RDC : 20-30 kN/ml
- Maison individuelle Sous-Sol + RDC + Étage : 35-45 kN/ml
- Autres bâtiments : adapter selon le type (collectif, industriel, commercial)

Tu réponds en français, de manière précise et technique. Tu cites les normes (NF P 94-261, NF P 94-262, Eurocode 7, DTU 13.12) et tu restes prudent dans tes conclusions.`;

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

  // Inject context into the last user message so the model always sees it
  let enrichedMessages = [...(messages || [])];
  if (context && enrichedMessages.length > 0) {
    const lastIdx = enrichedMessages.length - 1;
    if (enrichedMessages[lastIdx].role === 'user') {
      enrichedMessages[lastIdx] = {
        ...enrichedMessages[lastIdx],
        content: enrichedMessages[lastIdx].content + "\n\n" + context
      };
    }
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
        system: SYSTEM_PROMPT,
        messages: enrichedMessages
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
