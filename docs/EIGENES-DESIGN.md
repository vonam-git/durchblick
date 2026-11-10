# 🎨 Eigenes Design

Durchblick ist so gebaut, dass du die ganze Weboberfläche mit **CSS** umgestalten kannst – ohne eine einzige Zeile Python oder HTML anzufassen.

## Wie die Gestaltung aufgebaut ist

Die Stylesheets werden in dieser Reihenfolge geladen. Was später kommt, gewinnt:

| Reihenfolge | Datei | Wer ändert sie? |
|---|---|---|
| 1 | `web/css/app.css` | niemand (Grundgestaltung) |
| 2 | `web/themes/<vorlage>.css` | niemand (Vorlage, gewählt mit `ui: theme:`) |
| 3 | **`theme/eigenes.css`** | **du** |
| 4 | Live-Editor im Reiter «Design» | du (nur zum Ausprobieren, nur in deinem Browser) |

## In 3 Minuten zum eigenen Look

1. Webserver starten, Reiter **🎨 Design** öffnen.
2. Eine Vorlage anklicken (Standard, Hell, Arcade, Terminal, Alpen).
3. Im Live-Editor tippen, zum Beispiel:
   ```css
   :root {
     --accent: #00c2a8;
     --radius: 24px;
   }
   ```
   Die Seite ändert sich sofort.
4. **⬇️ Als eigenes.css speichern** und die Datei in den Ordner `theme/` kopieren (bestehende Datei ersetzen).
5. Gewünschte Vorlage dauerhaft in der Config eintragen: `ui:` → `theme: arcade`.

## Variablen

Am einfachsten gestaltest du über **CSS-Variablen**. Eine Änderung wirkt überall.

| Variable | Wirkung |
|---|---|
| `--bg` | Hintergrundfarbe der Seite |
| `--bg-image` | Hintergrundbild oder Verlauf, z.B. `url('/theme/hintergrund.webp')` |
| `--panel`, `--panel2` | Flächen (Karten, Tabellen, Eingabefelder) |
| `--border` | Rahmen |
| `--text`, `--muted` | Text und gedämpfter Text |
| `--accent`, `--accent2` | Akzentfarben (Buttons, Links, aktive Reiter) |
| `--accent-text` | Textfarbe auf der Akzentfarbe |
| `--ok`, `--warn`, `--err`, `--info` | Statusfarben |
| `--header-bg` | Hintergrund des Kopfbereichs |
| `--radius`, `--radius-small` | Eckenradius |
| `--shadow` | Schatten der Karten |
| `--font`, `--font-heading`, `--font-mono` | Schriftarten |
| `--font-size` | Grundschriftgrösse |
| `--max-width` | maximale Breite des Inhalts |
| `--gallery-size` | Breite eines Galeriebildes |
| `--gallery-bg` | Hintergrund hinter Galeriebildern |

## Wichtige Klassen und IDs

| Selektor | Element |
|---|---|
| `.site-header`, `.site-logo`, `.site-title`, `.site-subtitle` | Kopfbereich |
| `.site-nav`, `.site-nav button.active` | Navigation |
| `#tab-start`, `#tab-overview`, `#tab-browse`, `#tab-gallery`, `#tab-tags`, `#tab-werkstatt`, `#tab-design`, `#tab-hilfe` | einzelne Seiten |
| `.steps`, `.step` | Ablauf-Kacheln auf der Startseite |
| `.stat`, `.stat .value` | Zahlen-Kacheln in der Übersicht |
| `table.data` | Tabellen |
| `.gallery`, `.gallery-item`, `.gallery-item .thumb img`, `.gallery-item .name` | Galerie |
| `.dialog`, `.preview-img` | Detailansicht eines Datensatzes |
| `.chip` | Tags und Filter |
| `.card`, `button.primary` | Werkstatt |
| `.site-footer` | Fusszeile |

Tipp: Mit **F12** (Entwicklerwerkzeuge) und dem Pfeil-Werkzeug siehst du zu jedem Element die Klasse.

## Bilder und Schriften

Lege eigene Dateien direkt in den Ordner `theme/` (keine Unterordner) und verwende sie mit `/theme/dateiname`:

```css
:root {
  --bg-image: linear-gradient(rgba(10, 0, 30, .75), rgba(10, 0, 30, .9)),
              url('/theme/hintergrund.webp');
}

@font-face {
  font-family: "Meine Schrift";
  src: url('/theme/meineschrift.woff2') format('woff2');
}
:root { --font-heading: "Meine Schrift", system-ui, sans-serif; }
```

Erlaubte Endungen: `.css .png .jpg .jpeg .webp .gif .svg .woff .woff2 .ttf .otf`.

> 🔒 **Warum keine Google Fonts oder Bilder von anderen Webseiten?** Jede externe Adresse würde deine IP-Adresse an fremde Server übermitteln. Darum blockiert die Content-Security-Policy alle externen Quellen. Lade Schriften mit passender Lizenz herunter (z.B. Open-Font-License) und lege sie in `theme/`.

## Ideen

**Galerie als Sammelkarten**

```css
.gallery-item { border-width: 3px; border-color: gold; }
.gallery-item .thumb { background: radial-gradient(circle, #fff7d6, #f0b400); }
.gallery-item:hover { transform: translateY(-6px) rotate(-1.5deg); }
```

**Bilder nach Ordner unterschiedlich einfärben** – die Galerie-Chips und Pfade enthalten den Ordnernamen. Mit Attribut-Selektoren geht das zum Beispiel für Bilder, deren `alt`-Text etwas enthält:

```css
.gallery-item img[alt*="ninja"] { filter: drop-shadow(0 0 8px #39ff6a); }
```

**Startseite mit grossem Banner**

```css
#tab-start::before {
  content: "Willkommen im Game-Shop!";
  display: block; font-size: 42px; font-weight: 900; margin-bottom: 20px;
  background: linear-gradient(90deg, var(--accent), var(--accent2));
  -webkit-background-clip: text; background-clip: text; color: transparent;
}
```

**Dunkel-/Hell-Modus des Betriebssystems berücksichtigen**

```css
@media (prefers-color-scheme: light) {
  :root { --bg: #fafafa; --panel: #fff; --text: #222; }
}
```

## Gute Gestaltung – kurz und knapp

- **Kontrast:** Text muss gut lesbar sein (prüfe z.B. mit einem Kontrast-Checker, Ziel mindestens 4.5 : 1).
- **Wenige Farben:** eine Hintergrundfarbe, eine Akzentfarbe, eine zweite Akzentfarbe reichen.
- **Bewegung sparsam:** Animationen nur beim Darüberfahren und kurz (unter 0.3 s).
- **Teste auf dem Handy:** Browserfenster schmal ziehen.
