# ❓ Hilfe und Fehlersuche

Die wichtigsten Antworten stehen auch direkt in der Weboberfläche im Reiter **❓ Hilfe**.

## Installation und Start

| Problem | Ursache und Lösung |
|---|---|
| Panel meldet «Modul fehlt» | `python3 -m pip install -r requirements.txt` ausführen (in der virtuellen Umgebung) |
| `externally-managed-environment` unter Ubuntu | virtuelle Umgebung verwenden (siehe README) |
| `No module named tkinter` | Ubuntu: `sudo apt install python3-tk`. Alternativ ohne Panel: `python3 durchblick_web.py` |
| «Port belegt» | Anderen Port in der Config unter `app: port:` eintragen oder das andere Programm beenden |
| Server beendet sich sofort | Reiter «Protokoll» im Panel öffnen, die Ursache steht dort |
| Seite zeigt «Unbekannter Host» | Durchblick über `http://127.0.0.1:3000` aufrufen. In einer VM mit anderem Namen: Namen unter `app: erlaubte_hosts:` eintragen |

## Werkstatt

| Problem | Ursache und Lösung |
|---|---|
| «Ordner wählen» fehlt oder geht nicht | Aktuellen Chrome, Edge oder Firefox verwenden. Alternativ Dateien markieren und hineinziehen oder vorher selbst ein ZIP machen |
| Bild wird übersprungen: «Bild konnte nicht gelesen werden» | Format wird vom Browser nicht unterstützt (z.B. HEIC vom iPhone). Vorher in JPG/PNG umwandeln |
| Video wird übersprungen | Browser kennt das Videoformat nicht (z.B. manche `.mov`). In MP4 umwandeln oder ein Standbild selbst speichern |
| Ergebnis ist trotzdem gross | Längste Seite kleiner wählen, Qualität senken, «Maximalgrösse übrige Dateien» kleiner, «Dateien pro Ordner» begrenzen |
| WebP wird zu JPG | Der Browser (z.B. Safari) kann kein WebP schreiben. Das ist in Ordnung |
| Generator: «sehr gross, Tipp: zuerst verkleinern» | Das ZIP ist entpackt über 500 MB. Zuerst in Schritt 1 verkleinern |
| «ZIP64-Archive werden nicht unterstützt» | Das ZIP ist über 4 GB oder hat sehr viele Einträge. In Schritt 1 verkleinern oder in Teilen bearbeiten |

## CSV-Prüfung

| Meldung | Bedeutung |
|---|---|
| Falsches Trennzeichen: Semikolon | Die CSV wurde in Excel gespeichert. Original-CSV verwenden |
| Dezimalkomma statt Dezimalpunkt | dito |
| Genau 32 767 Zeichen, abgeschnitten | dito (Excel-Zellengrenze) |
| Ungültige Zeichenkodierung | Datei wurde in einer anderen Kodierung gespeichert. Original-CSV verwenden |
| Pfad mehrfach vorhanden | Zwei Zeilen mit demselben Pfad. Darf als Primärschlüssel nicht vorkommen |
| Gleicher Inhalt in mehreren Dateien (Hinweis) | Erlaubt und gewollt: Grundlage für die Normalisierung |
| Pfad beginnt mit = + - @ | Tabellenprogramme könnten den Wert als Formel ausführen (CSV-Injection) |

## Import

| Problem | Ursache und Lösung |
|---|---|
| MySQL: `The used command is not allowed` / `local_infile` | Client mit `--local-infile=1` starten und auf dem Server `SET GLOBAL local_infile = 1;` (Admin-Rechte) |
| Umlaute kaputt | `CHARACTER SET utf8mb4` beim Import und bei der Tabelle angeben |
| Weniger Zeilen als erwartet | `LINES TERMINATED BY '\r\n'` und `OPTIONALLY ENCLOSED BY '"'` prüfen; Warnungen mit `SHOW WARNINGS;` ansehen |
| `Data too long for column` | Datentyp für `encoded_data` zu klein (MySQL: `TEXT` reicht nur bis 64 KB) |

## Weboberfläche

| Problem | Ursache und Lösung |
|---|---|
| «Keine Verbindung» | DSN, Benutzer, Passwort und Servererreichbarkeit prüfen. Panel → «Prüfen» zeigt die genaue Meldung |
| Emojis statt Zahlen | Zugehörige Query ist fehlerhaft. Mauszeiger über das Emoji zeigt die Meldung, Panel → «Prüfen» zeigt alle Fehler |
| Browser- oder Galerie-Seite leer | Spalte `digest` fehlt im Query-Ergebnis (Alias verwenden) |
| Galerie zeigt kaputte Bilder | `data.sql_content_bind` liefert nicht den Inhalt oder `raw.sql_contenttype_bind` nicht den Typ |
| Tag setzen geht nicht | Die `insert`-Queries sind datenbankspezifisch (`insert ignore`, `insert or ignore`, `on conflict do nothing`). Variante in der Config wählen |
| Mein CSS wirkt nicht | Datei heisst genau `theme/eigenes.css`? Browser neu laden (Strg+F5). Live-Editor im Reiter «Design» leeren, er überschreibt sonst die Datei |
| Schrift oder Bild aus dem Internet lädt nicht | Externe Quellen sind aus Datenschutzgründen gesperrt. Datei in `theme/` legen |
| SQLite meldet «Datei nicht gefunden» | Pfad in `dbname=` prüfen (absoluter Pfad) |

## Immer noch nicht gelöst?

1. Panel → Reiter «Protokoll» → «Kopieren».
2. Panel → Reiter «System» → Angaben kopieren.
3. Beides mit einer kurzen Beschreibung an die Lehrperson senden – **ohne Passwort**.
