#!/usr/bin/env python3
"""
Durchblick Control Panel - Verwaltungsoberfläche für die Durchblick-Weboberfläche
Plattformen: Windows, Ubuntu/Linux, macOS     Python: 3.9+

Der Webserver läuft als eigener Prozess (durchblick_web.py). Dadurch gilt:
- Config-Änderungen werden ohne Neustart übernommen
- Die Logs des Servers erscheinen live im Bereich «Protokoll»
- Ein Absturz des Servers reisst das Panel nicht mit

Voraussetzungen (einmalig):
    Ubuntu:   sudo apt install python3-tk python3-venv
    macOS:    Python von python.org installieren (enthält Tk)
    Windows:  Python von python.org installieren (enthält Tk)
    Alle:     python -m pip install -r requirements.txt

Start:  python durchblick_panel.py
"""

import importlib.util
import json
import os
import platform
import queue
import re
import socket
import subprocess
import sys
import threading
import time
import webbrowser
from collections import deque
from datetime import datetime
from pathlib import Path

import tkinter as tk
from tkinter import messagebox, ttk
from tkinter import font as tkfont

try:
    import durchblick_db as db
    IMPORT_ERROR = None
except ModuleNotFoundError as exc:  # z. B. PyYAML fehlt
    db = None
    IMPORT_ERROR = exc

APP_VERSION = "2.0"
APP_DIR = Path(__file__).resolve().parent
WEB_SCRIPT = APP_DIR / "durchblick_web.py"
THEME_DIR = APP_DIR / "theme"
DOCS_DIR = APP_DIR / "docs"
SETTINGS_FILE = Path.home() / ".durchblick_panel.json"
IS_MAC = sys.platform == "darwin"
SAVE_KEY = "Cmd+S" if IS_MAC else "Strg+S"

INSTALL_CMD = ("python -m pip install -r requirements.txt" if sys.platform == "win32"
               else "python3 -m pip install -r requirements.txt")

DEFAULT_CONFIG = """---
db:
  dsn: 'DBI:mysql:database=m141;host=localhost;port=3306'
  user: DBUSER
  pass: DBPASS

app:
  host: 127.0.0.1
  port: 3000
"""

# Farbschemata (passend zur Weboberfläche)
PALETTES = {
    "dunkel": {
        "bg": "#0f1220", "panel": "#171a2b", "panel2": "#1e2238", "border": "#2a2f4a",
        "text": "#e8eaf2", "muted": "#9aa0b5", "accent": "#6d4aff", "accent2": "#8f74ff",
        "accent_text": "#ffffff", "ok": "#3dd68c", "warn": "#ffb547", "err": "#ff5c74",
        "info": "#6aa8ff", "header": "#1a1e36", "select": "#3a2f80", "editor": "#12152a",
        "yaml_key": "#8fb4ff", "yaml_section": "#c3a6ff", "yaml_string": "#7fdca8",
        "yaml_comment": "#6b7290", "yaml_number": "#ffb86b",
    },
    "hell": {
        "bg": "#f3f4f8", "panel": "#ffffff", "panel2": "#eceef5", "border": "#d9dce8",
        "text": "#1f2330", "muted": "#5d6478", "accent": "#5b3df5", "accent2": "#4a2ee0",
        "accent_text": "#ffffff", "ok": "#0e9f6e", "warn": "#c2690a", "err": "#d92d3f",
        "info": "#2563eb", "header": "#ffffff", "select": "#dcd5ff", "editor": "#fbfbfe",
        "yaml_key": "#1d4ed8", "yaml_section": "#6d28d9", "yaml_string": "#047857",
        "yaml_comment": "#8a90a6", "yaml_number": "#b45309",
    },
}

STEPS = [
    ("Server starten", "Startet die Weboberfläche auf deinem Computer.", "▶  Starten", "start"),
    ("Werkstatt", "Rohdaten verkleinern, CSV generieren und prüfen.", "Werkstatt öffnen", "web:werkstatt"),
    ("Importieren", "Schema anlegen und die CSV in deine Datenbank laden.", "Anleitung", "docs"),
    ("Verbinden", f"DSN, Benutzer und Passwort eintragen, speichern ({SAVE_KEY}).", "Konfiguration", "page:1"),
    ("Queries prüfen", "Alle Queries testen, bis überall «OK» steht.", "Prüfen", "page:2"),
    ("Gestalten", "Galerie ansehen und mit eigenem CSS gestalten.", "Design öffnen", "web:design"),
]

TIPS = [
    "Config-Änderungen gelten sofort, ein Neustart des Servers ist nicht nötig.",
    "Echtes Passwort? «Persönliche Kopie» speichert die Config als durchblick.conf.local.yml "
    "(wird von Git ignoriert).",
    "Emojis in der Weboberfläche zeigen Queries, die noch nicht zum Schema passen.",
]


# ----------------------------------------------------------------------------
# Hilfsfunktionen
# ----------------------------------------------------------------------------

def enable_hidpi():
    """Scharfe Darstellung auf hochauflösenden Windows-Bildschirmen."""
    if sys.platform == "win32":
        try:
            import ctypes
            ctypes.windll.shcore.SetProcessDpiAwareness(1)
        except Exception:
            pass


def port_in_use(port: int) -> bool:
    with socket.socket() as s:
        s.settimeout(0.5)
        return s.connect_ex(("127.0.0.1", port)) == 0


def open_folder(path: Path):
    try:
        if sys.platform == "win32":
            os.startfile(str(path))  # noqa
        elif IS_MAC:
            subprocess.Popen(["open", str(path)])
        else:
            subprocess.Popen(["xdg-open", str(path)])
    except Exception as exc:
        messagebox.showerror("Fehler", f"Ordner konnte nicht geöffnet werden:\n{exc}")


def level_of(line: str) -> str:
    up = line.upper()
    if "ERROR" in up or "TRACEBACK" in up or "EXCEPTION" in up or "FEHLER" in up:
        return "ERROR"
    if "WARNING" in up:
        return "WARNING"
    return "INFO"


def parse_params(text: str):
    text = text.strip()
    if not text:
        return None
    return [int(p) if re.fullmatch(r"-?\d+", p.strip()) else p.strip() for p in text.split(",")]


def load_settings() -> dict:
    try:
        return json.loads(SETTINGS_FILE.read_text(encoding="utf-8"))
    except Exception:
        return {}


def save_settings(data: dict):
    try:
        SETTINGS_FILE.write_text(json.dumps(data), encoding="utf-8")
    except OSError:
        pass  # nicht schlimm, dann gilt beim nächsten Start wieder der Standard


def pick_family(candidates, fallback):
    available = {f.lower(): f for f in tkfont.families()}
    for c in candidates:
        if c.lower() in available:
            return available[c.lower()]
    return fallback


# ----------------------------------------------------------------------------
# Hauptfenster
# ----------------------------------------------------------------------------

class _CanvasFill:
    """Hilfsobjekt, damit Canvas-Elemente beim Farbwechsel mit umgefärbt werden."""

    def __init__(self, canvas, tag):
        self.canvas, self.tag = canvas, tag

    def configure(self, **kw):
        self.canvas.itemconfigure(self.tag, **kw)


class Panel:

    NAV = [("⌂", "Start"), ("⚙", "Konfiguration"), ("✔", "Prüfen"), ("▷", "Query-Tester"),
           ("☰", "Protokoll"), ("ⓘ", "System")]

    def __init__(self, root: tk.Tk):
        self.root = root
        root.title(f"Durchblick Control Panel {APP_VERSION}")
        root.geometry("1120x780")
        root.minsize(940, 640)

        self.settings = load_settings()
        self.mode = self.settings.get("farben") if self.settings.get("farben") in PALETTES else "dunkel"
        self.c = PALETTES[self.mode]
        self.cfg_path = db.config_path()
        self.proc = None
        self.run_port = 3000
        self.stopping = False
        self.log_q = queue.Queue()
        self.ui_q = queue.Queue()
        self.log_lines = deque(maxlen=3000)
        self.auto_open = tk.BooleanVar(value=self.settings.get("auto_open", True))
        self.dirty = False
        self._painted = []      # (widget, {option: farbname}) für den Farbwechsel
        self._hl_job = None
        self._check_counts = None

        self._fonts()
        self._style()
        self._build_header()
        body = self.body = tk.Frame(root)
        self._paint(body, bg="bg")
        body.pack(fill="both", expand=True)
        self._build_sidebar(body)
        self.notebook = ttk.Notebook(body, style="Pages.TNotebook")
        self.notebook.pack(side="left", fill="both", expand=True, padx=(0, 16), pady=14)
        self._build_start_tab()
        self._build_config_tab()
        self._build_check_tab()
        self._build_tester_tab()
        self._build_log_tab()
        self._build_system_tab()
        self.notebook.bind("<<NotebookTabChanged>>", lambda e: self._sync_nav())
        self._build_statusbar()

        self._load_editor()
        self._refresh_status()
        self._bind_keys()
        self._sync_nav()
        self.log(f"Control Panel gestartet. Config: {self.cfg_path}", "INFO")
        self._tick()

    # ------------------------------------------------------------------
    # Gestaltung
    # ------------------------------------------------------------------

    def _fonts(self):
        ui = pick_family(["Segoe UI Variable Text", "Segoe UI", "SF Pro Text", ".AppleSystemUIFont",
                          "Helvetica Neue", "Inter", "Ubuntu", "Cantarell", "Noto Sans", "DejaVu Sans"],
                         tkfont.nametofont("TkDefaultFont").cget("family"))
        mono = pick_family(["Cascadia Mono", "Consolas", "SF Mono", "Menlo", "JetBrains Mono",
                            "Ubuntu Mono", "DejaVu Sans Mono"],
                           tkfont.nametofont("TkFixedFont").cget("family"))
        base = 10
        for name in ("TkDefaultFont", "TkTextFont", "TkMenuFont", "TkHeadingFont"):
            tkfont.nametofont(name).configure(family=ui, size=base)
        self.f = {
            "base": (ui, base), "small": (ui, base - 1), "bold": (ui, base, "bold"),
            "nav": (ui, base + 1), "nav_icon": (ui, base + 3),
            "h1": (ui, base + 9, "bold"), "h2": (ui, base + 4, "bold"), "h3": (ui, base + 1, "bold"),
            "brand": (ui, base + 6, "bold"), "status": (ui, base + 1, "bold"),
            "num": (ui, base + 2, "bold"), "mono": (mono, base),
        }
        self.fixed = tkfont.Font(family=mono, size=base)
        tkfont.nametofont("TkFixedFont").configure(family=mono, size=base)

    def _paint(self, widget, **roles):
        """Tk-Widget mit Farbrollen einfärben und für den Farbwechsel merken."""
        self._painted.append((widget, roles))
        widget.configure(**{opt: self.c[role] for opt, role in roles.items()})
        return widget

    def _style(self):
        c = self.c
        style = ttk.Style()
        style.theme_use("clam")  # «clam» lässt sich auf allen Systemen frei einfärben
        self.root.configure(bg=c["bg"])
        style.configure(".", background=c["bg"], foreground=c["text"], fieldbackground=c["panel2"],
                        bordercolor=c["border"], lightcolor=c["border"], darkcolor=c["border"],
                        troughcolor=c["panel"], selectbackground=c["select"],
                        selectforeground=c["text"], insertcolor=c["text"], font=self.f["base"],
                        focuscolor=c["accent"])
        style.configure("TFrame", background=c["bg"])
        style.configure("Card.TFrame", background=c["panel"])
        style.configure("TLabel", background=c["bg"], foreground=c["text"])
        style.configure("Card.TLabel", background=c["panel"])
        style.configure("Muted.TLabel", background=c["panel"], foreground=c["muted"])

        # Buttons
        common = dict(padding=(14, 7), relief="flat", borderwidth=1, font=self.f["base"])
        style.configure("TButton", background=c["panel2"], foreground=c["text"],
                        bordercolor=c["border"], lightcolor=c["panel2"], darkcolor=c["panel2"], **common)
        style.map("TButton",
                  background=[("disabled", c["panel"]), ("pressed", c["border"]), ("active", c["border"])],
                  foreground=[("disabled", c["muted"])],
                  bordercolor=[("focus", c["accent"]), ("active", c["accent"])],
                  lightcolor=[("active", c["border"])], darkcolor=[("active", c["border"])])
        style.configure("Accent.TButton", background=c["accent"], foreground=c["accent_text"],
                        bordercolor=c["accent"], lightcolor=c["accent"], darkcolor=c["accent"],
                        **dict(common, font=self.f["bold"]))
        style.map("Accent.TButton",
                  background=[("disabled", c["panel2"]), ("pressed", c["accent2"]), ("active", c["accent2"])],
                  foreground=[("disabled", c["muted"])],
                  bordercolor=[("disabled", c["border"]), ("active", c["accent2"])],
                  lightcolor=[("disabled", c["panel2"]), ("active", c["accent2"])],
                  darkcolor=[("disabled", c["panel2"]), ("active", c["accent2"])])
        style.configure("Danger.TButton", background=c["panel2"], foreground=c["err"],
                        bordercolor=c["border"], lightcolor=c["panel2"], darkcolor=c["panel2"], **common)
        style.map("Danger.TButton",
                  background=[("disabled", c["panel"]), ("active", c["border"])],
                  foreground=[("disabled", c["muted"])],
                  bordercolor=[("active", c["err"])])
        style.configure("Link.TButton", background=c["panel"], foreground=c["accent2"],
                        bordercolor=c["panel"], lightcolor=c["panel"], darkcolor=c["panel"],
                        padding=(4, 2), relief="flat", font=self.f["base"])
        style.map("Link.TButton", background=[("active", c["panel2"])],
                  bordercolor=[("active", c["panel2"])], lightcolor=[("active", c["panel2"])],
                  darkcolor=[("active", c["panel2"])])

        # Seiten ohne sichtbare Reiter (Navigation über die Seitenleiste)
        style.layout("Pages.TNotebook.Tab", [])
        style.configure("Pages.TNotebook", background=c["bg"], borderwidth=0, tabmargins=0, padding=0,
                        bordercolor=c["bg"], lightcolor=c["bg"], darkcolor=c["bg"])
        style.layout("Pages.TNotebook", [("Notebook.client", {"sticky": "nswe"})])

        # Eingabefelder, Listen, Bildlaufleisten
        style.configure("TEntry", fieldbackground=c["panel2"], foreground=c["text"],
                        bordercolor=c["border"], lightcolor=c["panel2"], darkcolor=c["panel2"], padding=6)
        style.map("TEntry", bordercolor=[("focus", c["accent"])], lightcolor=[("focus", c["accent"])])
        style.configure("TCombobox", fieldbackground=c["panel2"], background=c["panel2"],
                        foreground=c["text"], arrowcolor=c["muted"], bordercolor=c["border"],
                        lightcolor=c["panel2"], darkcolor=c["panel2"], padding=5)
        style.map("TCombobox", fieldbackground=[("readonly", c["panel2"])],
                  foreground=[("readonly", c["text"])], selectbackground=[("readonly", c["panel2"])],
                  selectforeground=[("readonly", c["text"])], bordercolor=[("focus", c["accent"])],
                  background=[("active", c["border"])])
        self.root.option_add("*TCombobox*Listbox.background", c["panel2"])
        self.root.option_add("*TCombobox*Listbox.foreground", c["text"])
        self.root.option_add("*TCombobox*Listbox.selectBackground", c["accent"])
        self.root.option_add("*TCombobox*Listbox.selectForeground", c["accent_text"])
        self.root.option_add("*TCombobox*Listbox.font", self.f["base"])
        for orient in ("Vertical", "Horizontal"):
            style.configure(f"{orient}.TScrollbar", background=c["panel2"], troughcolor=c["panel"],
                            bordercolor=c["panel"], arrowcolor=c["muted"], lightcolor=c["panel2"],
                            darkcolor=c["panel2"], gripcount=0, arrowsize=12)
            style.map(f"{orient}.TScrollbar", background=[("active", c["border"])])
        style.configure("TCheckbutton", background=c["panel"], foreground=c["text"],
                        indicatorbackground=c["panel2"], indicatorforeground=c["accent"],
                        indicatormargin=(0, 0, 8, 0))
        style.map("TCheckbutton", background=[("active", c["panel"])],
                  indicatorbackground=[("selected", c["panel2"]), ("active", c["border"])])
        style.configure("Treeview", background=c["panel"], fieldbackground=c["panel"],
                        foreground=c["text"], bordercolor=c["border"], rowheight=28,
                        lightcolor=c["panel"], darkcolor=c["panel"])
        style.map("Treeview", background=[("selected", c["select"])],
                  foreground=[("selected", c["text"])])
        style.configure("Treeview.Heading", background=c["panel2"], foreground=c["muted"],
                        bordercolor=c["border"], lightcolor=c["panel2"], darkcolor=c["panel2"],
                        relief="flat", padding=(8, 6), font=self.f["bold"])
        style.map("Treeview.Heading", background=[("active", c["border"])])

    def toggle_colors(self):
        self.mode = "hell" if self.mode == "dunkel" else "dunkel"
        self.c = PALETTES[self.mode]
        self.settings["farben"] = self.mode
        save_settings(self.settings)
        self._style()
        for widget, roles in self._painted:
            try:
                widget.configure(**{opt: self.c[role] for opt, role in roles.items()})
            except tk.TclError:
                pass  # Widget gibt es nicht mehr
        self._color_tags()
        self._draw_logo()
        self._sync_nav()
        self._refresh_status()
        self._set_dirty(self.dirty)
        self._update_system()
        self.mode_btn.configure(text="☀  Hell" if self.mode == "dunkel" else "☾  Dunkel")

    def _color_tags(self):
        c = self.c
        for tree in (self.check_tree, self.result_tree):
            tree.tag_configure("OK", foreground=c["ok"])
            tree.tag_configure("Fehler", foreground=c["err"])
            tree.tag_configure("Leer", foreground=c["warn"])
            tree.tag_configure("Hinweis", foreground=c["warn"])
            tree.tag_configure("übersprungen", foreground=c["muted"])
            tree.tag_configure("odd", background=c["panel"])
            tree.tag_configure("even", background=c["panel2"])
        self.log_text.tag_configure("INFO", foreground=c["info"])
        self.log_text.tag_configure("WARNING", foreground=c["warn"])
        self.log_text.tag_configure("ERROR", foreground=c["err"])
        self.log_text.tag_configure("PANEL", foreground=c["ok"])
        for name, role in (("comment", "yaml_comment"), ("section", "yaml_section"), ("key", "yaml_key"),
                           ("string", "yaml_string"), ("number", "yaml_number")):
            self.editor.tag_configure(name, foreground=c[role])
        self.editor.tag_configure("section", font=(self.f["mono"][0], self.f["mono"][1], "bold"))
        self.editor.tag_raise("string")
        self.editor.tag_raise("comment")

    # ------------------------------------------------------------------
    # Bausteine
    # ------------------------------------------------------------------

    def card(self, parent, title=None, subtitle=None, pad=18):
        """Karte mit Rahmen, optionalem Titel und Untertitel. Gibt den Inhaltsbereich zurück."""
        outer = self._paint(tk.Frame(parent, highlightthickness=1, bd=0),
                            bg="panel", highlightbackground="border", highlightcolor="border")
        inner = self._paint(tk.Frame(outer, bd=0), bg="panel")
        inner.pack(fill="both", expand=True, padx=pad, pady=pad - 4)
        if title:
            self._paint(tk.Label(inner, text=title, font=self.f["h3"], anchor="w"),
                        bg="panel", fg="text").pack(fill="x")
        if subtitle:
            sub = self._paint(tk.Label(inner, text=subtitle, font=self.f["small"], anchor="w",
                                       justify="left", wraplength=320), bg="panel", fg="muted")
            sub.pack(fill="x", pady=(2, 0))
            sub.bind("<Configure>", lambda e: e.widget.configure(wraplength=max(200, e.width - 4)))
        if title or subtitle:
            self._paint(tk.Frame(inner, height=10), bg="panel").pack(fill="x")
        outer.inner = inner
        return outer

    def label(self, parent, text="", role_bg="panel", role_fg="text", font=None, **kw):
        return self._paint(tk.Label(parent, text=text, font=font or self.f["base"], **kw),
                           bg=role_bg, fg=role_fg)

    def page(self, title, subtitle):
        tab = ttk.Frame(self.notebook)
        self.notebook.add(tab, text=title)
        head = ttk.Frame(tab)
        head.pack(fill="x", pady=(2, 14))
        self.label(head, title, "bg", "text", self.f["h1"], anchor="w").pack(fill="x")
        self.label(head, subtitle, "bg", "muted", self.f["base"], anchor="w").pack(fill="x", pady=(2, 0))
        return tab

    def text_widget(self, parent, **kw):
        """Textfeld mit Bildlaufleiste im Panel-Stil."""
        frame = self._paint(tk.Frame(parent, highlightthickness=1, bd=0),
                            bg="editor", highlightbackground="border", highlightcolor="accent")
        txt = tk.Text(frame, bd=0, relief="flat", font=self.fixed, padx=12, pady=10,
                      highlightthickness=0, **kw)
        self._paint(txt, bg="editor", fg="text", insertbackground="accent2",
                    selectbackground="select", selectforeground="text")
        ys = ttk.Scrollbar(frame, orient="vertical", command=txt.yview)
        txt.configure(yscrollcommand=ys.set)
        ys.pack(side="right", fill="y")
        txt.pack(side="left", fill="both", expand=True)
        return frame, txt

    # ------------------------------------------------------------------
    # Kopf, Seitenleiste, Statuszeile
    # ------------------------------------------------------------------

    def _build_header(self):
        head = self._paint(tk.Frame(self.root, height=72), bg="header")
        head.pack(fill="x")
        self._paint(tk.Frame(self.root, height=1), bg="border").pack(fill="x")

        self.logo = self._paint(tk.Canvas(head, width=40, height=40, highlightthickness=0, bd=0), bg="header")
        self.logo.pack(side="left", padx=(20, 10), pady=14)
        self._draw_logo()
        brand = self._paint(tk.Frame(head), bg="header")
        brand.pack(side="left")
        row = self._paint(tk.Frame(brand), bg="header")
        row.pack(anchor="w")
        self.label(row, "Durch", "header", "text", self.f["brand"], padx=0, bd=0).pack(side="left")
        self.label(row, "blick", "header", "accent2", self.f["brand"], padx=0, bd=0).pack(side="left")
        self.label(brand, f"Control Panel {APP_VERSION} · Modul 141", "header", "muted",
                   self.f["small"]).pack(anchor="w")

        right = self._paint(tk.Frame(head), bg="header")
        right.pack(side="right", padx=18)
        self.btn_browser = ttk.Button(right, text="↗  Im Browser öffnen", command=lambda: self.open_browser())
        self.btn_restart = ttk.Button(right, text="↻  Neustart", command=self.restart)
        self.btn_stop = ttk.Button(right, text="■  Stoppen", style="Danger.TButton", command=self.stop)
        self.btn_start = ttk.Button(right, text="▶  Starten", style="Accent.TButton", command=self.start)
        for b in (self.btn_browser, self.btn_restart, self.btn_stop, self.btn_start):
            b.pack(side="right", padx=4)

        # Status als «Pille»
        self.pill = self._paint(tk.Frame(head, highlightthickness=1, bd=0),
                                bg="panel2", highlightbackground="border")
        self.pill.pack(side="right", padx=(0, 14))
        self.dot = self._paint(tk.Label(self.pill, text="●", font=self.f["status"]), bg="panel2", fg="err")
        self.dot.pack(side="left", padx=(12, 4), pady=5)
        self.status_lbl = self.label(self.pill, "", "panel2", "text", self.f["status"])
        self.status_lbl.pack(side="left", padx=(0, 8))
        self.url_lbl = self._paint(tk.Label(self.pill, text="", cursor="hand2", font=self.f["base"]),
                                   bg="panel2", fg="accent2")
        self.url_lbl.pack(side="left", padx=(0, 12))
        self.url_lbl.bind("<Button-1>", lambda e: self.open_browser())

    def _draw_logo(self):
        c, cv = self.c, self.logo
        cv.delete("all")
        cv.create_oval(2, 2, 38, 38, fill=c["accent"], outline="")
        cv.create_oval(10, 9, 26, 25, outline="#ffffff", width=3)
        cv.create_line(24, 23, 31, 30, fill="#ffffff", width=4, capstyle="round")

    def _build_sidebar(self, body):
        side = self._paint(tk.Frame(body, width=210), bg="bg")
        side.pack(side="left", fill="y", padx=(16, 14), pady=14)
        side.pack_propagate(False)
        self.nav_items = []
        for i, (icon, name) in enumerate(self.NAV):
            item = self._paint(tk.Frame(side, cursor="hand2"), bg="bg")
            item.pack(fill="x", pady=2)
            ic = tk.Label(item, text=icon, font=self.f["nav_icon"], width=2, cursor="hand2")
            ic.pack(side="left", padx=(12, 6), pady=8)
            tx = tk.Label(item, text=name, font=self.f["nav"], anchor="w", cursor="hand2")
            tx.pack(side="left", fill="x", expand=True)
            for w in (item, ic, tx):
                w.bind("<Button-1>", lambda e, idx=i: self.notebook.select(idx))
                w.bind("<Enter>", lambda e, idx=i: self._hover_nav(idx, True))
                w.bind("<Leave>", lambda e, idx=i: self._hover_nav(idx, False))
            self.nav_items.append((item, ic, tx))

        bottom = self._paint(tk.Frame(side), bg="bg")
        bottom.pack(side="bottom", fill="x")
        self.mode_btn = ttk.Button(bottom, text="☀  Hell" if self.mode == "dunkel" else "☾  Dunkel",
                                   command=self.toggle_colors)
        self.mode_btn.pack(fill="x", pady=(0, 6))
        ttk.Button(bottom, text="?  Anleitungen", command=lambda: open_folder(DOCS_DIR)).pack(fill="x")

    def _nav_colors(self, idx, hover=False):
        active = idx == self._current_page()
        if active:
            return self.c["accent"], self.c["accent_text"], self.c["accent_text"]
        if hover:
            return self.c["panel2"], self.c["text"], self.c["text"]
        return self.c["bg"], self.c["muted"], self.c["text"]

    def _hover_nav(self, idx, hover):
        bg, icfg, txfg = self._nav_colors(idx, hover)
        item, ic, tx = self.nav_items[idx]
        for w in (item, ic, tx):
            w.configure(bg=bg)
        ic.configure(fg=icfg)
        tx.configure(fg=txfg)

    def _current_page(self):
        try:
            return self.notebook.index(self.notebook.select())
        except (tk.TclError, AttributeError):
            return 0

    def _sync_nav(self):
        for i in range(len(self.nav_items)):
            self._hover_nav(i, False)

    def _build_statusbar(self):
        bar = self._paint(tk.Frame(self.root), bg="panel")
        bar.pack(fill="x", side="bottom", before=self.body)
        self._paint(tk.Frame(bar, height=1), bg="border").pack(fill="x", side="top")
        self.statusbar = self.label(bar, "", "panel", "muted", self.f["small"], anchor="w")
        self.statusbar.pack(side="left", fill="x", expand=True, padx=16, pady=5)
        self.label(bar, f"Python {platform.python_version()} · {platform.system()}", "panel", "muted",
                   self.f["small"]).pack(side="right", padx=16)

    # ------------------------------------------------------------------
    # Seiten
    # ------------------------------------------------------------------

    def _build_start_tab(self):
        tab = self.page("Willkommen", "Vom Rohdaten-Ordner zur eigenen Datenbank-Weboberfläche – in sechs Schritten.")

        grid = ttk.Frame(tab)
        grid.pack(fill="x")
        for col in range(3):
            grid.columnconfigure(col, weight=1, uniform="steps")
        for i, (title, desc, btn, action) in enumerate(STEPS):
            card = self.card(grid, pad=16)
            card.grid(row=i // 3, column=i % 3, sticky="nsew", padx=(0 if i % 3 == 0 else 6, 0 if i % 3 == 2 else 6),
                      pady=6)
            top = self._paint(tk.Frame(card.inner), bg="panel")
            top.pack(fill="x")
            num = self._paint(tk.Canvas(top, width=30, height=30, highlightthickness=0, bd=0), bg="panel")
            num.pack(side="left")
            num.create_oval(1, 1, 29, 29, fill=self.c["accent"], outline="", tags="circle")
            num.create_text(15, 15, text=str(i + 1), fill="#ffffff", font=self.f["num"])
            self._painted.append((_CanvasFill(num, "circle"), {"fill": "accent"}))
            self.label(top, title, "panel", "text", self.f["h3"]).pack(side="left", padx=10)
            self.label(card.inner, desc, "panel", "muted", self.f["small"], anchor="w", justify="left",
                       wraplength=250).pack(fill="x", pady=(8, 10))
            style = "Accent.TButton" if action == "start" else "TButton"
            b = ttk.Button(card.inner, text=btn, style=style, command=lambda a=action: self._step_action(a))
            b.pack(anchor="w")
            if action == "start":
                self.btn_start_step = b

        lower = ttk.Frame(tab)
        lower.pack(fill="both", expand=True, pady=(12, 0))
        lower.columnconfigure(0, weight=3, uniform="lower")
        lower.columnconfigure(1, weight=2, uniform="lower")

        files = self.card(lower, "Dateien und Ordner")
        files.grid(row=0, column=0, sticky="nsew", padx=(0, 6))
        rows = [("Konfiguration", lambda: str(self.cfg_path), lambda: open_folder(self.cfg_path.parent)),
                ("Eigene Gestaltung", lambda: str(THEME_DIR / "eigenes.css"), lambda: open_folder(THEME_DIR)),
                ("Anleitungen", lambda: str(DOCS_DIR), lambda: open_folder(DOCS_DIR))]
        self.path_labels = []
        for name, path, action in rows:
            r = self._paint(tk.Frame(files.inner), bg="panel")
            r.pack(fill="x", pady=3)
            self.label(r, name, "panel", "text", self.f["bold"], width=17, anchor="w").pack(side="left")
            ttk.Button(r, text="Öffnen ↗", style="Link.TButton", command=action).pack(side="right")
            pl = self.label(r, path(), "panel", "muted", self.f["small"], anchor="w")
            pl.pack(side="left", fill="x", expand=True)
            self.path_labels.append((pl, path))
        ttk.Checkbutton(files.inner, text="Browser nach dem Start automatisch öffnen",
                        variable=self.auto_open, command=self._save_auto_open).pack(anchor="w", pady=(10, 0))

        tips = self.card(lower, "Gut zu wissen")
        tips.grid(row=0, column=1, sticky="nsew", padx=(6, 0))
        for t in TIPS:
            r = self._paint(tk.Frame(tips.inner), bg="panel")
            r.pack(fill="x", pady=3)
            self.label(r, "•", "panel", "accent2", self.f["bold"]).pack(side="left", anchor="n")
            self.label(r, t, "panel", "muted", self.f["small"], anchor="w", justify="left",
                       wraplength=300).pack(side="left", fill="x", padx=(6, 0))

    def _save_auto_open(self):
        self.settings["auto_open"] = bool(self.auto_open.get())
        save_settings(self.settings)

    def _step_action(self, action):
        if action == "start":
            if self.proc is None:
                self.start()
            else:
                self.open_browser()
        elif action == "docs":
            path = DOCS_DIR / "ANLEITUNG.md"
            webbrowser.open(path.as_uri()) if path.exists() else open_folder(DOCS_DIR)
        elif action.startswith("page:"):
            self.notebook.select(int(action[5:]))
        elif action.startswith("web:"):
            self.open_browser(action[4:])

    def _build_config_tab(self):
        tab = self.page("Konfiguration", "Verbindung, Queries und Gestaltung in durchblick.conf.yml.")
        bar = ttk.Frame(tab)
        bar.pack(fill="x", pady=(0, 10))
        ttk.Button(bar, text=f"Speichern  ({SAVE_KEY})", style="Accent.TButton",
                   command=self.save_config).pack(side="left", padx=(0, 6))
        ttk.Button(bar, text="YAML prüfen", command=self.validate_yaml).pack(side="left", padx=3)
        ttk.Button(bar, text="Neu laden", command=self._reload_editor).pack(side="left", padx=3)
        ttk.Button(bar, text="🔒  Persönliche Kopie", command=self.make_local_copy).pack(side="left", padx=3)
        self.dirty_lbl = self.label(bar, "", "bg", "muted", self.f["bold"])
        self.dirty_lbl.pack(side="right", padx=6)
        self.cfg_name_lbl = self.label(tab, "", "bg", "muted", self.f["small"], anchor="w")
        self.cfg_name_lbl.pack(fill="x", pady=(0, 6))
        frame, self.editor = self.text_widget(tab, wrap="none", undo=True, tabs=("2c",))
        frame.pack(fill="both", expand=True)
        self.editor.bind("<<Modified>>", self._on_modified)
        self.editor.bind("<KeyRelease>", lambda e: self._schedule_highlight())

    def _schedule_highlight(self):
        if self._hl_job:
            self.root.after_cancel(self._hl_job)
        self._hl_job = self.root.after(250, self._highlight)

    def _highlight(self):
        """Einfache YAML-Hervorhebung: Abschnitte, Schlüssel, Texte, Zahlen, Kommentare."""
        self._hl_job = None
        ed = self.editor
        for tag in ("comment", "section", "key", "string", "number"):
            ed.tag_remove(tag, "1.0", "end")
        for n, line in enumerate(ed.get("1.0", "end-1c").split("\n"), start=1):
            stripped = line.lstrip()
            if stripped.startswith("#"):
                ed.tag_add("comment", f"{n}.{len(line) - len(stripped)}", f"{n}.end")
                continue
            m = re.match(r"^(\s*)([\w.-]+)(\s*):", line)
            if m:
                ed.tag_add("section" if not m.group(1) else "key", f"{n}.{len(m.group(1))}",
                           f"{n}.{m.end(2)}")
            for sm in re.finditer(r"'[^']*'|\"[^\"]*\"", line):
                ed.tag_add("string", f"{n}.{sm.start()}", f"{n}.{sm.end()}")
            for nm in re.finditer(r"(?<=:\s)\d+\s*$", line):
                ed.tag_add("number", f"{n}.{nm.start()}", f"{n}.{nm.end()}")
            cm = re.search(r"\s#.*$", line)
            if cm and not re.search(r"['\"][^'\"]*#", line[:cm.start() + 1]):
                ed.tag_add("comment", f"{n}.{cm.start() + 1}", f"{n}.end")

    def _make_tree(self, parent, height):
        frame = self._paint(tk.Frame(parent, highlightthickness=1, bd=0),
                            bg="panel", highlightbackground="border")
        tree = ttk.Treeview(frame, height=height, show="headings")
        ys = ttk.Scrollbar(frame, orient="vertical", command=tree.yview)
        xs = ttk.Scrollbar(frame, orient="horizontal", command=tree.xview)
        tree.configure(yscrollcommand=ys.set, xscrollcommand=xs.set)
        tree.grid(row=0, column=0, sticky="nsew")
        ys.grid(row=0, column=1, sticky="ns")
        xs.grid(row=1, column=0, sticky="ew")
        frame.rowconfigure(0, weight=1)
        frame.columnconfigure(0, weight=1)
        return frame, tree

    def _set_table(self, tree, cols, rows, widths=None):
        tree.delete(*tree.get_children())
        ids = [f"c{i}" for i in range(len(cols))] or ["c0"]
        tree["columns"] = ids
        for i, cid in enumerate(ids):
            tree.heading(cid, text=cols[i] if cols else "", anchor="w")
            tree.column(cid, width=(widths[i] if widths else 130), minwidth=60, stretch=True, anchor="w")
        for n, row in enumerate(rows):
            # Zeile = Liste von Werten oder (Liste, Tag) für farbige Darstellung
            values, tag = row if isinstance(row, tuple) else (row, "")
            tags = ["even" if n % 2 else "odd"] + ([tag] if tag else [])
            tree.insert("", "end", values=values, tags=tags)

    def _build_check_tab(self):
        tab = self.page("Prüfen", "Verbindung testen, alle Queries kontrollieren und einzelne Queries ausprobieren.")

        top = ttk.Frame(tab)
        top.pack(fill="x", pady=(0, 12))
        top.columnconfigure(0, weight=1, uniform="top")
        top.columnconfigure(1, weight=2, uniform="top")

        conn = self.card(top, "1 · Verbindung", "Meldet sich mit DSN, Benutzer und Passwort an.")
        conn.grid(row=0, column=0, sticky="nsew", padx=(0, 6))
        ttk.Button(conn.inner, text="Verbindung testen", style="Accent.TButton",
                   command=self.test_connection).pack(anchor="w")
        self.conn_lbl = self.label(conn.inner, "Noch nicht getestet.", "panel", "muted", self.f["base"],
                                   anchor="w", justify="left", wraplength=280)
        self.conn_lbl.pack(fill="x", pady=(10, 0))

        summary = self.card(top, "2 · Alle Queries", "Schreibende Queries werden nie ausgeführt.")
        summary.grid(row=0, column=1, sticky="nsew", padx=(6, 0))
        row = self._paint(tk.Frame(summary.inner), bg="panel")
        row.pack(fill="x")
        ttk.Button(row, text="Alle Queries prüfen", style="Accent.TButton",
                   command=self.check_all).pack(side="left")
        self.badges = {}
        for key, role, text in (("bad", "err", "Fehler"), ("warn", "warn", "Hinweise"), ("ok", "ok", "OK")):
            box = self._paint(tk.Frame(row), bg="panel")
            box.pack(side="right", padx=10)
            num = self.label(box, "–", "panel", role, self.f["h2"])
            num.pack()
            self.label(box, text, "panel", "muted", self.f["small"]).pack()
            self.badges[key] = num

        frame, self.check_tree = self._make_tree(tab, 10)
        frame.pack(fill="both", expand=True)
        self._set_table(self.check_tree, ["Abschnitt", "Query", "Status", "Details"], [],
                        [120, 220, 100, 480])
        self.check_tree.bind("<Double-1>", self._check_to_tester)

    def _check_to_tester(self, _event=None):
        """Doppelklick auf eine Zeile im Query-Check öffnet die Query im Tester."""
        sel = self.check_tree.selection()
        if not sel:
            return
        values = self.check_tree.item(sel[0], "values")
        key = f"{values[0]}.{values[1]}"
        self._fill_query_list()
        if key in self._queries:
            self.query_pick.set(key)
            self._pick_query()
            self.notebook.select(3)

    def _build_tester_tab(self):
        tab = self.page("Query-Tester", "Query aus der Config wählen oder eintippen. Parameter für «?» "
                                        "kommagetrennt eintragen. Tipp: Doppelklick im Query-Check.")
        tester = self.card(tab)
        tester.pack(fill="both", expand=True)
        row = self._paint(tk.Frame(tester.inner), bg="panel")
        row.pack(fill="x")
        self.label(row, "Aus Config", "panel", "muted", self.f["small"]).pack(side="left")
        self.query_pick = ttk.Combobox(row, state="readonly", width=46)
        self.query_pick.pack(side="left", padx=8)
        self.query_pick.bind("<<ComboboxSelected>>", self._pick_query)
        ttk.Button(row, text="↻", width=3, command=self._fill_query_list).pack(side="left")
        frame, self.query_input = self.text_widget(tester.inner, height=6, wrap="word")
        frame.pack(fill="x", pady=10)
        row = self._paint(tk.Frame(tester.inner), bg="panel")
        row.pack(fill="x", pady=(0, 8))
        self.label(row, "Parameter", "panel", "muted", self.f["small"]).pack(side="left")
        self.param_entry = ttk.Entry(row, width=34)
        self.param_entry.pack(side="left", padx=8)
        ttk.Button(row, text="▶  Ausführen", style="Accent.TButton", command=self.run_tester).pack(side="left")
        self.tester_lbl = self.label(row, "", "panel", "muted", self.f["base"])
        self.tester_lbl.pack(side="left", padx=12)
        frame, self.result_tree = self._make_tree(tester.inner, 10)
        frame.pack(fill="both", expand=True)
        self._fill_query_list()

    def _build_log_tab(self):
        self.log_tab = self.page("Protokoll", "Alle Meldungen des Webservers und des Panels, live.")
        tab = self.log_tab
        bar = ttk.Frame(tab)
        bar.pack(fill="x", pady=(0, 10))
        self.label(bar, "Anzeige", "bg", "muted", self.f["small"]).pack(side="left")
        self.log_filter = ttk.Combobox(bar, width=24, state="readonly",
                                       values=["Alles", "Warnungen und Fehler", "Nur Fehler"])
        self.log_filter.current(0)
        self.log_filter.pack(side="left", padx=8)
        self.log_filter.bind("<<ComboboxSelected>>", lambda e: self._rerender_log())
        ttk.Button(bar, text="Leeren", command=self._clear_log).pack(side="right", padx=(6, 0))
        ttk.Button(bar, text="Kopieren", command=self._copy_log).pack(side="right")
        frame, self.log_text = self.text_widget(tab, wrap="word", state="disabled")
        frame.pack(fill="both", expand=True)

    def _build_system_tab(self):
        tab = self.page("System", "Python, Module und Pfade. Hilfreich, wenn etwas nicht startet.")
        bar = ttk.Frame(tab)
        bar.pack(fill="x", pady=(0, 10))
        ttk.Button(bar, text="↻  Aktualisieren", command=self._update_system).pack(side="left")
        ttk.Button(bar, text="Installationsbefehl kopieren", command=self._copy_install).pack(side="left", padx=6)
        cols = ttk.Frame(tab)
        cols.pack(fill="x")
        cols.columnconfigure(0, weight=1, uniform="sys")
        cols.columnconfigure(1, weight=1, uniform="sys")
        self.sys_info = self.card(cols, "Umgebung")
        self.sys_info.grid(row=0, column=0, sticky="nsew", padx=(0, 6))
        self.sys_mods = self.card(cols, "Python-Module")
        self.sys_mods.grid(row=0, column=1, sticky="nsew", padx=(6, 0))
        self.sys_help = self.card(tab, "Fehlende Module installieren")
        self.sys_help.pack(fill="x", pady=(12, 0))
        self._sys_widgets = []
        self._update_system()
        self._color_tags()

    def _bind_keys(self):
        self.root.bind_all("<Control-s>", lambda e: self.save_config())
        if IS_MAC:
            self.root.bind_all("<Command-s>", lambda e: self.save_config())
        for i in range(len(self.NAV)):
            self.root.bind_all(f"<Alt-Key-{i + 1}>", lambda e, idx=i: self.notebook.select(idx))


    # ------------------------------------------------------------------
    # Hintergrundarbeit und Hauptschleife
    # ------------------------------------------------------------------

    def bg(self, work, done):
        """work() läuft in einem Thread, done(ergebnis, fehler) im Tk-Hauptthread."""
        def runner():
            try:
                res = (work(), None)
            except Exception as exc:
                res = (None, exc)
            self.ui_q.put(lambda: done(*res))
        threading.Thread(target=runner, daemon=True).start()

    def _tick(self):
        try:
            while True:
                try:
                    self.ui_q.get_nowait()()
                except queue.Empty:
                    break
                except Exception as exc:  # ein Fehler darf die Schleife nie stoppen
                    self.log(f"Interner Fehler: {exc}", "ERROR")
            while True:
                try:
                    line, level = self.log_q.get_nowait()
                except queue.Empty:
                    break
                self._append_log(line, level)
            self._check_proc()
        finally:
            self.root.after(200, self._tick)

    # ------------------------------------------------------------------
    # Protokoll
    # ------------------------------------------------------------------

    def log(self, message: str, level: str = "PANEL"):
        stamp = datetime.now().strftime("%H:%M:%S")
        self.log_q.put((f"[{stamp}] {message}", level))

    def _passes(self, level: str) -> bool:
        sel = self.log_filter.get()
        if sel == "Alles":
            return True
        if sel == "Nur Fehler":
            return level in ("ERROR", "PANEL")
        return level in ("WARNING", "ERROR", "PANEL")

    def _append_log(self, line: str, level: str):
        self.log_lines.append((line, level))
        if self._passes(level):
            self._write_log(line, level)

    def _write_log(self, line: str, level: str):
        at_end = self.log_text.yview()[1] >= 0.99
        self.log_text.configure(state="normal")
        self.log_text.insert("end", line + "\n", level)
        if int(self.log_text.index("end-1c").split(".")[0]) > 3000:
            self.log_text.delete("1.0", "500.0")
        self.log_text.configure(state="disabled")
        if at_end:
            self.log_text.see("end")

    def _rerender_log(self):
        self.log_text.configure(state="normal")
        self.log_text.delete("1.0", "end")
        self.log_text.configure(state="disabled")
        for line, level in self.log_lines:
            if self._passes(level):
                self._write_log(line, level)

    def _clear_log(self):
        self.log_lines.clear()
        self._rerender_log()

    def _copy_log(self):
        self.root.clipboard_clear()
        self.root.clipboard_append("\n".join(l for l, _ in self.log_lines))
        self.statusbar.config(text="Protokoll in die Zwischenablage kopiert.")

    # ------------------------------------------------------------------
    # Konfiguration
    # ------------------------------------------------------------------

    def _load_editor(self):
        try:
            text = self.cfg_path.read_text(encoding="utf-8")
            note = f"Config geladen: {self.cfg_path}"
        except OSError:
            text = DEFAULT_CONFIG
            note = f"Config nicht gefunden. Vorlage geladen, Speichern legt {self.cfg_path.name} an."
        self.editor.delete("1.0", "end")
        self.editor.insert("1.0", text)
        self.editor.edit_reset()
        self.editor.edit_modified(False)
        self._set_dirty(False)
        self._highlight()
        self._show_cfg_path()
        self.statusbar.config(text=note)

    def _show_cfg_path(self):
        local = self.cfg_path.name == db.LOCAL_CONFIG_NAME
        self.cfg_name_lbl.config(text=f"{'🔒 Persönliche Kopie · ' if local else ''}{self.cfg_path}")
        for lbl, path in self.path_labels:
            lbl.config(text=path())

    def _reload_editor(self):
        if self.dirty and not messagebox.askyesno(
                "Verwerfen?", "Ungespeicherte Änderungen gehen verloren. Trotzdem neu laden?"):
            return
        self._load_editor()

    def _on_modified(self, _event=None):
        if self.editor.edit_modified():
            self._set_dirty(True)
            self.editor.edit_modified(False)

    def _set_dirty(self, dirty: bool):
        self.dirty = dirty
        self.dirty_lbl.config(text="● Ungespeicherte Änderungen" if dirty else "✓ Gespeichert",
                              fg=self.c["warn"] if dirty else self.c["ok"])

    def _editor_cfg(self, show_error=True):
        try:
            return db.parse_config_text(self.editor.get("1.0", "end-1c"))
        except db.ConfigError as exc:
            if show_error:
                messagebox.showerror("Konfiguration ungültig", str(exc))
                self.notebook.select(1)
            return None

    def validate_yaml(self):
        if self._editor_cfg() is not None:
            messagebox.showinfo("Konfiguration", "YAML ist gültig.")

    def save_config(self) -> bool:
        if self._editor_cfg() is None:
            return False
        text = self.editor.get("1.0", "end-1c").rstrip() + "\n"
        try:
            with open(self.cfg_path, "w", encoding="utf-8", newline="\n") as fh:
                fh.write(text)
        except OSError as exc:
            messagebox.showerror("Fehler", f"Speichern fehlgeschlagen:\n{exc}")
            return False
        self._set_dirty(False)
        self.statusbar.config(text=f"Gespeichert: {self.cfg_path}")
        self.log("Konfiguration gespeichert.", "PANEL")
        return True

    def make_local_copy(self):
        """Config als durchblick.conf.local.yml speichern (wird von Git ignoriert)."""
        target = APP_DIR / db.LOCAL_CONFIG_NAME
        if self.cfg_path == target:
            messagebox.showinfo("Persönliche Kopie", f"Du arbeitest bereits mit {target.name}.")
            return
        if os.environ.get("DURCHBLICK_CONFIG"):
            messagebox.showwarning("Persönliche Kopie",
                                   "DURCHBLICK_CONFIG ist gesetzt. Die Kopie würde nicht verwendet.")
            return
        if target.exists() and not messagebox.askyesno(
                "Überschreiben?", f"{target.name} existiert bereits. Überschreiben?"):
            return
        if self._editor_cfg() is None:
            return
        try:
            with open(target, "w", encoding="utf-8", newline="\n") as fh:
                fh.write(self.editor.get("1.0", "end-1c").rstrip() + "\n")
        except OSError as exc:
            messagebox.showerror("Fehler", f"Speichern fehlgeschlagen:\n{exc}")
            return
        self.cfg_path = target
        self._set_dirty(False)
        self._show_cfg_path()
        self.log(f"Persönliche Kopie angelegt: {target}", "PANEL")
        messagebox.showinfo("Persönliche Kopie",
                            f"Gespeichert als {target.name}.\n\nAb jetzt wird diese Datei verwendet. "
                            "Trage dein echtes Passwort nur hier ein. Die Datei wird von Git ignoriert.\n\n"
                            "Läuft der Webserver, bitte neu starten.")

    def _port(self) -> int:
        cfg = self._editor_cfg(show_error=False) or {}
        try:
            return int((cfg.get("app") or {}).get("port") or 3000)
        except (TypeError, ValueError):
            return 3000

    # ------------------------------------------------------------------
    # Server-Steuerung
    # ------------------------------------------------------------------

    def start(self):
        if self.proc is not None:
            return
        if self.dirty and not self.save_config():
            return
        if self._editor_cfg() is None:
            return
        port = self._port()
        if port_in_use(port):
            messagebox.showerror("Port belegt",
                                 f"Port {port} wird bereits verwendet.\n"
                                 "Anderen Port in der Config unter «app: port:» eintragen "
                                 "oder das andere Programm beenden.")
            return
        env = dict(os.environ, DURCHBLICK_CONFIG=str(self.cfg_path), PYTHONIOENCODING="utf-8")
        kwargs = {}
        if sys.platform == "win32":
            kwargs["creationflags"] = subprocess.CREATE_NO_WINDOW
        try:
            self.proc = subprocess.Popen(
                [sys.executable, "-u", str(WEB_SCRIPT)], cwd=str(APP_DIR), env=env,
                stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True,
                encoding="utf-8", errors="replace", bufsize=1, **kwargs)
        except OSError as exc:
            messagebox.showerror("Fehler", f"Webserver konnte nicht gestartet werden:\n{exc}")
            return
        self.run_port = port
        self.stopping = False
        threading.Thread(target=self._reader, args=(self.proc,), daemon=True).start()
        self.log(f"Webserver gestartet (Port {port}).", "PANEL")
        self._refresh_status()
        if self.auto_open.get():
            self._open_when_ready(time.time() + 15)

    def _reader(self, proc):
        for line in proc.stdout:
            line = line.rstrip()
            if line:
                stamp = datetime.now().strftime("%H:%M:%S")
                self.log_q.put((f"[{stamp}] {line}", level_of(line)))

    def stop(self):
        p = self.proc
        if p is None or self.stopping:
            return
        self.stopping = True
        self.log("Stoppe Webserver …", "PANEL")
        try:
            p.terminate()
        except OSError:
            pass

        def killer():
            try:
                p.wait(timeout=5)
            except subprocess.TimeoutExpired:
                try:
                    p.kill()
                except OSError:
                    pass
        threading.Thread(target=killer, daemon=True).start()
        self._refresh_status()

    def restart(self):
        self.stop()
        self._restart_when_stopped()

    def _restart_when_stopped(self):
        if self.proc is None:
            self.start()
        else:
            self.root.after(200, self._restart_when_stopped)

    def _check_proc(self):
        p = self.proc
        if p is not None and p.poll() is not None:
            self.proc = None
            if self.stopping:
                self.log("Webserver gestoppt.", "PANEL")
            else:
                self.log(f"Webserver unerwartet beendet (Exit-Code {p.returncode}). "
                         "Ursache steht in den Zeilen darüber.", "ERROR")
                self.notebook.select(self.log_tab)
            self.stopping = False
            self._refresh_status()

    def _open_when_ready(self, deadline):
        if self.proc is None:
            return
        if port_in_use(self.run_port):
            self.open_browser()
        elif time.time() < deadline:
            self.root.after(400, lambda: self._open_when_ready(deadline))

    def open_browser(self, page: str = ""):
        if self.proc is None:
            messagebox.showinfo("Hinweis", "Der Webserver läuft noch nicht. Zuerst oben auf «Starten» klicken.")
            return
        # 127.0.0.1 statt «localhost»: vermeidet Verzögerungen durch IPv6 (besonders unter Windows)
        webbrowser.open(f"http://127.0.0.1:{self.run_port}/" + (f"#{page}" if page else ""))

    def _refresh_status(self):
        running = self.proc is not None
        if running and self.stopping:
            text, color = "Stoppt …", self.c["warn"]
        elif running:
            text, color = "Läuft", self.c["ok"]
        else:
            text, color = "Gestoppt", self.c["err"]
        self.dot.config(foreground=color)
        self.status_lbl.config(text=text)
        self.url_lbl.config(text=f"127.0.0.1:{self.run_port}  ↗" if running else "Server aus")
        self.url_lbl.config(fg=self.c["accent2"] if running else self.c["muted"],
                            cursor="hand2" if running else "")
        if hasattr(self, "btn_start_step"):
            self.btn_start_step.config(text="↗  Im Browser öffnen" if running else "▶  Starten")
        idle = not running
        self.btn_start.config(state="normal" if idle else "disabled")
        self.btn_stop.config(state="normal" if running and not self.stopping else "disabled")
        self.btn_restart.config(state="normal" if running and not self.stopping else "disabled")
        self.btn_browser.config(state="normal" if running and not self.stopping else "disabled")

    # ------------------------------------------------------------------
    # Prüfen
    # ------------------------------------------------------------------

    def test_connection(self):
        cfg = self._editor_cfg()
        if cfg is None:
            return
        self.conn_lbl.config(text="Teste …", fg=self.c["muted"])

        def work():
            conn, drv = db.connect(cfg)
            conn.close()
            return drv

        def done(drv, exc):
            if exc:
                self.conn_lbl.config(text=f"✖  Fehlgeschlagen: {str(exc).splitlines()[0][:160]}",
                                     fg=self.c["err"])
                self.log(f"Verbindung fehlgeschlagen: {exc}", "ERROR")
            else:
                self.conn_lbl.config(text=f"✔  Verbunden (Treiber: {drv})", fg=self.c["ok"])
                self.log("Verbindung erfolgreich.", "PANEL")
        self.bg(work, done)

    def check_all(self):
        cfg = self._editor_cfg()
        if cfg is None:
            return
        self._set_table(self.check_tree, ["Abschnitt", "Query", "Status", "Details"],
                        [(["", "Prüfe …", "", ""], "")], [120, 220, 100, 480])
        for b in self.badges.values():
            b.config(text="…")

        def done(results, exc):
            cols = ["Abschnitt", "Query", "Status", "Details"]
            if exc:
                self._set_table(self.check_tree, cols,
                                [(["–", "Verbindung", "Fehler", str(exc).splitlines()[0][:200]], "Fehler")],
                                [120, 220, 100, 480])
                for key, val in (("ok", "–"), ("warn", "–"), ("bad", "1")):
                    self.badges[key].config(text=val)
                return
            rows = [(list(r), r[2]) for r in results]
            self._set_table(self.check_tree, cols, rows, [120, 220, 100, 480])
            ok = sum(1 for r in results if r[2] == "OK")
            bad = sum(1 for r in results if r[2] == "Fehler")
            warn = sum(1 for r in results if r[2] in ("Leer", "Hinweis"))
            for key, val in (("ok", ok), ("warn", warn), ("bad", bad)):
                self.badges[key].config(text=str(val))
            self.statusbar.config(text=f"Query-Check: {ok} OK, {bad} Fehler, {len(results)} gesamt.")
        self.bg(lambda: db.check_queries(cfg), done)

    def _fill_query_list(self):
        cfg = self._editor_cfg(show_error=False) or {}
        self._queries = {f"{s}.{k}": sql for s, k, sql in db.iter_queries(cfg)}
        self.query_pick["values"] = list(self._queries)

    def _pick_query(self, _event=None):
        sql = self._queries.get(self.query_pick.get(), "")
        self.query_input.delete("1.0", "end")
        self.query_input.insert("1.0", sql)
        n = sql.count("?")
        self.param_entry.delete(0, "end")
        self.tester_lbl.config(text=f"{n} Parameter erwartet" if n else "")

    def run_tester(self):
        cfg = self._editor_cfg()
        if cfg is None:
            return
        sql = self.query_input.get("1.0", "end").strip()
        if not sql:
            messagebox.showwarning("Hinweis", "Bitte zuerst eine Query eingeben oder auswählen.")
            return
        write = db.is_write(sql)
        if write and not messagebox.askyesno(
                "Schreibende Query", "Diese Query verändert Daten.\nWirklich ausführen?"):
            return
        params = parse_params(self.param_entry.get())
        self.tester_lbl.config(text="Läuft …")

        def work():
            conn_drv = db.connect(cfg)
            try:
                return db.run_query(sql, params, conn_drv, commit=write)
            finally:
                conn_drv[0].close()

        def done(res, exc):
            if exc:
                self._set_table(self.result_tree, ["Fehler"], [[str(exc)[:500]]], [800])
                self.tester_lbl.config(text="Fehler")
                self.log(f"Query-Fehler: {exc}", "ERROR")
                return
            cols, rows = res
            shown = [[db.to_text(v)[:300] for v in r] for r in rows[:200]]
            self._set_table(self.result_tree, cols or ["(kein Ergebnis)"], shown)
            more = f" (erste 200 von {len(rows)} angezeigt)" if len(rows) > 200 else ""
            self.tester_lbl.config(text=f"{len(rows)} Zeile(n){more}")
        self.bg(work, done)

    # ------------------------------------------------------------------
    # System
    # ------------------------------------------------------------------

    def _update_system(self):
        def check(mod):
            return importlib.util.find_spec(mod) is not None
        for w in self._sys_widgets:
            w.destroy()
        self._sys_widgets = []
        self._painted = [(w, r) for w, r in self._painted
                         if not isinstance(w, tk.Misc) or w.winfo_exists()]

        def row(parent, key, value, value_role="text", key_width=16):
            r = self._paint(tk.Frame(parent), bg="panel")
            r.pack(fill="x", pady=3)
            self.label(r, key, "panel", "muted", self.f["base"], width=key_width, anchor="w").pack(side="left")
            self.label(r, value, "panel", value_role, self.f["base"], anchor="w", justify="left",
                       wraplength=330).pack(side="left", fill="x")
            self._sys_widgets.append(r)

        info = self.sys_info.inner
        row(info, "Betriebssystem", f"{platform.system()} {platform.release()}")
        row(info, "Python", f"{platform.python_version()}")
        row(info, "Interpreter", sys.executable, "muted")
        row(info, "Tk-Version", str(tk.TkVersion))
        row(info, "Programmordner", str(APP_DIR), "muted")
        row(info, "Config", str(self.cfg_path), "muted")

        deps = [
            ("fastapi", "fastapi", "Pflicht"), ("uvicorn", "uvicorn", "Pflicht"),
            ("PyYAML", "yaml", "Pflicht"),
            ("pymysql", "pymysql", "MySQL / MariaDB"),
            ("psycopg2", "psycopg2", "PostgreSQL"),
            ("pyodbc", "pyodbc", "ODBC"),
            ("sqlite3", "sqlite3", "SQLite (in Python enthalten)"),
        ]
        for name, mod, note in deps:
            ok = check(mod)
            required = note == "Pflicht"
            r = self._paint(tk.Frame(self.sys_mods.inner), bg="panel")
            r.pack(fill="x", pady=3)
            self.label(r, "✔" if ok else ("✖" if required else "–"), "panel",
                       "ok" if ok else ("err" if required else "muted"), self.f["bold"], width=2).pack(side="left")
            self.label(r, name, "panel", "text", self.f["bold"], width=10, anchor="w").pack(side="left")
            self.label(r, note if ok or not required else note + " · fehlt!", "panel",
                       "muted" if ok or not required else "err", self.f["base"], anchor="w").pack(side="left")
            self._sys_widgets.append(r)

        lines = [INSTALL_CMD]
        if platform.system() == "Linux":
            lines += ["", "Ubuntu meldet «externally-managed-environment»? Dann zuerst:",
                      "python3 -m venv .venv && source .venv/bin/activate"]
        lbl = self.label(self.sys_help.inner, "\n".join(lines), "panel", "text", self.f["mono"],
                         anchor="w", justify="left")
        lbl.pack(fill="x")
        self._sys_widgets.append(lbl)

    def _copy_install(self):
        self.root.clipboard_clear()
        self.root.clipboard_append(INSTALL_CMD)
        self.statusbar.config(text="Installationsbefehl kopiert.")

    # ------------------------------------------------------------------
    # Beenden
    # ------------------------------------------------------------------

    def on_closing(self):
        if self.dirty and not messagebox.askyesno(
                "Beenden", "Es gibt ungespeicherte Änderungen in der Konfiguration.\nTrotzdem beenden?"):
            return
        if self.proc is not None:
            if not messagebox.askyesno("Beenden", "Der Webserver läuft noch. Trotzdem beenden?"):
                return
            try:
                self.proc.terminate()
            except OSError:
                pass
        self.root.destroy()


def main():
    enable_hidpi()
    root = tk.Tk()
    if db is None:
        root.withdraw()
        messagebox.showerror("Modul fehlt",
                             f"Ein benötigtes Python-Modul fehlt: {IMPORT_ERROR.name}\n\n"
                             f"Bitte im Programmordner ausführen:\n{INSTALL_CMD}")
        return
    panel = Panel(root)
    root.protocol("WM_DELETE_WINDOW", panel.on_closing)
    root.mainloop()


if __name__ == "__main__":
    main()
