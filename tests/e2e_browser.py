#!/usr/bin/env python3
"""
Ende-zu-Ende-Test im echten Browser (optional, für Entwickler und Lehrpersonen).

Ablauf: Beispiel-Rohdaten erzeugen -> verkleinern -> CSV generieren -> CSV prüfen
-> CSV in SQLite importieren -> Galerie anzeigen. Legt Screenshots ab.

Voraussetzung:  python -m pip install playwright  &&  python -m playwright install chromium
                (oder vorhandenes Chrome über CHROME=/pfad/zu/chrome)
Start:          python tests/e2e_browser.py [screenshot-ordner]
"""

import os
import socket
import sys
import tempfile
import threading
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(Path(__file__).parent))

import helpers  # noqa: E402


def free_port() -> int:
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


def main():
    from playwright.sync_api import sync_playwright

    shots = Path(sys.argv[1] if len(sys.argv) > 1 else tempfile.mkdtemp(prefix="durchblick_e2e_"))
    shots.mkdir(parents=True, exist_ok=True)
    work = Path(tempfile.mkdtemp(prefix="durchblick_db_"))
    db_path = work / "m141.db"
    cfg = helpers.sqlite_config(db_path, (ROOT / "durchblick.conf.yml").read_text(encoding="utf-8"))
    port = free_port()
    cfg = cfg.replace("port: 3000", f"port: {port}")
    (work / "durchblick.conf.yml").write_text(cfg, encoding="utf-8")
    os.environ["DURCHBLICK_CONFIG"] = str(work / "durchblick.conf.yml")

    import uvicorn
    import durchblick_web
    server = uvicorn.Server(uvicorn.Config(durchblick_web.app, host="127.0.0.1", port=port, log_level="warning"))
    threading.Thread(target=server.run, daemon=True).start()
    while not server.started:
        time.sleep(0.05)
    url = f"http://127.0.0.1:{port}/"

    with sync_playwright() as p:
        kw = {"executable_path": os.environ["CHROME"]} if os.environ.get("CHROME") else {}
        browser = p.chromium.launch(**kw)
        page = browser.new_page(viewport={"width": 1280, "height": 900}, accept_downloads=True)
        errors = []
        page.on("console", lambda m: errors.append(m.text) if m.type == "error" else None)
        page.on("pageerror", lambda e: errors.append(str(e)))

        page.goto(url)
        page.screenshot(path=str(shots / "01_start.png"), full_page=True)

        # Schritt 1: Rohdaten
        page.goto(url + "#werkstatt:compress")
        page.click("#cmpDemo")
        page.wait_for_selector("#cmpPreview:not([hidden])", timeout=60000)
        page.screenshot(path=str(shots / "02_rohdaten.png"), full_page=True)
        page.click("#cmpRun")
        page.wait_for_selector("#cmpResultCard:not([hidden])", timeout=120000)
        saved = page.text_content("#cmpResSaved")
        before, after = page.text_content("#cmpResBefore"), page.text_content("#cmpResAfter")
        print(f"Rohdaten: {page.text_content('#cmpResFiles')} Dateien, {before} -> {after} ({saved} gespart)")
        page.screenshot(path=str(shots / "03_rohdaten_fertig.png"), full_page=True)
        with page.expect_download() as dl:
            page.click("#cmpDownload")
        zip_path = work / dl.value.suggested_filename
        dl.value.save_as(zip_path)

        # Schritt 2: CSV generieren
        page.click("#cmpToGenerator")
        page.wait_for_selector("#filePreview:not([hidden])")
        page.fill("#userName", "Anna Beispiel")
        page.select_option("#birthYear", "2008")
        page.select_option("#birthMonth", "3")
        page.select_option("#birthDay", "14")
        page.screenshot(path=str(shots / "04_generieren.png"), full_page=True)
        page.click("#generateBtn")
        page.wait_for_selector("#resultCard:not([hidden])", timeout=120000)
        with page.expect_download() as dl:
            page.click("#downloadBtn")
        csv_path = work / dl.value.suggested_filename
        dl.value.save_as(csv_path)

        # Schritt 3: prüfen
        page.click("#checkGeneratedBtn")
        page.wait_for_selector("#checkResultCard:not([hidden])", timeout=120000)
        title = page.text_content("#bannerTitle")
        print("CSV-Prüfung:", title, "| Fehler:", page.text_content("#crErrors"))
        page.screenshot(path=str(shots / "05_pruefen.png"), full_page=True)
        assert page.text_content("#crErrors") == "0", "CSV hat Fehler"

        # Import und Galerie
        helpers.import_csv(csv_path.read_text(encoding="utf-8-sig"), db_path)
        page.goto(url + "#gallery")
        page.wait_for_selector(".gallery-item img", timeout=20000)
        page.wait_for_timeout(800)
        n = page.locator(".gallery-item").count()
        print("Galerie:", n, "Bilder")
        page.screenshot(path=str(shots / "06_galerie.png"), full_page=True)
        page.locator(".gallery-item").first.click()
        page.wait_for_selector(".dialog .preview-img")
        page.screenshot(path=str(shots / "07_dialog.png"))
        page.keyboard.press("Escape")

        page.goto(url + "#overview")
        page.wait_for_timeout(600)
        page.screenshot(path=str(shots / "08_uebersicht.png"), full_page=True)

        # Design-Vorlagen
        for theme in ["hell", "arcade", "terminal", "alpen"]:
            page.goto(url + "#design")
            page.click(f".theme-btn[data-theme={theme}]")
            page.goto(url + "#gallery")
            page.wait_for_timeout(700)
            page.screenshot(path=str(shots / f"09_theme_{theme}.png"))
        page.goto(url + "#design")
        page.click(".theme-btn[data-theme=standard]")
        page.click("#css-example")
        page.wait_for_timeout(400)
        page.screenshot(path=str(shots / "10_design.png"), full_page=True)
        page.goto(url + "#hilfe")
        page.screenshot(path=str(shots / "11_hilfe.png"), full_page=True)

        browser.close()
    server.should_exit = True
    bad = [e for e in errors if "favicon" not in e]
    print("Konsolenfehler:", bad or "keine")
    print("Screenshots:", shots)
    assert n >= 20, "zu wenige Bilder in der Galerie"
    assert not bad
    print("E2E: OK")


if __name__ == "__main__":
    main()
