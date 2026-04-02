"""
GeoSolia - Serveur local pour ouvrir des dossiers dans l'explorateur Windows.
Tourne en fond sur le port 9876. L'application web envoie des requetes HTTP
pour ouvrir un dossier.

Usage : double-cliquer sur open-folder.py ou lancer : python open-folder.py
Pour arreter : Ctrl+C dans la console ou fermer la fenetre.
"""

import http.server
import json
import subprocess
import os

PORT = 9876

class FolderHandler(http.server.BaseHTTPRequestHandler):

    def _send(self, code, data):
        self.send_response(code)
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type')
        self.send_header('Access-Control-Allow-Private-Network', 'true')
        self.send_header('Content-Type', 'application/json')
        self.end_headers()
        self.wfile.write(json.dumps(data).encode())

    def do_OPTIONS(self):
        self._send(200, {'ok': True})

    def do_GET(self):
        self._send(200, {'ok': True, 'service': 'GeoSolia Folder Opener', 'version': '1.0'})

    def do_POST(self):
        length = int(self.headers.get('Content-Length', 0))
        body = self.rfile.read(length).decode('utf-8')

        try:
            data = json.loads(body) if body else {}
        except:
            self._send(400, {'error': 'JSON invalide'})
            return

        if self.path == '/ping':
            self._send(200, {'ok': True, 'version': '1.0'})

        elif self.path == '/open':
            folder_path = data.get('path', '')
            if not folder_path:
                self._send(400, {'error': 'Chemin requis'})
                return
            folder_path = os.path.normpath(folder_path)
            if os.path.isdir(folder_path):
                subprocess.Popen(['explorer', folder_path])
                self._send(200, {'ok': True, 'path': folder_path})
                print(f'  Ouvert : {folder_path}')
            else:
                self._send(404, {'error': 'Dossier non trouve', 'path': folder_path})
                print(f'  Non trouve : {folder_path}')

        elif self.path == '/search':
            base_paths = data.get('paths', [])
            ref_num = data.get('ref', '')
            if not ref_num or not base_paths:
                self._send(400, {'error': 'Ref et paths requis'})
                return
            for base_path in base_paths:
                base_path = os.path.normpath(base_path)
                if not os.path.isdir(base_path):
                    continue
                try:
                    for name in os.listdir(base_path):
                        full = os.path.join(base_path, name)
                        if os.path.isdir(full) and (name.startswith(ref_num + '_') or name == ref_num):
                            self._send(200, {'found': True, 'path': full, 'name': name})
                            print(f'  Trouve : {full}')
                            return
                except PermissionError:
                    continue
            self._send(200, {'found': False})
            print(f'  Non trouve : ref={ref_num} dans {base_paths}')

        else:
            self._send(404, {'error': 'Endpoint inconnu'})

    def log_message(self, format, *args):
        print(f'[GeoSolia] {args[0]}')


if __name__ == '__main__':
    print('=' * 50)
    print('  GeoSolia - Ouverture de dossiers')
    print(f'  Serveur local sur le port {PORT}')
    print('  Ctrl+C pour arreter')
    print('=' * 50)

    server = http.server.HTTPServer(('localhost', PORT), FolderHandler)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print('\nArret du serveur.')
        server.server_close()
