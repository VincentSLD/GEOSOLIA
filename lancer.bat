@echo off
title GeoTer - Serveur local
cd /d "%~dp0"

echo.
echo  ========================================
echo    GeoTer - Serveur local
echo  ========================================
echo.
echo  Ouverture dans le navigateur...
echo  Pour arreter : fermez cette fenetre ou Ctrl+C
echo.

start http://localhost:8080
python -m http.server 8080
