import { createHmac } from 'crypto';

const ADMIN_EMAIL = 'vsalaud@be-gph.fr';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const resendKey = process.env.RESEND_API_KEY;
  const secret = process.env.APPROVE_SECRET;
  if (!resendKey || !secret) return res.status(500).json({ error: 'Config manquante (RESEND_API_KEY ou APPROVE_SECRET)' });

  const { user_id, user_email, user_name } = req.body || {};
  if (!user_id || !user_email) return res.status(400).json({ error: 'user_id et user_email requis' });

  // Generer le token HMAC
  const token = createHmac('sha256', secret).update(user_id).digest('hex');

  // URL du site (auto-detect depuis le header Host, ou fallback)
  const host = req.headers['x-forwarded-host'] || req.headers.host || 'geosolia.vercel.app';
  const protocol = host.includes('localhost') ? 'http' : 'https';
  const approveUrl = `${protocol}://${host}/api/approve-user?user_id=${user_id}&token=${token}`;

  const displayName = user_name || user_email;

  // Envoyer l'email via Resend
  try {
    const emailRes = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${resendKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        from: 'GeoSolia <onboarding@resend.dev>',
        to: [ADMIN_EMAIL],
        subject: `GeoSolia — Nouvelle demande d'acces : ${displayName}`,
        html: `
          <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;max-width:500px;margin:0 auto;padding:20px">
            <div style="background:#1A1A1A;border-radius:12px;padding:24px;text-align:center;margin-bottom:20px">
              <h1 style="color:#F2B705;margin:0;font-size:24px">GeoSolia'</h1>
              <p style="color:rgba(255,255,255,0.5);font-size:11px;margin:4px 0 0;text-transform:uppercase;letter-spacing:0.05em">by GPH</p>
            </div>
            <h2 style="margin:0 0 16px;font-size:18px;color:#1A1A1A">Nouvelle demande d'acces</h2>
            <p style="color:#4A4A4A;font-size:14px;line-height:1.6;margin:0 0 8px">
              <strong>${displayName}</strong> (${user_email}) souhaite acceder a GeoSolia.
            </p>
            <div style="text-align:center;margin:28px 0">
              <a href="${approveUrl}" style="background:#4CAF50;color:#fff;text-decoration:none;padding:14px 32px;border-radius:8px;font-weight:800;font-size:14px;display:inline-block">
                Approuver l'acces
              </a>
            </div>
            <p style="color:#B0B0B0;font-size:11px;text-align:center">Si vous ne reconnaissez pas cette personne, ignorez cet email.</p>
          </div>
        `
      })
    });

    if (!emailRes.ok) {
      const errData = await emailRes.json();
      return res.status(500).json({ error: 'Erreur Resend: ' + (errData.message || JSON.stringify(errData)) });
    }

    return res.status(200).json({ ok: true });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
