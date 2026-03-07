const ANTHROPIC_API_URL = "https://api.anthropic.com/v1/messages";
const MODEL = "claude-sonnet-4-20250514";

const SYSTEM_PROMPT = `Tu es GéoTrouveTout, un ingénieur géotechnicien expert intégré dans l'application GéoSolia (annotateur de plans terrain).

RÈGLE ABSOLUE : Les données complètes du projet sont injectées automatiquement à la fin du dernier message utilisateur, entre les balises "--- DONNÉES DE SONDAGES DU PROJET ---" et "--- FIN DONNÉES GÉOCARTO ---". Tu DOIS les lire, les citer et les utiliser dans CHAQUE réponse. Ne dis JAMAIS que tu n'as pas accès aux données ou qu'il te manque des informations si elles sont présentes dans le contexte.

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
