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
import sys
import urllib.parse

PORT = 9876

class FolderHandler(http.server.BaseHTTPRequestHandler):
    def do_OPTIONS(self):
        self.send_response(200)
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'POST, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type')
        self.end_headers()

    def do_POST(self):
        self.send_header('Access-Control-Allow-Origin', '*')

        if self.path == '/open':
            length = int(self.headers.get('Content-Length', 0))
            body = self.rfile.read(length).decode('utf-8')

            try:
                data = json.loads(body)
                folder_path = data.get('path', '')

                if not folder_path:
                    self.send_response(400)
                    self.send_header('Content-Type', 'application/json')
                    self.end_headers()
                    self.wfile.write(json.dumps({'error': 'Chemin requis'}).encode())
                    return

                # Normaliser le chemin
                folder_path = os.path.normpath(folder_path)

                # Verifier que le dossier existe
                if os.path.isdir(folder_path):
                    subprocess.Popen(['explorer', folder_path])
                    self.send_response(200)
                    self.send_header('Content-Type', 'application/json')
                    self.end_headers()
                    self.wfile.write(json.dumps({'ok': True, 'path': folder_path}).encode())
                    print(f'  Ouvert : {folder_path}')
                else:
                    self.send_response(404)
                    self.send_header('Content-Type', 'application/json')
                    self.end_headers()
                    self.wfile.write(json.dumps({'error': 'Dossier non trouve', 'path': folder_path}).encode())
                    print(f'  Non trouve : {folder_path}')

            except Exception as e:
                self.send_response(500)
                self.send_header('Content-Type', 'application/json')
                self.end_headers()
                self.wfile.write(json.dumps({'error': str(e)}).encode())

        elif self.path == '/search':
            length = int(self.headers.get('Content-Length', 0))
            body = self.rfile.read(length).decode('utf-8')

            try:
                data = json.loads(body)
                base_paths = data.get('paths', [])
                ref_num = data.get('ref', '')

                if not ref_num or not base_paths:
                    self.send_response(400)
                    self.send_header('Content-Type', 'application/json')
                    self.end_headers()
                    self.wfile.write(json.dumps({'error': 'Ref et paths requis'}).encode())
                    return

                # Chercher dans chaque chemin
                for base_path in base_paths:
                    base_path = os.path.normpath(base_path)
                    if not os.path.isdir(base_path):
                        continue
                    for name in os.listdir(base_path):
                        full = os.path.join(base_path, name)
                        if os.path.isdir(full) and (name.startswith(ref_num + '_') or name == ref_num):
                            self.send_response(200)
                            self.send_header('Content-Type', 'application/json')
                            self.end_headers()
                            self.wfile.write(json.dumps({'found': True, 'path': full, 'name': name}).encode())
                            print(f'  Trouve : {full}')
                            return

                self.send_response(200)
                self.send_header('Content-Type', 'application/json')
                self.end_headers()
                self.wfile.write(json.dumps({'found': False}).encode())
                print(f'  Non trouve : ref={ref_num} dans {base_paths}')

            except Exception as e:
                self.send_response(500)
                self.send_header('Content-Type', 'application/json')
                self.end_headers()
                self.wfile.write(json.dumps({'error': str(e)}).encode())

        elif self.path == '/ping':
            self.send_response(200)
            self.send_header('Content-Type', 'application/json')
            self.end_headers()
            self.wfile.write(json.dumps({'ok': True, 'version': '1.0'}).encode())

        else:
            self.send_response(404)
            self.end_headers()

    def do_GET(self):
        self.send_response(200)
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Content-Type', 'application/json')
        self.end_headers()
        self.wfile.write(json.dumps({'ok': True, 'service': 'GeoSolia Folder Opener', 'version': '1.0'}).encode())

    def log_message(self, format, *args):
        print(f'[GeoSolia] {args[0]}')


if __name__ == '__main__':
    print('='*50)
    print('  GeoSolia - Ouverture de dossiers')
    print(f'  Serveur local sur le port {PORT}')
    print('  Ctrl+C pour arreter')
    print('='*50)

    server = http.server.HTTPServer(('127.0.0.1', PORT), FolderHandler)

    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print('\nArret du serveur.')
        server.server_close()
