# 📘 Anleitung für Lernende

Diese Anleitung führt dich Schritt für Schritt von deinen eigenen Rohdaten bis zu einer selbst gestalteten Weboberfläche auf deiner Datenbank. Als Beispiel dient ein **Game-Projekt** mit Skins, Rucksäcken und Tänzen – du kannst aber jedes Thema nehmen, das dich interessiert (Musik, Sport, Autos, Pflanzen …).

> ⏱️ Plane für die Schritte 1–3 etwa eine Lektion ein. Import und Queries (Schritte 4–6) sind der Hauptteil des Moduls.

---

## Überblick

| Schritt | Wo | Ergebnis |
|---|---|---|
| 0. Installieren und starten | Terminal, Control Panel | Weboberfläche läuft auf <http://127.0.0.1:3000> |
| 1. Rohdaten vorbereiten | Werkstatt ① | kleines ZIP-Archiv |
| 2. CSV generieren | Werkstatt ② | `datensatz_Vorname_Nachname.csv` |
| 3. CSV prüfen | Werkstatt ③ | grünes Häkchen ✅ |
| 4. Schema anlegen und importieren | deine Datenbank | Tabellen mit Daten |
| 5. Verbindung und Queries | Control Panel, Config | keine Emojis mehr |
| 6. Gestalten | Reiter «Design», `theme/eigenes.css` | deine eigene Oberfläche |

---

## 0. Installieren und starten

**Windows:** `Durchblick-Setup-2.0.exe` von den [Releases](https://github.com/vonam-git/durchblick/releases/latest) herunterladen, doppelklicken, installieren. Bei der Warnung «Der Computer wurde durch Windows geschützt»: **Weitere Informationen** → **Trotzdem ausführen**. Danach **Durchblick** im Startmenü öffnen.

**macOS / Linux:** Repository herunterladen und `Durchblick-starten.command` doppelklicken (siehe [README](../README.md#installation)).

Dann im Panel oben auf **▶ Starten** klicken. Der Browser öffnet sich.

> 📁 Bei der installierten Version liegen Config (`durchblick.conf.yml`), eigene Gestaltung (`theme/`) und diese Anleitungen in **Dokumente\Durchblick**. Das Panel zeigt den Ordner auf der Startseite unter «Dateien und Ordner».

Noch keine Datenbank? Kein Problem: Die Startseite zeigt dann «Keine Verbindung», die **Werkstatt** funktioniert trotzdem.

---

## 1. Rohdaten vorbereiten 🗜️

**Ziel:** Aus vielen grossen Dateien ein kleines, sauberes ZIP machen.

### 1.1 Rohdaten sammeln

Lege einen Ordner an, zum Beispiel so:

```
mein_game/
├── skins/          Bilder der Skins (PNG, JPG, WebP …)
├── rucksaecke/     Bilder der Rucksäcke
├── taenze/         kurze Videos oder GIFs der Tänze, dazu taenze.json
└── items.csv       Liste mit Name, Seltenheit, Preis …
```

Tipps:
- Ordnernamen sind später Teil des Pfades in der Datenbank. Wähle kurze, sprechende Namen.
- Eine kleine Textdatei mit Zusatzinfos (JSON oder CSV) macht spätere Abfragen spannender.
- **Nur Material verwenden, das du im Unterricht verwenden darfst** (siehe [Datenschutz](DATENSCHUTZ.md)). Keine Fotos von Personen ohne Einverständnis.

> 🎲 Keine eigenen Daten zur Hand? Klicke in der Werkstatt auf **«Beispiel-Rohdaten erzeugen»**. Das erstellt einen fiktiven «Game-Shop» mit 12 Skins, 8 Rucksäcken, einer Tanzliste und einer Item-Liste (rund 16 MB).

### 1.2 Verkleinern

1. Reiter **🛠️ Werkstatt** → **1 · Rohdaten**.
2. Ordner hineinziehen oder **📁 Ordner wählen**.
3. Einstellungen:

| Einstellung | Empfehlung | Warum |
|---|---|---|
| Ablage im ZIP | «In Benutzerordner einsortieren» | Deine Dateien landen unter `Files/<benutzer>/<projekt>/…`. Daraus werden Besitzer und Rechte abgeleitet. |
| Benutzer | `gamer` (für ein Game-Projekt) | uid, Gruppe und Rechte kommen aus dem Benutzerordner |
| Projektname | z.B. `game_shop` | wird zum Ordnernamen |
| Bilder: längste Seite | 256 px | reicht für die Galerie, spart enorm Platz |
| Bildformat | WebP | klein und mit Transparenz |
| Videos und GIFs | Vorschaubild erzeugen | ein Video wäre viel zu gross für die CSV |
| Maximalgrösse übrige Dateien | 200 KB | grössere Dateien werden übersprungen und aufgelistet |
| Dateien pro Ordner | z.B. 20 | wenn du sehr viele Bilder hast |

4. Optional: Hast du von deiner Lehrperson ein **Rohdaten-ZIP** erhalten, wähle es unter «bestehendes Rohdaten-ZIP ergänzen». Dann kommen deine Dateien in dasselbe Archiv.
5. **🗜️ Rohdaten verkleinern** klicken.

Das Ergebnis zeigt, wie viel Platz du gespart hast (beim Beispiel: 16 MB → etwa 70 KB). Im ZIP liegen zusätzlich `_info.json` (alle Dateien mit Grösse und Bildmassen) und `LIESMICH.txt`. **Trage in der LIESMICH.txt die Quelle deiner Daten ein.**

> 💡 **Nachdenken:** Warum ist ein Bild in der CSV etwa ein Drittel grösser als die Datei selbst? (Stichwort: Base64)

---

## 2. CSV generieren 📊

1. **➡️ Weiter zu Schritt 2** klicken (oder Reiter **2 · CSV generieren** und das ZIP wählen).
2. Vor- und Nachname sowie Geburtsdatum eingeben.
3. **🚀 Datensatz generieren** und danach **⬇️ CSV-Datei herunterladen**.

Jede Zeile der CSV beschreibt eine Datei:

| Spalte | Bedeutung | Beispiel |
|---|---|---|
| `count` | Laufnummer | `17` |
| `hash` | MD5-Hash des Inhalts | `9e107d9d372bb6826bd81d3542a419d6` |
| `path` | Pfad der Datei | `/game_shop/Files/gamer/game_shop/skins/neon_ninja.webp` |
| `size` | Grösse in Bytes | `4812` |
| `type` | MIME-Typ | `image/webp` |
| `mode` | Rechte (oktal) | `0o100770` |
| `uid`, `user` | Besitzer | `999`, `gamer` |
| `gid`, `group` | Gruppe | `99`, `admin_L` |
| `time` | Änderungszeit (Unix-Sekunden) | `1762770000` |
| `compressed_size` | Grösse komprimiert | `4830` |
| `compression_ratio` | komprimiert / original in % | `100.37` |
| `encoded_data` | Inhalt: zlib + URL-safe Base64 | `eJx…` |

> 🔒 Die CSV enthält **versteckt** zwei Dateien mit deinem Geburtsdatum (Teil der Aufgabe – findest du sie?). Behandle die CSV darum als persönliche Datei: nicht teilen, nicht in ein öffentliches Repository hochladen.

> ⚠️ **Öffne die CSV nicht mit Excel und speichere sie nicht damit!** Excel ändert Trennzeichen, Zahlen und schneidet lange Zellen ab.

---

## 3. CSV prüfen 🔍

1. **🔍 Erzeugte CSV gleich prüfen** klicken (oder Reiter **3 · CSV prüfen**).
2. «Dateiinhalte vollständig prüfen» eingeschaltet lassen.
3. Ergebnis lesen:
   - ✅ **gültig** → weiter zum Import
   - ⚠️ **gültig, mit Warnungen** → Warnungen lesen und verstehen
   - ❌ **enthält Fehler** → CSV neu generieren, nicht von Hand flicken

Den **Prüfbericht** kannst du herunterladen und deiner Dokumentation beilegen.

---

## 4. Schema anlegen und importieren 🗄️

Jetzt beginnt die eigentliche Datenbankarbeit. Ein bewährter Weg:

1. **Staging-Tabelle** mit genau den 14 Spalten der CSV anlegen.
2. CSV in die Staging-Tabelle importieren.
3. Daten mit `INSERT … SELECT` in **normalisierte Tabellen** verteilen.

Die Weboberfläche erwartet (über die Queries in der Config) Tabellen wie `Data`, `Meta`, `Type`, `Tag`, `DataTag`, `Usr` und `Grp`. Wie du sie genau aufbaust (Schlüssel, Datentypen, Beziehungen), ist **deine Aufgabe**. Überlege dir:

- Gleiche Inhalte haben denselben `hash`. Wo speicherst du den Inhalt nur einmal, wo die Pfade?
- Welche Spalte eignet sich als Primärschlüssel für Pfade, welche für Inhalte?
- Welcher Datentyp passt für `encoded_data`? (Ein Wert kann mehrere hundert KB lang sein.)

### Staging-Tabelle (Beispiel MariaDB / MySQL)

```sql
CREATE TABLE Rohdaten (
  count INT, hash CHAR(32), path VARCHAR(1024), size BIGINT, type VARCHAR(100),
  mode VARCHAR(12), uid INT, user VARCHAR(50), gid INT, `group` VARCHAR(50),
  time BIGINT, compressed_size BIGINT, compression_ratio DECIMAL(10,2),
  encoded_data LONGTEXT
) CHARACTER SET utf8mb4;
```

### Import

**MariaDB / MySQL** (der Client braucht `--local-infile=1`):

```sql
LOAD DATA LOCAL INFILE 'datensatz_Anna_Beispiel.csv'
INTO TABLE Rohdaten
CHARACTER SET utf8mb4
FIELDS TERMINATED BY ',' OPTIONALLY ENCLOSED BY '"'
LINES TERMINATED BY '\r\n'
IGNORE 1 LINES;
```

**PostgreSQL** (in `psql`):

```sql
\copy rohdaten FROM 'datensatz_Anna_Beispiel.csv' WITH (FORMAT csv, HEADER true, ENCODING 'UTF8')
```

**SQLite** (ab Version 3.32):

```
.import --csv --skip 1 datensatz_Anna_Beispiel.csv Rohdaten
```

Kontrolle: `SELECT count(*) FROM Rohdaten;` muss gleich viele Zeilen liefern, wie die CSV-Prüfung «Datensätze» angezeigt hat.

---

## 5. Verbindung und Queries ⚙️

1. Im Panel Reiter **Konfiguration**: `dsn`, `user` und `pass` eintragen.
   **Tipp:** Zuerst **«Persönliche Kopie anlegen»** klicken. Dann steht dein Passwort in `durchblick.conf.local.yml`, die nie ins Repository gelangt.
2. Speichern (Strg+S / Cmd+S).
3. Reiter **Prüfen** → «Verbindung testen» und «Alle Queries prüfen».
4. Queries an dein Schema anpassen, bis überall **OK** steht.
5. In der Weboberfläche alle Reiter durchgehen: **keine Emojis mehr = geschafft!** 🎉

Für die **Galerie** brauchst du die Query `gallery.sql_gallery_bind`. Sie muss `digest`, `path` und am besten `type` liefern:

```yaml
gallery:
  sql_gallery_bind: "select digest, path, type from Meta where type like 'image/%' and path like ? order by path limit ?;"
```

Heissen deine Spalten anders, arbeite mit Aliasen (`select hash as digest, …`).

---

## 6. Gestalten 🎨

Mach Durchblick zu **deinem** Projekt:

1. In der Config im Abschnitt `ui:` Titel, Untertitel und Logo (ein Emoji) setzen:
   ```yaml
   ui:
     titel: 'Game-Shop Datenbank'
     untertitel: 'Skins, Rucksäcke und Tänze · Anna Beispiel'
     logo: '🎮'
     theme: arcade
   ```
2. Im Reiter **Design** eine Vorlage ausprobieren und im Live-Editor eigenes CSS schreiben.
3. Ergebnis als `theme/eigenes.css` speichern (installierte Version: `Dokumente\Durchblick\theme\eigenes.css`) und den Browser neu laden.

Alle Möglichkeiten: [EIGENES-DESIGN.md](EIGENES-DESIGN.md).

---

## Checkliste für die Abgabe

- [ ] Rohdaten verkleinert, Quelle in `LIESMICH.txt` eingetragen
- [ ] CSV-Prüfung ohne Fehler (Prüfbericht beigelegt)
- [ ] Schema dokumentiert (ERD, Begründung der Schlüssel und Datentypen)
- [ ] Import nachvollziehbar dokumentiert (Befehle, Anzahl Zeilen)
- [ ] Alle Queries im Panel «OK», keine Emojis in der Weboberfläche
- [ ] Galerie zeigt deine Bilder
- [ ] Eigene Gestaltung (`theme/eigenes.css`, `ui:`-Abschnitt)
- [ ] **Kein Passwort** in Screenshots, Abgaben oder im Repository

Probleme? → [HILFE.md](HILFE.md)
