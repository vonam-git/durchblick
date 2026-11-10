# 🔒 Datenschutz und Urheberrecht

Durchblick ist für den Unterricht an einer Schweizer Berufsfachschule gedacht. Dieses Dokument erklärt, **welche Daten wo verarbeitet werden**, welche Schutzmassnahmen eingebaut sind und worauf Lernende achten müssen.

> Dies ist eine Orientierungshilfe für den Unterricht und **keine Rechtsberatung**. Massgebend sind die Vorgaben der Schule und des Kantons.

## Kurzfassung für Lernende

1. **Deine Dateien verlassen deinen Computer nicht.** Die Werkstatt arbeitet komplett im Browser.
2. **Die CSV ist persönlich.** Sie enthält deinen Namen und dein Geburtsdatum. Nicht teilen, nicht öffentlich hochladen, nach dem Kurs löschen.
3. **Passwort gehört nicht in Abgaben.** Verwende `durchblick.conf.local.yml` («Persönliche Kopie anlegen»).
4. **Keine Fotos von Personen** ohne deren Einverständnis – auch nicht von Mitlernenden.
5. **Fremde Bilder** (Spiele, Filme, Webseiten) nur im Unterricht verwenden, nie öffentlich ins Internet stellen. Quelle in `LIESMICH.txt` angeben.

## Welche Daten verarbeitet Durchblick?

| Daten | Wo | Wohin | Schutz |
|---|---|---|---|
| Rohdaten (Bilder, Videos, Texte) | Browser (Werkstatt) | nirgends, nur als Download-ZIP auf deinen Computer | keine Übertragung, EXIF-Metadaten werden entfernt |
| Name, Geburtsdatum | Browser (Werkstatt 2) | in die CSV (Dateiname und zwei versteckte Dateien) | nur lokal; `.gitignore` schliesst `*.csv` aus |
| CSV-Inhalt | deine Datenbank | lokal oder Schulserver | Zugriff nur mit DB-Benutzer und Passwort |
| DB-Zugangsdaten | `durchblick.conf(.local).yml` | Webserver auf deinem Computer | Server nur über `127.0.0.1`; Passwort wird nie an den Browser geschickt |
| Live-CSS, gewählte Vorlage | `localStorage` deines Browsers | nirgends | bleibt in diesem Browser |
| Panel-Einstellungen (Hell/Dunkel, Browser automatisch öffnen) | `~/.durchblick_panel.json` | nirgends | enthält keine Personendaten |

Durchblick enthält **keine** Tracker, keine Statistik-Dienste und lädt **keine** externen Skripte, Schriften oder Bilder. Die Content-Security-Policy erzwingt das technisch.

## Eingebaute Schutzmassnahmen

- **Datenminimierung:** Die Werkstatt verkleinert Rohdaten. Weniger Daten = weniger Risiko.
- **Metadaten entfernen:** Beim Neu-Kodieren von Bildern gehen EXIF-Daten verloren (GPS-Standort, Kameramodell, Aufnahmezeit, teils Name des Geräts). JPEG-Bilder werden darum immer neu kodiert.
- **Lokaler Betrieb:** Der Webserver lauscht auf `127.0.0.1` und weist fremde Hostnamen ab.
- **Keine externen Quellen:** Content-Security-Policy `default-src 'self'`, `Referrer-Policy: no-referrer`.
- **Schutz vor Fehlbedienung:** `.gitignore` verhindert, dass CSV-Dateien, Prüfberichte, verkleinerte ZIPs und `*.local.yml` ins Repository gelangen.
- **Hinweise in der Oberfläche:** Datenschutzhinweise direkt bei Name/Geburtsdatum und beim Verkleinern.

## Rechtlicher Rahmen (Schweiz)

- **Datenschutz:** Für öffentliche Schulen gilt in der Regel das **kantonale Datenschutzgesetz**. Für Private und Unternehmen – etwa deinen Lehrbetrieb – gilt das **Bundesgesetz über den Datenschutz (DSG)**, das seit dem 1. September 2023 in revidierter Fassung in Kraft ist. Beide verlangen unter anderem, dass Personendaten nur zweckmässig, verhältnismässig und sicher bearbeitet werden.
- **Personendaten im Projekt:** Name und Geburtsdatum sind Personendaten. Der Zweck ist hier klar (Zuordnung und Kontrolle der eigenen Arbeit). Verwende sie nicht für anderes.
- **Recht am eigenen Bild:** Fotos von Personen dürfen nur mit deren Einverständnis verwendet werden.
- **Urheberrecht (URG):** Bilder, Videos, Musik und Texte aus Spielen (z.B. Skins und Tänze), Filmen oder Webseiten sind urheberrechtlich geschützt. Das Urheberrechtsgesetz erlaubt die Verwendung im Unterricht in der Klasse (Eigengebrauch, Art. 19 URG). **Öffentlich zugänglich machen** – zum Beispiel auf einer Webseite oder in einem öffentlichen Repository – ist damit **nicht** erlaubt. Viele Spielehersteller haben eigene Regeln für Fan-Inhalte; lies sie, bevor du etwas veröffentlichst.
- **Freie Alternativen:** Eigene Fotos und Zeichnungen, Bilder mit freier Lizenz (z.B. Creative Commons, mit Quellenangabe) oder die fiktiven Beispiel-Rohdaten der Werkstatt.

## Empfehlungen für Lehrpersonen

- Den Lernenden erlauben, ein **Pseudonym** und ein **fiktives Geburtsdatum** zu verwenden, wenn die Zuordnung anders sichergestellt ist (z.B. über die Abgabe-Plattform).
- Schul-Datenbankserver so einrichten, dass jede Person nur ihre eigene Datenbank sieht (eigener DB-Benutzer, `GRANT` nur auf die eigene DB).
- CSV-Dateien und Datenbanken nach Kursende löschen lassen bzw. selbst löschen.
- Für Abgaben Screenshots ohne Zugangsdaten und ohne Geburtsdatum verlangen.
- Mit den Lernenden die Frage diskutieren: *Welche Personendaten stecken in unserem Projekt, und wie schützen wir sie?* – das passt direkt zu den Handlungszielen des Moduls (Datenschutz und Datensicherheit beim Betrieb einer Datenbank).

## Daten löschen

| Was | Wie |
|---|---|
| CSV, Prüfbericht, ZIP | Datei im Download-Ordner löschen |
| Datenbank | `DROP DATABASE m141;` (bzw. Datei löschen bei SQLite) |
| Live-CSS und Vorlage im Browser | Reiter «Design» → «Leeren», Vorlage «Standard» wählen, oder Browserdaten für `127.0.0.1` löschen |
| Zugangsdaten | `durchblick.conf.local.yml` löschen |
