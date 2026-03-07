#!/usr/bin/env python3
"""
Proxy local pour GéoTrouveTout — Assistant IA Géotechnique
Relaye les requêtes du navigateur vers l'API Claude (Anthropic).

Usage:
  1. Installer la clé API:  set ANTHROPIC_API_KEY=sk-ant-...
  2. Lancer:                python proxy-ia.py
  3. Le proxy écoute sur    http://localhost:3456
"""
import http.server
import json
import os
import urllib.request
import ssl

PORT = 3456
API_URL = "https://api.anthropic.com/v1/messages"
MODEL = "claude-sonnet-4-20250514"
KEY_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "api-key.txt")

def get_api_key():
    # 1) Lire depuis api-key.txt
    if os.path.exists(KEY_FILE):
        with open(KEY_FILE, "r") as f:
            key = f.read().strip()
            if key:
                return key
    # 2) Sinon, variable d'environnement
    return os.environ.get("ANTHROPIC_API_KEY", "")

SYSTEM_PROMPT = """Tu es GéoTrouveTout, un ingénieur géotechnicien expert intégré dans l'application GéoSolia (annotateur de plans terrain).

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

Tu réponds en français, de manière précise et technique. Tu cites les normes (NF P 94-261, NF P 94-262, Eurocode 7, DTU 13.12) et tu restes prudent dans tes conclusions."""


class ProxyHandler(http.server.BaseHTTPRequestHandler):
    def do_OPTIONS(self):
        self.send_response(200)
        self._cors_headers()
        self.end_headers()

    def do_POST(self):
        api_key = get_api_key()
        if not api_key:
            self.send_response(500)
            self._cors_headers()
            self.end_headers()
            self.wfile.write(json.dumps({"error": "ANTHROPIC_API_KEY non définie. Lancez: set ANTHROPIC_API_KEY=sk-ant-..."}).encode())
            return

        length = int(self.headers.get("Content-Length", 0))
        body = json.loads(self.rfile.read(length)) if length else {}
        messages = body.get("messages", [])
        context = body.get("context", "")

        # Injecter le contexte dans le dernier message utilisateur
        if context and messages and messages[-1].get("role") == "user":
            messages[-1] = {**messages[-1], "content": messages[-1]["content"] + "\n\n" + context}
            print(f"[GéoTrouveTout] Contexte recu : {len(context)} caracteres injectes dans le message")
        else:
            print("[GéoTrouveTout] Aucun contexte recu (pas de sondages ou checkboxes decochees)")

        payload = json.dumps({
            "model": MODEL,
            "max_tokens": 4096,
            "system": SYSTEM_PROMPT,
            "messages": messages
        }).encode()

        req = urllib.request.Request(API_URL, data=payload, method="POST")
        req.add_header("Content-Type", "application/json")
        req.add_header("x-api-key", api_key)
        req.add_header("anthropic-version", "2023-06-01")

        ctx = ssl.create_default_context()
        try:
            with urllib.request.urlopen(req, context=ctx) as resp:
                data = resp.read()
                self.send_response(200)
                self._cors_headers()
                self.end_headers()
                self.wfile.write(data)
        except urllib.error.HTTPError as e:
            err_body = e.read().decode()
            self.send_response(e.code)
            self._cors_headers()
            self.end_headers()
            self.wfile.write(err_body.encode())
        except Exception as e:
            self.send_response(500)
            self._cors_headers()
            self.end_headers()
            self.wfile.write(json.dumps({"error": str(e)}).encode())

    def _cors_headers(self):
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")

    def log_message(self, fmt, *args):
        print(f"[GéoTrouveTout] {args[0]}")


if __name__ == "__main__":
    print(f"╔══════════════════════════════════════════╗")
    print(f"║   GéoTrouveTout - Proxy IA Géotechnique        ║")
    print(f"║   http://localhost:{PORT}                  ║")
    print(f"╚══════════════════════════════════════════╝")
    if get_api_key():
        print("✓  Clé API détectée")
    else:
        print("⚠  Clé API non trouvée !")
        print("   Créez un fichier api-key.txt avec votre clé dedans.")
    print("En attente de requêtes...")
    server = http.server.HTTPServer(("127.0.0.1", PORT), ProxyHandler)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nArrêt du proxy.")
