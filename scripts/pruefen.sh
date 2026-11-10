#!/usr/bin/env bash
# Alle automatischen Prüfungen: Tests, ZIP-Test (Node), Sicherheits-Scans.
# Start im Programmordner:  bash scripts/pruefen.sh
set -euo pipefail
cd "$(dirname "$0")/.."
PY=${PYTHON:-python3}

echo "== 1/5 Python-Syntax"
$PY -m py_compile durchblick_db.py durchblick_web.py durchblick_panel.py

echo "== 2/5 Tests (pytest)"
$PY -m pytest -q tests

echo "== 3/5 JavaScript (Syntax + ZIP-Rundlauf)"
if command -v node >/dev/null; then
  for f in web/js/*.js; do node --check "$f"; done
  node tests/js/zip_roundtrip.test.mjs
else
  echo "   Node.js nicht gefunden, übersprungen"
fi

echo "== 4/5 Statische Sicherheitsanalyse (bandit)"
$PY -m bandit -q -r durchblick_db.py durchblick_web.py durchblick_panel.py -ll

echo "== 5/5 Bekannte Schwachstellen in Abhängigkeiten (pip-audit)"
$PY -m pip_audit -r requirements.txt || echo "   pip-audit nicht möglich (offline?)"

echo "Alles geprüft."
