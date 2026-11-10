# 👩‍🏫 Hinweise für Lehrpersonen

## Idee

Lernende arbeiten mit **eigenen** Daten (Game, Musik, Sport …) statt mit einem vorgegebenen Datensatz. Das steigert die Motivation, ohne dass die Lerninhalte von Modul 141 verloren gehen: Import, Normalisierung, Datentypen, Schlüssel, Abfragen, Zugriffsrechte, Datenschutz und Datensicherheit.

Die Werkstatt erzeugt das bekannte CSV-Format des Datensatzgenerators (14 Spalten, inklusive versteckter Geburtstagsdateien zur Kontrolle der Eigenständigkeit). Bestehende Aufgaben und Musterlösungen bleiben damit gültig.

## Ablauf im Unterricht (Vorschlag)

| Lektion | Inhalt |
|---|---|
| 1 | Installation, Werkstatt 1–3 mit eigenen Daten oder den Beispiel-Rohdaten |
| 2–4 | Schema entwerfen (ERD), Staging-Tabelle, Import, Normalisierung |
| 5–6 | Verbindung, Queries in der Config, Query-Check |
| 7 | Benutzer und Rechte (`GRANT`), Backup und Restore |
| 8 | Gestaltung, Präsentation, Reflexion Datenschutz |

## Rohdaten der Lehrperson ergänzen

Lernende können Ihr bisheriges Rohdaten-ZIP in Werkstatt 1 unter «bestehendes Rohdaten-ZIP ergänzen» auswählen. Die Einträge werden **unverändert** (ohne Entpacken) übernommen, die eigenen Dateien kommen unter `<gemeinsamer Ordner>/Files/<benutzer>/<projekt>/` dazu. Pfade wie `/opt/frigg/admin/projekt.txt` bleiben dadurch erhalten.

## Version für Lernende verteilen

Der Ordner `tests/` enthält in `tests/fixtures/schema_sqlite.sql` und `tests/helpers.py` eine **mögliche Lösung** für Schema und Import (SQLite). Für die Version der Lernenden:

```bash
git archive --format=zip -o durchblick_lernende.zip main -- . ':!tests' ':!.github' ':!scripts' ':!requirements-dev.txt'
```

## Automatische Prüfungen

```bash
python3 -m pip install -r requirements-dev.txt
bash scripts/pruefen.sh              # pytest, Node-ZIP-Test, bandit, pip-audit
python3 tests/e2e_browser.py shots   # kompletter Ablauf im Browser, Screenshots in shots/
```

Für den Browser-Test zusätzlich `python3 -m pip install playwright` und `python3 -m playwright install chromium` (oder ein vorhandenes Chrome über `CHROME=/pfad/zu/chrome`).

## Schulserver statt lokal

Durchblick ist für den Betrieb auf dem Rechner der Lernenden gedacht (`127.0.0.1`). Soll es auf einem Server laufen:

- `app: host: 0.0.0.0` und den Servernamen unter `app: erlaubte_hosts:` eintragen.
- **Davor einen Reverse-Proxy mit HTTPS und Anmeldung** setzen – Durchblick selbst hat keine Benutzerverwaltung.
- Pro Person eine eigene Config und einen eigenen DB-Benutzer mit minimalen Rechten verwenden.
