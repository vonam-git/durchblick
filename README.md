# 🔍 Durchblick

**Alles in einem Werkzeug für das Modul 141 «Datenbanksystem in Betrieb nehmen».**

Durchblick begleitet Lernende vom eigenen Rohdaten-Ordner bis zur fertigen, selbst gestalteten Weboberfläche auf der eigenen Datenbank:

```
📁 Rohdaten → 🗜️ verkleinern → 📊 CSV generieren → 🔍 CSV prüfen → 🗄️ Import → ⚙️ Queries → 🎨 Design
```

| Teil | Was es macht |
|---|---|
| **Werkstatt** (Weboberfläche) | ① Rohdaten verkleinern (Bilder, Video-Vorschaubilder, Limits) ② CSV-Datensatz generieren ③ CSV vor dem Import prüfen. Alles lokal im Browser. |
| **Datenbank-Ansichten** | Start, Übersicht, Browser, **Galerie**, Tags. Solange eine Query nicht zum eigenen Schema passt, erscheint ein Emoji. Ziel: alle Emojis durch echte Daten ersetzen. |
| **Design** | Fünf Vorlagen, Live-CSS-Editor und `theme/eigenes.css` für die eigene Gestaltung. |
| **Control Panel** | Fenster mit Start/Stopp, Config-Editor mit YAML-Farben, Query-Check, Query-Tester, Protokoll und System-Infos. Hell- und Dunkelmodus. |

Läuft auf Ubuntu, macOS und Windows. Datenbanken: MySQL / MariaDB, PostgreSQL, SQLite und ODBC.

> 📘 **Für Lernende:** Die Schritt-für-Schritt-Anleitung steht in [docs/ANLEITUNG.md](docs/ANLEITUNG.md).

---

## Schnellstart

Voraussetzung: Python 3.9 oder neuer.

- **Ubuntu:** `sudo apt install python3-tk python3-venv`
- **Windows / macOS:** Python von [python.org](https://www.python.org/downloads/) installieren (enthält Tk). Unter macOS nicht das Python von Apple (Xcode) verwenden.

Im Programmordner:

```bash
# Ubuntu / macOS
python3 -m venv .venv
source .venv/bin/activate
python3 -m pip install -r requirements.txt
python3 durchblick_panel.py
```

```powershell
# Windows (PowerShell)
python -m venv .venv
.venv\Scripts\Activate.ps1
python -m pip install -r requirements.txt
python durchblick_panel.py
```

Im Control Panel auf **Starten** klicken. Die Weboberfläche öffnet sich unter <http://127.0.0.1:3000>. Ohne Panel: `python3 durchblick_web.py`.

Die **Werkstatt** funktioniert auch ohne Datenbankverbindung. Du kannst also gleich mit den Rohdaten beginnen.

## Projektstruktur

```
durchblick/
├── durchblick_panel.py        Control Panel (Tk-Fenster)
├── durchblick_web.py          Webserver (FastAPI) und Sicherheitsregeln
├── durchblick_db.py           Config, Verbindung, Queries, Query-Check
├── durchblick.conf.yml        ⚙️  Verbindung, Queries, Gestaltung  ← hier arbeiten die Lernenden
├── theme/
│   └── eigenes.css            🎨 eigene Gestaltung  ← hier gestalten die Lernenden
├── web/                       Weboberfläche (nicht verändern)
│   ├── index.html
│   ├── css/app.css            Grundgestaltung mit CSS-Variablen
│   ├── themes/*.css           Vorlagen: standard, hell, arcade, terminal, alpen
│   └── js/
│       ├── app.js             Datenbank-Ansichten, Galerie, Design
│       ├── compressor.js      Werkstatt 1: Rohdaten verkleinern
│       ├── zipwriter.js       ZIP-Archive im Browser schreiben
│       ├── generator.js       Werkstatt 2: CSV generieren (Datensatzgenerator v1.1)
│       └── checker.js         Werkstatt 3: CSV prüfen
├── docs/                      Anleitungen
├── tests/                     Automatische Tests (pytest, Node, Browser)
└── scripts/pruefen.sh         Alle Tests und Sicherheits-Scans
```

## Konfiguration

`durchblick.conf.yml` enthält alles, was die Lernenden anpassen:

| Abschnitt | Inhalt |
|---|---|
| `db` | Verbindung: `dsn`, `user`, `pass` |
| `project`, `index`, `overview`, `browse`, `gallery`, `data`, `raw`, `tags` | SQL-Queries pro Seite |
| `ui` | Titel, Untertitel, Logo, Fusszeile, Vorlage (`theme`) |
| `app` | Host, Port, erlaubte Hostnamen (normalerweise nicht ändern) |

DSN-Beispiele:

| Datenbank | DSN |
|---|---|
| MySQL / MariaDB | `DBI:mysql:database=m141;host=localhost;port=3306` |
| PostgreSQL | `DBI:Pg:dbname=m141;host=localhost;port=5432` |
| SQLite | `DBI:SQLite:dbname=/pfad/zur/m141.db` |
| ODBC | `DBI:ODBC:m141dsn` |

Regeln für Queries: Bind-Parameter immer als `?`, Texte in einfachen Anführungszeichen, abweichende Spaltennamen mit Aliasen (`select hash as digest …`). Browser und Galerie brauchen die Spalte `digest`.

**Echtes Passwort:** Im Panel «Persönliche Kopie anlegen» klicken. Das speichert die Config als `durchblick.conf.local.yml`, die automatisch bevorzugt und von Git ignoriert wird. Alternativ das Passwort über die Umgebungsvariable `DURCHBLICK_DB_PASS` setzen. Eine ganz andere Config-Datei wählt man mit `DURCHBLICK_CONFIG`.

## Dokumentation

| Dokument | Für wen | Inhalt |
|---|---|---|
| [docs/ANLEITUNG.md](docs/ANLEITUNG.md) | Lernende | Schritt für Schritt vom Rohdaten-Ordner bis zur Galerie, mit Game-Beispiel |
| [docs/EIGENES-DESIGN.md](docs/EIGENES-DESIGN.md) | Lernende | Eigenes CSS, Variablen, Bilder und Schriften, Ideen |
| [docs/HILFE.md](docs/HILFE.md) | Lernende | Fehlersuche und häufige Fragen |
| [docs/DATENSCHUTZ.md](docs/DATENSCHUTZ.md) | alle | Welche Daten wo verarbeitet werden, Urheberrecht, Empfehlungen |
| [docs/LEHRPERSONEN.md](docs/LEHRPERSONEN.md) | Lehrpersonen | Einsatz im Unterricht, Verteilung, Tests |
| [SECURITY.md](SECURITY.md) | alle | Sicherheitskonzept und Prüfungen |
| [CHANGELOG.md](CHANGELOG.md) | alle | Änderungen pro Version |

## Datenschutz und Sicherheit in Kürze

- 🔒 Die Werkstatt verarbeitet Dateien **nur im Browser**. Es wird nichts hochgeladen.
- 🏠 Der Webserver ist nur auf dem eigenen Rechner erreichbar (`127.0.0.1`), fremde Hostnamen werden abgewiesen (Schutz vor DNS-Rebinding).
- 🛡️ Strenge Content-Security-Policy: keine externen Skripte, Schriften oder Tracker. Inhalte aus der Datenbank werden in einer Sandbox ausgeliefert.
- ✋ Schreibende Anfragen brauchen einen eigenen Header und die eigene Herkunft (Schutz vor CSRF).
- 🧹 Beim Verkleinern von Bildern werden EXIF-Metadaten (z.B. GPS-Standort) entfernt.
- 🎂 Die generierte CSV enthält Name und Geburtsdatum: nicht teilen. `.gitignore` verhindert, dass CSV- und ZIP-Dateien ins Repository gelangen.

Details: [docs/DATENSCHUTZ.md](docs/DATENSCHUTZ.md) und [SECURITY.md](SECURITY.md).

## Entwicklung

```bash
python3 -m pip install -r requirements-dev.txt
bash scripts/pruefen.sh            # Tests, ZIP-Test, bandit, pip-audit
python3 tests/e2e_browser.py shots # optional: kompletter Ablauf im Browser mit Screenshots
```

Branches: `develop` für die Weiterentwicklung, `main` für die freigegebene Version. GitHub Actions führt `scripts/pruefen.sh` bei jedem Push aus.

## Lizenz und Dank

MIT, siehe [LICENSE](LICENSE). Werkstatt-Schritte 2 und 3 basieren auf dem «Datensatzgenerator v1.1» von VoM & Lumo.
