# -*- mode: python ; coding: utf-8 -*-
# PyInstaller-Bauplan für Durchblick (Windows, macOS, Linux)
# Aufruf im Programmordner:  pyinstaller installer/durchblick.spec --noconfirm
# Ergebnis: dist/Durchblick/  mit  Durchblick(.exe)  und  durchblick-server(.exe)

import sys
from pathlib import Path
from PyInstaller.utils.hooks import collect_submodules

ROOT = Path(SPECPATH).parent
ICON = str(ROOT / "installer" / ("durchblick.ico" if sys.platform == "win32" else "durchblick.png"))

datas = [
    (str(ROOT / "web"), "web"),
    (str(ROOT / "docs"), "docs"),
    (str(ROOT / "theme"), "theme"),
    (str(ROOT / "durchblick.conf.yml"), "."),
    (str(ROOT / "LICENSE"), "."),
    (str(ROOT / "installer" / "durchblick.png"), "installer"),
]
# uvicorn lädt Teile dynamisch, darum alles mitnehmen
hidden = collect_submodules("uvicorn") + ["pymysql", "psycopg2", "pyodbc", "sqlite3", "yaml"]
excludes = ["matplotlib", "numpy", "pandas", "PIL", "pytest", "IPython"]

panel_a = Analysis([str(ROOT / "durchblick_panel.py")], pathex=[str(ROOT)], datas=datas,
                   hiddenimports=hidden, excludes=excludes)
server_a = Analysis([str(ROOT / "durchblick_web.py")], pathex=[str(ROOT)], datas=[],
                    hiddenimports=hidden, excludes=excludes + ["tkinter"])
MERGE((panel_a, "durchblick_panel", "Durchblick"), (server_a, "durchblick_web", "durchblick-server"))

panel_exe = EXE(PYZ(panel_a.pure), panel_a.scripts, [], exclude_binaries=True, name="Durchblick",
                console=False, icon=ICON, upx=False)
server_exe = EXE(PYZ(server_a.pure), server_a.scripts, [], exclude_binaries=True, name="durchblick-server",
                 console=True, icon=ICON, upx=False)

coll = COLLECT(panel_exe, panel_a.binaries, panel_a.datas,
               server_exe, server_a.binaries, server_a.datas,
               name="Durchblick", upx=False)
