# 🛡️ Sicherheit

## Bedrohungsmodell

Durchblick läuft auf dem Rechner der Lernenden und verbindet sich mit deren Datenbank. Die wichtigsten Risiken:

| Risiko | Beispiel | Massnahme |
|---|---|---|
| Zugriff aus dem Netzwerk | Mitschüler ruft `http://<ip>:3000` auf | Server bindet standardmässig an `127.0.0.1`; Warnung im Protokoll bei anderem Host |
| DNS-Rebinding | Eine bösartige Webseite lässt ihren Namen auf `127.0.0.1` zeigen und liest die API | Host-Header-Prüfung: nur `127.0.0.1`, `localhost`, `::1` und `app: erlaubte_hosts` |
| CSRF | Eine fremde Webseite schickt `POST /api/settag` an den lokalen Server | Schreibende Anfragen verlangen den Header `X-Durchblick: 1` (erzwingt CORS-Preflight, das nicht beantwortet wird) und eine passende `Origin` |
| XSS durch Datenbankinhalte | Eine HTML- oder SVG-Datei aus der CSV enthält `<script>` | `/api/raw` liefert mit `Content-Security-Policy: sandbox` und `nosniff`; die Oberfläche maskiert alle Werte (`esc()`) bzw. verwendet `textContent` |
| XSS in der Oberfläche | Eingeschleustes Skript | CSP `script-src 'self'`, keine Inline-Skripte, `object-src 'none'`, `base-uri 'none'` |
| Clickjacking | Durchblick in einem fremden `<iframe>` | `X-Frame-Options: DENY`, `frame-ancestors 'none'` |
| Datenabfluss an Dritte | Externe Schriften, CDNs, Tracker | CSP `default-src 'self'`, `Referrer-Policy: no-referrer`, FastAPI-Doku (lädt CDN-Skripte) abgeschaltet |
| Einbinden der Inhalte durch fremde Seiten | `<img src="http://127.0.0.1:3000/api/raw/…">` | `Cross-Origin-Resource-Policy: same-origin` |
| Pfad-Traversal | `/theme/../durchblick.conf.yml` | `/theme/` erlaubt nur einfache Dateinamen mit festen Endungen und prüft den aufgelösten Pfad; `/static/` über Starlette `StaticFiles` |
| Passwort im Repository | Config mit echtem Passwort committet | `durchblick.conf.local.yml` (in `.gitignore`), Umgebungsvariable `DURCHBLICK_DB_PASS`; Passwort wird nie an den Browser geschickt |
| Persönliche Daten im Repository | CSV mit Geburtsdatum committet | `.gitignore`: `*.csv`, `datensatz_*.csv`, `pruefbericht_*.txt`, `*_klein.zip` |
| ZIP-Bomben / Speicherüberlauf | Riesiges oder manipuliertes ZIP | Grenzen: 50 000 Einträge, 4 GB entpackt, 20 000 Dateien pro Verkleinerung, kein ZIP64; ZIP-Schreiber lehnt `..` und absolute Pfade ab |
| CSV-Injection | Pfad beginnt mit `=`, Excel führt Formel aus | CSV-Prüfung warnt; Anleitung rät von Excel ab |
| Unsichere Eingaben an die API | Sehr lange Muster, riesige Limits | Längen- und Wertebereichsprüfung (`pattern` ≤ 200, `limit` 1–500, `digest` ≤ 128, Tag ≤ 100) |
| SQL-Injection | Eingaben aus der Oberfläche | Alle Werte als Bind-Parameter (`?`); SQL kommt ausschliesslich aus der Config |
| Unsichere YAML-Verarbeitung | Objekt-Konstruktion über YAML-Tags | `yaml.safe_load` |

Bewusst **nicht** abgedeckt: Durchblick hat keine Benutzerverwaltung. Der Query-Tester im Panel führt beliebiges SQL mit den Rechten des konfigurierten DB-Benutzers aus (schreibende Queries nur nach Bestätigung). Wer Durchblick auf einem Server betreibt, setzt einen Reverse-Proxy mit HTTPS und Anmeldung davor.

## Automatische Prüfungen

`bash scripts/pruefen.sh` (läuft auch in GitHub Actions bei jedem Push):

1. Python-Syntax aller Module
2. `pytest`: API, Galerie, Sandbox-Header, CSRF, Host-Prüfung, Pfad-Traversal, Eingabegrenzen, Config-Handling
3. Node: Syntax aller Skripte und ZIP-Rundlauf (Schreiben, Lesen, Rohübernahme, Ablehnung von `..`)
4. `bandit` (statische Analyse Python, Schwelle Medium)
5. `pip-audit` (bekannte Schwachstellen in Abhängigkeiten)

Stand bei Version 2.0: alle Tests grün, bandit ohne Befund ab Medium (verbleibende Low-Hinweise betreffen den bewussten Start des Webservers per `subprocess` im Panel), pip-audit ohne bekannte Schwachstellen.

## Sicherheitslücke melden

Bitte nicht öffentlich als Issue, sondern über die Funktion «Report a vulnerability» im Reiter *Security* des GitHub-Repositorys oder direkt an die verantwortliche Lehrperson.
