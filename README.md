# Durchblick

Webbasierte Datenbank-Oberfläche für den Unterricht (Modul 141). Die Lernenden verbinden die Applikation mit ihrer eigenen Datenbank, indem sie **nur die Konfigurationsdatei** `durchblick.conf.yml` anpassen. Die Applikation selbst bleibt eine Blackbox.

Läuft auf Ubuntu, macOS und Windows. Unterstützte Datenbanken: MySQL / MariaDB, PostgreSQL, SQLite und ODBC.

## Prinzip

Solange eine Query in der Config nicht zum Datenbankschema passt, zeigt die Weboberfläche ein Emoji statt echter Daten. Ziel ist es, alle Emojis durch echte Werte zu ersetzen.

## Dateien

| Datei | Zweck | Anpassen? |
|---|---|---|
| `durchblick.conf.yml` | Verbindung und alle SQL-Queries | **Ja, hier arbeiten die Lernenden** |
| `durchblick_panel.py` | Control Panel (Fenster mit Start/Stopp, Editor, Query-Check, Protokoll) | Nein |
| `durchblick_web.py` | Webserver mit eingebetteter Weboberfläche | Nein |
| `durchblick_db.py` | Gemeinsame Datenbank- und Config-Funktionen | Nein |
| `requirements.txt` | Benötigte Python-Module | Nein |

## Voraussetzungen

Python 3.9 oder neuer.

- **Ubuntu:** `sudo apt install python3-tk python3-venv`
- **Windows:** Python von [python.org](https://www.python.org/downloads/) installieren (enthält Tk)
- **macOS:** Python von [python.org](https://www.python.org/downloads/) installieren (enthält Tk). Das Python von Apple (Xcode) hat ein veraltetes Tk und sollte nicht verwendet werden.

## Installation

Im Programmordner ausführen.

**Ubuntu / macOS** (mit virtueller Umgebung, nötig ab Ubuntu 24.04):

```bash
python3 -m venv .venv
source .venv/bin/activate
python3 -m pip install -r requirements.txt
```

**Windows** (PowerShell):

```powershell
python -m venv .venv
.venv\Scripts\Activate.ps1
python -m pip install -r requirements.txt
```

## Start

```bash
python durchblick_panel.py      # Windows
python3 durchblick_panel.py     # Ubuntu / macOS
```

Im Control Panel:

1. Reiter **Konfiguration**: DSN, Benutzer, Passwort und Queries anpassen, speichern (Strg+S bzw. Cmd+S).
2. Reiter **Prüfen**: «Verbindung testen» und «Alle Queries prüfen». Fehler stehen direkt in der Tabelle.
3. Oben auf **Starten** klicken. Die Weboberfläche öffnet sich im Browser (Standard: http://127.0.0.1:3000).

Config-Änderungen gelten sofort. Ein Neustart des Servers ist nicht nötig. Es genügt, die Datei zu speichern und in der Weboberfläche den Reiter zu wechseln.

Der Webserver lässt sich auch ohne Panel starten:

```bash
python3 durchblick_web.py
```

## Konfiguration

Aufbau von `durchblick.conf.yml`:

- `db`: Verbindungsangaben (`dsn`, `user`, `pass`)
- `project`, `index`, `overview`, `browse`, `data`, `raw`, `tags`: SQL-Queries pro Seite
- `app`: Host und Port (nicht ändern, ausser bei belegtem Port)

DSN-Beispiele:

| Datenbank | DSN |
|---|---|
| MySQL / MariaDB | `DBI:mysql:database=m141;host=localhost;port=3306` |
| PostgreSQL | `DBI:Pg:dbname=m141;host=localhost;port=5432` |
| SQLite | `DBI:SQLite:dbname=/pfad/zur/m141.db` |
| ODBC | `DBI:ODBC:m141dsn` |

Regeln für Queries:

- Bind-Parameter werden **immer als `?`** geschrieben, unabhängig vom Treiber.
- Texte in Queries immer in einfachen Anführungszeichen (`'text'`), damit sie auf jeder Datenbank laufen.
- Weichen Spaltennamen ab, mit Aliasen arbeiten (`select hash as digest, …`). Für die Browser-Seite wird die Spalte `digest` benötigt.
- Die beiden `insert`-Queries für Tags sind datenbankspezifisch. Varianten für MySQL, SQLite und PostgreSQL stehen als Kommentar in der Config.

Eine andere Config-Datei kann über die Umgebungsvariable `DURCHBLICK_CONFIG` verwendet werden.

## Fehlersuche

| Problem | Ursache und Lösung |
|---|---|
| Panel meldet «Modul fehlt» | `python3 -m pip install -r requirements.txt` ausführen (in der virtuellen Umgebung) |
| `externally-managed-environment` unter Ubuntu | Virtuelle Umgebung verwenden (siehe Installation) |
| «Port belegt» | Anderen Port in der Config unter `app: port:` eintragen |
| «Keine Verbindung» | DSN, Benutzer, Passwort und Servererreichbarkeit prüfen. Reiter «Prüfen» zeigt die genaue Meldung |
| Emojis in der Weboberfläche | Zugehörige Query ist fehlerhaft. Mauszeiger über das Emoji zeigt die Meldung, der Reiter «Prüfen» zeigt alle Fehler |
| Browser-Seite leer | Spalte `digest` fehlt im Query-Ergebnis (Alias verwenden) |
| Server beendet sich sofort | Reiter «Protokoll» öffnen, die Ursache steht dort |
| SQLite meldet «Datei nicht gefunden» | Pfad in `dbname=` prüfen |

## Hinweise zur Sicherheit

- Der Webserver lauscht standardmässig nur auf `127.0.0.1` und ist damit nur vom eigenen Rechner erreichbar.
- Die Config enthält das Datenbankpasswort im Klartext. Bei Screenshots und Abgaben das Passwort entfernen und die Datei nicht in ein öffentliches Repository hochladen.
- Der Query-Tester im Panel führt beliebiges SQL aus. Schreibende Queries verlangen eine Bestätigung. Der Query-Check führt nie schreibende Queries aus.
- Rohinhalte aus der Datenbank werden mit Sandbox-Header ausgeliefert und im Browser nicht ausgeführt.

## Lizenz

MIT, siehe [LICENSE](LICENSE).
