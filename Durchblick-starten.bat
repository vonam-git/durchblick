@echo off
rem ============================================================
rem  Durchblick starten (Windows) - einfach doppelklicken
rem  Erster Start: richtet Python-Umgebung und Module ein.
rem  Einfacher ohne Python: Durchblick-Setup.exe von GitHub
rem  https://github.com/vonam-git/durchblick/releases
rem ============================================================
chcp 65001 >nul
cd /d "%~dp0"
title Durchblick

set "PY="
where py >nul 2>nul && set "PY=py -3"
if not defined PY (where python >nul 2>nul && python -c "import sys" >nul 2>nul && set "PY=python")
if not defined PY goto nopython

if not exist ".venv\Scripts\pythonw.exe" (
  echo Erster Start: Durchblick wird eingerichtet ^(1-2 Minuten^) ...
  %PY% -m venv .venv || goto fehler
)
fc /b requirements.txt ".venv\requirements.installed" >nul 2>nul
if errorlevel 1 (
  echo Installiere benoetigte Module ...
  ".venv\Scripts\python.exe" -m pip install --disable-pip-version-check -q -r requirements.txt || goto fehler
  copy /y requirements.txt ".venv\requirements.installed" >nul
)

start "" ".venv\Scripts\pythonw.exe" durchblick_panel.py
exit /b 0

:nopython
echo.
echo  Python wurde nicht gefunden.
echo.
echo  Am einfachsten: Durchblick-Setup.exe installieren (Python ist enthalten):
echo  https://github.com/vonam-git/durchblick/releases
echo.
echo  Oder Python von https://www.python.org/downloads/ installieren
echo  und dabei "Add python.exe to PATH" anhaken. Danach nochmals doppelklicken.
echo.
pause
exit /b 1

:fehler
echo.
echo  Die Einrichtung ist fehlgeschlagen. Internetverbindung pruefen und nochmals versuchen.
echo  Hilft das nicht: Ordner .venv loeschen und nochmals doppelklicken.
echo.
pause
exit /b 1
