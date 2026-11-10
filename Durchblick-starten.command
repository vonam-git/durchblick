#!/usr/bin/env bash
# ============================================================
#  Durchblick starten (macOS und Linux)
#  macOS: im Finder doppelklicken. Linux: ./Durchblick-starten.command
#  Erster Start: richtet Python-Umgebung und Module ein.
# ============================================================
cd "$(dirname "$0")" || exit 1

PY=""
for c in python3 python; do
  if command -v "$c" >/dev/null 2>&1 && "$c" -c "import sys; sys.exit(sys.version_info < (3, 9))"; then
    PY="$c"; break
  fi
done
if [ -z "$PY" ]; then
  echo "Python 3.9 oder neuer wurde nicht gefunden."
  echo "macOS: Python von https://www.python.org/downloads/ installieren."
  echo "Ubuntu: sudo apt install python3 python3-venv python3-tk"
  read -r -p "Enter zum Schliessen …" _; exit 1
fi
if ! "$PY" -c "import tkinter" 2>/dev/null; then
  echo "Tkinter fehlt. Ubuntu: sudo apt install python3-tk"
  read -r -p "Enter zum Schliessen …" _; exit 1
fi

if [ ! -x .venv/bin/python ]; then
  echo "Erster Start: Durchblick wird eingerichtet (1-2 Minuten) …"
  "$PY" -m venv .venv || { echo "venv fehlgeschlagen (Ubuntu: sudo apt install python3-venv)"; read -r _; exit 1; }
fi
if ! cmp -s requirements.txt .venv/requirements.installed; then
  echo "Installiere benötigte Module …"
  .venv/bin/python -m pip install --disable-pip-version-check -q -r requirements.txt \
    && cp requirements.txt .venv/requirements.installed \
    || { echo "Installation fehlgeschlagen. Internet prüfen und nochmals starten."; read -r _; exit 1; }
fi

nohup .venv/bin/python durchblick_panel.py >/dev/null 2>&1 &
echo "Durchblick wurde gestartet. Dieses Fenster kann geschlossen werden."
