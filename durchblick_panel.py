#!/usr/bin/env python3
"""
Durchblick Control Panel - Verwaltungsoberfläche für die Durchblick-Weboberfläche
Plattformen: Windows, Ubuntu/Linux, macOS     Python: 3.9+

Der Webserver läuft als eigener Prozess (durchblick_web.py). Dadurch gilt:
- Config-Änderungen werden ohne Neustart übernommen
- Die Logs des Servers erscheinen live im Reiter «Protokoll»
- Ein Absturz des Servers reisst das Panel nicht mit

Voraussetzungen (einmalig):
    Ubuntu:   sudo apt install python3-tk python3-venv
    macOS:    Python von python.org installieren (enthält Tk)
    Windows:  Python von python.org installieren (enthält Tk)
    Alle:     python -m pip install -r requirements.txt

Start:  python durchblick_panel.py
"""

import importlib.util
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
from tkinter import messagebox, scrolledtext, ttk
from tkinter import font as tkfont

try:
    import durchblick_db as db
    IMPORT_ERROR = None
except ModuleNotFoundError as exc:  # z. B. PyYAML fehlt
    db = None
    IMPORT_ERROR = exc

APP_VERSION = "1.1"
APP_DIR = Path(__file__).resolve().parent
WEB_SCRIPT = APP_DIR / "durchblick_web.py"
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

START_TEXT = f"""So gehst du vor:

  1.  Reiter «Konfiguration»: Verbindung (DSN, Benutzer, Passwort) und Queries anpassen
       und speichern ({SAVE_KEY}).
  2.  Reiter «Prüfen»: «Verbindung testen» und «Alle Queries prüfen» ausführen.
       Fehler stehen direkt in der Tabelle.
  3.  Oben auf «Starten» klicken. Die Weboberfläche öffnet sich im Browser.
  4.  Erscheinen in der Weboberfläche noch Emojis, ist die zugehörige Query noch nicht
       korrekt. Ein Mauszeiger über dem Emoji zeigt die Fehlermeldung.

Gut zu wissen:
  •  Config-Änderungen gelten sofort. Ein Neustart des Servers ist nicht nötig.
  •  Das Protokoll zeigt alle Meldungen des Servers (Reiter «Protokoll»).
  •  Der Port kann in der Config unter «app: port:» geändert werden."""


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


# ----------------------------------------------------------------------------
# Hauptfenster
# ----------------------------------------------------------------------------

class Panel:

    def __init__(self, root: tk.Tk):
        self.root = root
        root.title(f"Durchblick Control Panel v{APP_VERSION}")
        root.geometry("1020x760")
        root.minsize(880, 620)

        self.cfg_path = db.config_path()
        self.proc = None
        self.run_port = 3000
        self.stopping = False
        self.log_q = queue.Queue()
        self.ui_q = queue.Queue()
        self.log_lines = deque(maxlen=3000)
        self.auto_open = tk.BooleanVar(value=True)
        self.dirty = False

        self.fixed = tkfont.nametofont("TkFixedFont")
        self.big = tkfont.nametofont("TkDefaultFont").copy()
        self.big.configure(size=self.big.cget("size") + 4, weight="bold")

        self._style()
        self._build_header()
        self.notebook = ttk.Notebook(root)
        self.notebook.pack(fill="both", expand=True, padx=10, pady=(0, 6))
        self._build_start_tab()
        self._build_config_tab()
        self._build_check_tab()
        self._build_log_tab()
        self._build_system_tab()
        self.statusbar = ttk.Label(root, text="", relief="sunken", anchor="w", padding=(6, 2))
        self.statusbar.pack(fill="x", side="bottom")

        self._load_editor()
        self._refresh_status()
        self._bind_keys()
        self.log(f"Control Panel gestartet. Config: {self.cfg_path}", "INFO")
        self._tick()

    # ------------------------------------------------------------------
    # Aufbau
    # ------------------------------------------------------------------

    def _style(self):
        style = ttk.Style()
        if sys.platform.startswith("linux") and "clam" in style.theme_names():
            style.theme_use("clam")  # sieht unter Linux deutlich besser aus als «default»
        style.configure("Big.TButton", padding=(14, 7))

    def _build_header(self):
        head = ttk.Frame(self.root, padding=(12, 10))
        head.pack(fill="x")
        self.dot = ttk.Label(head, text="●", font=self.big)
        self.dot.pack(side="left")
        self.status_lbl = ttk.Label(head, text="", font=self.big)
        self.status_lbl.pack(side="left", padx=(6, 14))
        self.url_lbl = ttk.Label(head, text="", foreground="#1565c0", cursor="hand2")
        self.url_lbl.pack(side="left")
        self.url_lbl.bind("<Button-1>", lambda e: self.open_browser())

        right = ttk.Frame(head)
        right.pack(side="right")
        self.btn_start = ttk.Button(right, text="▶  Starten", style="Big.TButton", command=self.start)
        self.btn_stop = ttk.Button(right, text="■  Stoppen", style="Big.TButton", command=self.stop)
        self.btn_restart = ttk.Button(right, text="↻  Neustart", style="Big.TButton", command=self.restart)
        self.btn_browser = ttk.Button(right, text="Im Browser öffnen", style="Big.TButton",
                                      command=self.open_browser)
        for b in (self.btn_start, self.btn_stop, self.btn_restart, self.btn_browser):
            b.pack(side="left", padx=3)
        ttk.Separator(self.root).pack(fill="x")

    def _build_start_tab(self):
        tab = ttk.Frame(self.notebook, padding=16)
        self.notebook.add(tab, text="Start")
        ttk.Label(tab, text=START_TEXT, justify="left").pack(anchor="w")
        ttk.Checkbutton(tab, text="Browser nach dem Start automatisch öffnen",
                        variable=self.auto_open).pack(anchor="w", pady=(18, 4))
        row = ttk.Frame(tab)
        row.pack(anchor="w", pady=4)
        ttk.Label(row, text=f"Konfigurationsdatei: {self.cfg_path}").pack(side="left")
        ttk.Button(row, text="Ordner öffnen",
                   command=lambda: open_folder(self.cfg_path.parent)).pack(side="left", padx=10)

    def _build_config_tab(self):
        tab = ttk.Frame(self.notebook, padding=8)
        self.notebook.add(tab, text="Konfiguration")
        bar = ttk.Frame(tab)
        bar.pack(fill="x", pady=(0, 6))
        ttk.Button(bar, text=f"Speichern ({SAVE_KEY})", command=self.save_config).pack(side="left", padx=2)
        ttk.Button(bar, text="YAML prüfen", command=self.validate_yaml).pack(side="left", padx=2)
        ttk.Button(bar, text="Von Datei neu laden", command=self._reload_editor).pack(side="left", padx=2)
        self.dirty_lbl = ttk.Label(bar, text="")
        self.dirty_lbl.pack(side="right", padx=6)
        self.editor = scrolledtext.ScrolledText(tab, wrap="word", font=self.fixed, undo=True)
        self.editor.pack(fill="both", expand=True)
        self.editor.bind("<<Modified>>", self._on_modified)

    def _make_tree(self, parent, height):
        frame = ttk.Frame(parent)
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
            tree.heading(cid, text=cols[i] if cols else "")
            tree.column(cid, width=(widths[i] if widths else 130), minwidth=60, stretch=True)
        for row in rows:
            # Zeile = Liste von Werten oder (Liste, Tag) für farbige Darstellung
            values, tag = row if isinstance(row, tuple) else (row, "")
            tree.insert("", "end", values=values, tags=(tag,) if tag else ())

    def _build_check_tab(self):
        tab = ttk.Frame(self.notebook, padding=8)
        self.notebook.add(tab, text="Prüfen")

        box = ttk.LabelFrame(tab, text="1. Verbindung", padding=8)
        box.pack(fill="x", pady=(0, 8))
        ttk.Button(box, text="Verbindung testen", command=self.test_connection).pack(side="left")
        self.conn_lbl = ttk.Label(box, text="Noch nicht getestet.")
        self.conn_lbl.pack(side="left", padx=14)

        box = ttk.LabelFrame(tab, text="2. Alle Queries der Config prüfen "
                                       "(schreibende Queries werden nie ausgeführt)", padding=8)
        box.pack(fill="both", expand=True, pady=(0, 8))
        ttk.Button(box, text="Alle Queries prüfen", command=self.check_all).pack(anchor="w", pady=(0, 6))
        frame, self.check_tree = self._make_tree(box, 8)
        frame.pack(fill="both", expand=True)
        self._set_table(self.check_tree, ["Abschnitt", "Query", "Status", "Details"], [],
                        [110, 210, 90, 500])
        self.check_tree.tag_configure("OK", foreground="#2e7d32")
        self.check_tree.tag_configure("Fehler", foreground="#c62828")
        self.check_tree.tag_configure("Leer", foreground="#ef6c00")
        self.check_tree.tag_configure("Hinweis", foreground="#ef6c00")

        box = ttk.LabelFrame(tab, text="3. Query-Tester (Parameter für «?» kommagetrennt eintragen)",
                             padding=8)
        box.pack(fill="both", expand=True)
        row = ttk.Frame(box)
        row.pack(fill="x")
        ttk.Label(row, text="Aus Config:").pack(side="left")
        self.query_pick = ttk.Combobox(row, state="readonly", width=44)
        self.query_pick.pack(side="left", padx=6)
        self.query_pick.bind("<<ComboboxSelected>>", self._pick_query)
        ttk.Button(row, text="Liste aktualisieren", command=self._fill_query_list).pack(side="left")
        self.query_input = tk.Text(box, height=3, font=self.fixed, wrap="word")
        self.query_input.pack(fill="x", pady=5)
        row = ttk.Frame(box)
        row.pack(fill="x", pady=(0, 5))
        ttk.Label(row, text="Parameter:").pack(side="left")
        self.param_entry = ttk.Entry(row, width=36)
        self.param_entry.pack(side="left", padx=6)
        ttk.Button(row, text="▶  Ausführen", command=self.run_tester).pack(side="left", padx=6)
        self.tester_lbl = ttk.Label(row, text="")
        self.tester_lbl.pack(side="left", padx=10)
        frame, self.result_tree = self._make_tree(box, 6)
        frame.pack(fill="both", expand=True)
        self._fill_query_list()

    def _build_log_tab(self):
        self.log_tab = ttk.Frame(self.notebook, padding=8)
        self.notebook.add(self.log_tab, text="Protokoll")
        bar = ttk.Frame(self.log_tab)
        bar.pack(fill="x", pady=(0, 6))
        ttk.Label(bar, text="Anzeige:").pack(side="left")
        self.log_filter = ttk.Combobox(bar, width=22, state="readonly",
                                       values=["Alles", "Warnungen und Fehler", "Nur Fehler"])
        self.log_filter.current(0)
        self.log_filter.pack(side="left", padx=6)
        self.log_filter.bind("<<ComboboxSelected>>", lambda e: self._rerender_log())
        ttk.Button(bar, text="Leeren", command=self._clear_log).pack(side="right", padx=2)
        ttk.Button(bar, text="Kopieren", command=self._copy_log).pack(side="right", padx=2)
        self.log_text = scrolledtext.ScrolledText(self.log_tab, wrap="word", font=self.fixed,
                                                  state="disabled")
        self.log_text.pack(fill="both", expand=True)
        self.log_text.tag_configure("INFO", foreground="#1565c0")
        self.log_text.tag_configure("WARNING", foreground="#e65100")
        self.log_text.tag_configure("ERROR", foreground="#b71c1c")
        self.log_text.tag_configure("PANEL", foreground="#2e7d32")

    def _build_system_tab(self):
        tab = ttk.Frame(self.notebook, padding=10)
        self.notebook.add(tab, text="System")
        bar = ttk.Frame(tab)
        bar.pack(fill="x", pady=(0, 6))
        ttk.Button(bar, text="Aktualisieren", command=self._update_system).pack(side="left")
        ttk.Button(bar, text="Installationsbefehl kopieren",
                   command=self._copy_install).pack(side="left", padx=8)
        self.sys_text = scrolledtext.ScrolledText(tab, wrap="word", font=self.fixed, height=18)
        self.sys_text.pack(fill="both", expand=True)
        self._update_system()

    def _bind_keys(self):
        self.root.bind_all("<Control-s>", lambda e: self.save_config())
        if IS_MAC:
            self.root.bind_all("<Command-s>", lambda e: self.save_config())

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
        self.statusbar.config(text=note)

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
        self.dirty_lbl.config(text="● Ungespeicherte Änderungen" if dirty else "Gespeichert",
                              foreground="#ef6c00" if dirty else "#2e7d32")

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

    def open_browser(self):
        if self.proc is None:
            messagebox.showinfo("Hinweis", "Der Webserver läuft noch nicht.")
            return
        # 127.0.0.1 statt «localhost»: vermeidet Verzögerungen durch IPv6 (besonders unter Windows)
        webbrowser.open(f"http://127.0.0.1:{self.run_port}")

    def _refresh_status(self):
        running = self.proc is not None
        if running and self.stopping:
            text, color = "Stoppt …", "#ef6c00"
        elif running:
            text, color = "Läuft", "#2e7d32"
        else:
            text, color = "Gestoppt", "#c62828"
        self.dot.config(foreground=color)
        self.status_lbl.config(text=text)
        self.url_lbl.config(text=f"http://127.0.0.1:{self.run_port}" if running else "")
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
        self.conn_lbl.config(text="Teste …", foreground="#555555")

        def work():
            conn, drv = db.connect(cfg)
            conn.close()
            return drv

        def done(drv, exc):
            if exc:
                self.conn_lbl.config(text=f"Fehlgeschlagen: {str(exc).splitlines()[0][:160]}",
                                     foreground="#c62828")
                self.log(f"Verbindung fehlgeschlagen: {exc}", "ERROR")
            else:
                self.conn_lbl.config(text=f"Verbunden (Treiber: {drv})", foreground="#2e7d32")
                self.log("Verbindung erfolgreich.", "PANEL")
        self.bg(work, done)

    def check_all(self):
        cfg = self._editor_cfg()
        if cfg is None:
            return
        self._set_table(self.check_tree, ["Abschnitt", "Query", "Status", "Details"],
                        [(["", "Prüfe …", "", ""], "")], [110, 210, 90, 500])

        def done(results, exc):
            cols = ["Abschnitt", "Query", "Status", "Details"]
            if exc:
                self._set_table(self.check_tree, cols,
                                [(["–", "Verbindung", "Fehler", str(exc).splitlines()[0][:200]], "Fehler")],
                                [110, 210, 90, 500])
                return
            rows = [(list(r), r[2]) for r in results]
            self._set_table(self.check_tree, cols, rows, [110, 210, 90, 500])
            ok = sum(1 for r in results if r[2] == "OK")
            bad = sum(1 for r in results if r[2] == "Fehler")
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
            return "ok" if importlib.util.find_spec(mod) else "FEHLT"
        deps = [
            ("fastapi", "fastapi", "Pflicht"), ("uvicorn", "uvicorn", "Pflicht"),
            ("PyYAML", "yaml", "Pflicht"),
            ("pymysql", "pymysql", "für MySQL / MariaDB"),
            ("psycopg2", "psycopg2", "für PostgreSQL"),
            ("pyodbc", "pyodbc", "für ODBC"),
            ("sqlite3", "sqlite3", "für SQLite (in Python enthalten)"),
        ]
        lines = [f"Betriebssystem : {platform.system()} {platform.release()}",
                 f"Python         : {platform.python_version()}  ({sys.executable})",
                 f"Tk-Version     : {tk.TkVersion}",
                 f"Programmordner : {APP_DIR}",
                 f"Config         : {self.cfg_path}", "", "Module:"]
        for name, mod, note in deps:
            lines.append(f"  {name:<10} {check(mod):<6} {note}")
        lines += ["", "Fehlende Module installieren (im Programmordner):", f"  {INSTALL_CMD}"]
        if platform.system() == "Linux":
            lines += ["",
                      "Ubuntu: Falls pip «externally-managed-environment» meldet, eine virtuelle",
                      "Umgebung verwenden:",
                      "  python3 -m venv .venv && source .venv/bin/activate",
                      "  python3 -m pip install -r requirements.txt"]
        self.sys_text.configure(state="normal")
        self.sys_text.delete("1.0", "end")
        self.sys_text.insert("1.0", "\n".join(lines))
        self.sys_text.configure(state="disabled")

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
