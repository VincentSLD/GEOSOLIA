const OPENAI_API_URL = "https://api.openai.com/v1/images/generations";
const OPENAI_CHAT_URL = "https://api.openai.com/v1/chat/completions";

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: "OPENAI_API_KEY non configurée sur Vercel." });
  }

  const { prompt, image_base64, width, height, mode } = req.body || {};

  if (!prompt) {
    return res.status(400).json({ error: "Prompt requis." });
  }

  try {
    if (mode === "dalle") {
      // DALL-E 3 : génération d'image à partir du prompt
      const w = Number(width) || 512, h = Number(height) || 512;
      const size = w > h * 1.3 ? "1792x1024" : h > w * 1.3 ? "1024x1792" : "1024x1024";
      // DALL-E 3 limite le prompt à 4000 caractères
      const safePrompt = prompt.length > 3900 ? prompt.substring(0, 3900) : prompt;
      const response = await fetch(OPENAI_API_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${apiKey}`
        },
        body: JSON.stringify({
          model: "dall-e-3",
          prompt: safePrompt,
          n: 1,
          size: size,
          response_format: "b64_json",
          quality: "standard"
        })
      });

      const data = await response.json();
      if (!response.ok) {
        const msg = data?.error?.message || JSON.stringify(data);
        return res.status(response.status).json({ error: { message: msg } });
      }
      return res.status(200).json({
        image: data.data?.[0]?.b64_json || null,
        revised_prompt: data.data?.[0]?.revised_prompt || ""
      });

    } else {
      // GPT-4o : analyse du croquis + génération SVG
      const messages = [
        {
          role: "user",
          content: [
            ...(image_base64 ? [{
              type: "image_url",
              image_url: { url: `data:image/png;base64,${image_base64}`, detail: "high" }
            }] : []),
            { type: "text", text: prompt }
          ]
        }
      ];

      const response = await fetch(OPENAI_CHAT_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${apiKey}`
        },
        body: JSON.stringify({
          model: "gpt-4o",
          max_tokens: 4096,
          messages: messages
        })
      });

      const data = await response.json();
      if (!response.ok) {
        const msg = data?.error?.message || JSON.stringify(data);
        return res.status(response.status).json({ error: { message: msg } });
      }
      return res.status(200).json({
        text: data.choices?.[0]?.message?.content || ""
      });
    }

  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
