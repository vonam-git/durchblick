# Änderungen

## 2.1 – Kurzclips aus Video und Audio

- Werkstatt 1 nimmt aus Videos kleine Clips (3/5/10 s, skaliert, WebM mit Ton) und aus Audio Ausschnitte mit Ein-/Ausblenden (Opus) auf – direkt im Browser, bis zu drei gleichzeitig. Optional Clip + Vorschaubild, Start am Anfang oder in der Mitte. Beispiel-Rohdaten enthalten neu Tanz-Videos und Sounds. Die Galerie spielt Clips beim Darüberfahren ab, der Detaildialog hat einen Player. `/api/raw` unterstützt Range-Anfragen (Safari). Generator kennt neu `.weba`, `.m4a`, `.aac`, `.flac`, `.opus`, `.oga`, `.m4v`, `.ogv`.
- Datenschutz: Auch in Clips werden Metadaten (GPS in Handy-Videos, Song-Tags) entfernt.

## 2.0 – Werkstatt, Galerie und Design

**Neu**
- **Windows-Installer** `Durchblick-Setup-<Version>.exe`: Python und alle Module enthalten, Installation ohne Admin-Rechte, Startmenü- und Desktop-Verknüpfung, deutsch. Wird von GitHub Actions gebaut, getestet und als Release veröffentlicht (mit SHA-256).
- Installierte Version speichert Config, `theme/` und `docs/` in `Dokumente\Durchblick` (`DURCHBLICK_HOME` zum Ändern).
- Doppelklick-Starter `Durchblick-starten.bat` (Windows) und `Durchblick-starten.command` (macOS/Linux) richten beim ersten Start alles selbst ein.
- Programm-Icon.
- **Control Panel neu gestaltet:** Farben wie die Weboberfläche, Hell/Dunkel-Umschalter (wird gemerkt), Seitenleiste statt Reiter (Alt+1 … Alt+6), Startseite mit sechs Schritt-Karten, Status-Anzeige im Kopf, farbige YAML-Hervorhebung im Config-Editor, Zähler für OK/Hinweise/Fehler beim Query-Check, eigener Query-Tester (Doppelklick im Query-Check öffnet die Query dort), übersichtliche System-Seite.
- **Werkstatt** in der Weboberfläche mit drei Schritten:
  1. *Rohdaten vorbereiten:* Ordner, Dateien oder ZIP einlesen; Bilder verkleinern und neu kodieren (WebP/JPEG/PNG, EXIF wird entfernt); Videos und GIFs zu Vorschaubildern; Grössen- und Ordnerlimits; Einsortieren in `Files/<benutzer>/<projekt>/`; bestehendes Rohdaten-ZIP unverändert ergänzen; `_info.json` und `LIESMICH.txt`; fiktive Beispiel-Rohdaten «Game-Shop».
  2. *CSV generieren:* Datensatzgenerator v1.1 integriert (Format unverändert).
  3. *CSV prüfen:* CSV-Prüfung v1.1 integriert, neu mit Warnung bei CSV-Injection.
- **Galerie** mit Ordnerfilter und Bildvorschau im Detaildialog (`gallery.sql_gallery_bind`).
- **Design:** fünf Vorlagen (standard, hell, arcade, terminal, alpen), Live-CSS-Editor, `theme/eigenes.css`, eigene Bilder und Schriften in `theme/`, Abschnitt `ui:` in der Config (Titel, Untertitel, Logo, Fusszeile, Vorlage).
- **Hilfe-Reiter** in der Weboberfläche, Startseite mit Ablauf.
- **Control Panel:** Knöpfe für Werkstatt, Galerie, Design und Hilfe; «Persönliche Kopie anlegen» (`durchblick.conf.local.yml`).
- Passwort optional über `DURCHBLICK_DB_PASS`.
- Dokumentation: Anleitung, Eigenes Design, Hilfe, Datenschutz, Lehrpersonen, Sicherheit.
- Tests (pytest, Node, Browser), `scripts/pruefen.sh`, GitHub Actions.

**Sicherheit**
- Host-Prüfung gegen DNS-Rebinding, CSRF-Schutz für schreibende Anfragen, strenge Content-Security-Policy und weitere Sicherheits-Header, `Cross-Origin-Resource-Policy`, Eingabegrenzen, FastAPI-Doku abgeschaltet, Server-Header entfernt.
- `/api/settag` erwartet jetzt JSON im Body statt Query-Parametern.

**Geändert**
- Weboberfläche aus `durchblick_web.py` nach `web/` ausgelagert.
- Lesende Queries laufen ohne Commit.

## 1.1 – Erste Version

Webserver, Control Panel, Query-Check, Unterstützung für MySQL/MariaDB, PostgreSQL, SQLite und ODBC.
