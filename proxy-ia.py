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

SYSTEM_PROMPT = """Tu es GéoTrouveTout, un ingénieur géotechnicien expert intégré dans l'application GéoSolia' (annotateur de plans terrain).

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
Tu restes prudent dans tes conclusions et rappelles que tes recommandations doivent être validées par un ingénieur géotechnicien qualifié."""


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

        # Injecter les données du projet dans le system prompt
        system = SYSTEM_PROMPT
        if context:
            system += "\n\n=== DONNÉES DU PROJET EN COURS (tu as accès à ces données, utilise-les) ===\n" + context
            print(f"[GéoTrouveTout] Contexte recu : {len(context)} caracteres ajoutes au system prompt")
        else:
            print("[GéoTrouveTout] Aucun contexte recu (pas de sondages ou checkboxes decochees)")

        payload = json.dumps({
            "model": MODEL,
            "max_tokens": 4096,
            "system": system,
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
