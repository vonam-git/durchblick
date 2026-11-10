#!/usr/bin/env python3
"""
Durchblick - Datenbank-Weboberfläche mit Werkstatt
Version: 2.0
Laufzeit: Python 3.9+

Installation:   python -m pip install -r requirements.txt
Start:          python durchblick_web.py      (oder über durchblick_panel.py)

Alle SQL-Queries und Verbindungsdaten stehen NUR in durchblick.conf.yml.
Die Config wird bei jeder Anfrage auf Änderungen geprüft. Ein Neustart
nach dem Speichern ist nicht nötig.

Ordner:
  web/     Weboberfläche (HTML, CSS, JavaScript) - nicht verändern
  theme/   Eigene Gestaltung der Lernenden (eigenes.css, Bilder, Schriften)
"""

import logging
import re
import sys
from typing import Optional
from urllib.parse import urlsplit

from fastapi import Body, FastAPI, Path as PathParam, Query, Request
from fastapi.responses import FileResponse, JSONResponse, Response
from fastapi.staticfiles import StaticFiles

import durchblick_db as db

APP_NAME = "Durchblick"
APP_VERSION = "2.0"
WEB_DIR = db.APP_DIR / "web"
THEME_DIR = db.DATA_DIR / "theme"  # eigene Gestaltung (schreibbar)

logging.basicConfig(level=logging.INFO,
                    format="%(asctime)s [%(levelname)s] %(message)s",
                    datefmt="%H:%M:%S")
log = logging.getLogger(APP_NAME)

# Fehlzeichen: Sichtbar im GUI, solange eine Query nicht funktioniert
EMOJI = {
    "data_count": "😐", "meta_count": "😑", "type_count": "😒",
    "tag_count": "😔", "user_count": "😕", "group_count": "😖",
    "data_size": "😛", "meta_size": "😞",
    "data_length": "😟", "meta_length": "😠",
}
OVERVIEW_KEYS = {
    "data_count": "sql_data_count", "meta_count": "sql_meta_count",
    "type_count": "sql_type_count", "tag_count": "sql_tag_count",
    "user_count": "sql_usr_count", "group_count": "sql_grp_count",
    "data_size": "sql_data_size_sum", "meta_size": "sql_meta_size_sum",
    "data_length": "sql_data_contentsize_sum", "meta_length": "sql_meta_contentsize_sum",
}

# ---------------------------------------------------------------------------
# Sicherheit
# ---------------------------------------------------------------------------

LOOPBACK = {"127.0.0.1", "localhost", "::1"}

# Content-Security-Policy der Weboberfläche: nur eigene Dateien, keine externen
# Quellen (keine Tracker, keine CDNs, keine Google Fonts -> Datenschutz).
APP_CSP = ("default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; "
           "img-src 'self' data: blob:; media-src 'self' blob:; font-src 'self' data:; "
           "connect-src 'self'; object-src 'none'; base-uri 'none'; form-action 'none'; "
           "frame-ancestors 'none'")

SECURITY_HEADERS = {
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "no-referrer",
    "X-Frame-Options": "DENY",
    "Cross-Origin-Resource-Policy": "same-origin",
    "Cross-Origin-Opener-Policy": "same-origin",
    "Permissions-Policy": "camera=(), microphone=(), geolocation=(), payment=()",
}

THEME_FILE_RE = re.compile(r"[A-Za-z0-9][A-Za-z0-9_.-]{0,80}\.(css|png|jpe?g|webp|gif|svg|woff2?|ttf|otf)")
DIGEST_MAX = 128
TAG_MAX = 100
PATTERN_MAX = 200


def allowed_hosts() -> Optional[set]:
    """Erlaubte Host-Namen (Schutz vor DNS-Rebinding). None = alle erlaubt."""
    hosts = set(LOOPBACK)
    try:
        app_cfg = db.get_config().get("app") or {}
    except Exception:
        return hosts
    host = str(app_cfg.get("host") or "").strip()
    # bandit B104: nur ein Vergleich, hier wird nichts gebunden
    if host and host not in ("0.0.0.0", "::"):  # nosec
        hosts.add(host.lower())
    extra = app_cfg.get("erlaubte_hosts") or []
    if isinstance(extra, str):
        extra = [extra]
    for h in extra:
        h = str(h).strip().lower()
        if h == "*":
            return None
        if h:
            hosts.add(h)
    return hosts


def host_name(host_header: str) -> str:
    h = host_header.strip().lower()
    if h.startswith("["):  # IPv6 mit Port: [::1]:3000
        return h[1:h.find("]")] if "]" in h else h
    return h.rsplit(":", 1)[0] if h.count(":") == 1 else h


def deny(message: str) -> Response:
    return JSONResponse({"ok": False, "error": message}, status_code=403)


app = FastAPI(title=APP_NAME, version=APP_VERSION,
              docs_url=None, redoc_url=None, openapi_url=None)  # keine externen CDN-Skripte


@app.middleware("http")
async def security_middleware(request: Request, call_next):
    host = request.headers.get("host", "")
    allowed = allowed_hosts()
    if allowed is not None and host_name(host) not in allowed:
        log.warning("Anfrage mit fremdem Host abgelehnt: %s", host[:80])
        return deny("Unbekannter Host. Durchblick ist nur über 127.0.0.1 erreichbar.")

    if request.method not in ("GET", "HEAD"):
        # Schutz vor CSRF: Fremde Webseiten können diesen Header nicht ohne
        # CORS-Freigabe setzen, und Durchblick gibt keine CORS-Freigabe.
        if request.headers.get("x-durchblick") != "1":
            return deny("Anfrage ohne X-Durchblick-Header abgelehnt.")
        origin = request.headers.get("origin")
        if origin and urlsplit(origin).netloc.lower() != host.lower():
            return deny("Anfrage von fremder Herkunft abgelehnt.")

    response = await call_next(request)
    for key, value in SECURITY_HEADERS.items():
        response.headers.setdefault(key, value)
    response.headers.setdefault("Content-Security-Policy", APP_CSP)
    if request.url.path.startswith("/api/"):
        response.headers.setdefault("Cache-Control", "no-store")
    return response


def short_error(exc: Exception) -> str:
    log.warning("%s: %s", type(exc).__name__, exc)
    return (str(exc).splitlines() or [type(exc).__name__])[0][:300]


def like_pattern(pattern: str) -> str:
    return pattern.replace("~", "%")[:PATTERN_MAX]


# ---------------------------------------------------------------------------
# API
# ---------------------------------------------------------------------------

@app.get("/api/status")
def api_status():
    out = {"appname": APP_NAME, "appver": APP_VERSION, "dsn": "", "connected": False,
           "author": "😇", "db_version": "😓", "error": None, "ui": dict(db.UI_DEFAULTS)}
    try:
        cfg = db.get_config()
        out["ui"] = db.get_ui(cfg)
        out["dsn"] = str((cfg.get("db") or {}).get("dsn", ""))
        conn_drv = db.connect(cfg)
    except Exception as exc:
        out["error"] = short_error(exc)
        return out
    try:
        out["connected"] = True
        try:
            packed = db.scalar(db.get_query("project", "author", cfg), conn_drv=conn_drv)
            out["author"] = db.decode_payload(packed).decode("utf-8", "replace")
        except Exception as exc:
            out["error"] = "Query project.author: " + short_error(exc)
        try:
            out["db_version"] = db.to_text(
                db.scalar(db.get_query("index", "sql_db_version", cfg), conn_drv=conn_drv))
        except Exception as exc:
            out["error"] = out["error"] or "Query index.sql_db_version: " + short_error(exc)
    finally:
        conn_drv[0].close()
    return out


@app.get("/api/overview")
def api_overview():
    values, errors = dict(EMOJI), {}
    try:
        cfg = db.get_config()
        conn_drv = db.connect(cfg)
    except Exception as exc:
        return {"values": values, "errors": {k: short_error(exc) for k in EMOJI}}
    try:
        for name, key in OVERVIEW_KEYS.items():
            try:
                value = db.scalar(db.get_query("overview", key, cfg), conn_drv=conn_drv)
                if value is not None:
                    values[name] = db.to_number(value)
            except Exception as exc:
                errors[name] = f"overview.{key}: {short_error(exc)}"
    finally:
        conn_drv[0].close()
    return {"values": values, "errors": errors}


@app.get("/api/browse")
def api_browse(pattern: str = Query("%", max_length=PATTERN_MAX),
               limit: int = Query(20, ge=1, le=500)):
    try:
        sql = db.get_query("browse", "sql_browseview_bind")
        columns, rows = db.run_query(sql, [like_pattern(pattern), limit], commit=False)
        return {"columns": columns,
                "rows": [[None if v is None else db.to_text(v) for v in r] for r in rows]}
    except Exception as exc:
        return {"columns": [], "rows": [], "error": short_error(exc)}


@app.get("/api/gallery")
def api_gallery(pattern: str = Query("%", max_length=PATTERN_MAX),
                limit: int = Query(60, ge=1, le=500)):
    """Bilder für die Galerie. Die Query muss mindestens «digest» und «path» liefern."""
    try:
        sql = db.get_query("gallery", "sql_gallery_bind")
        columns, rows = db.run_query(sql, [like_pattern(pattern), limit], commit=False)
    except Exception as exc:
        return {"items": [], "error": short_error(exc)}
    cols = [c.lower() for c in columns]
    if "digest" not in cols or "path" not in cols:
        return {"items": [], "error": "Die Query gallery.sql_gallery_bind muss die Spalten "
                                      "«digest» und «path» liefern (Aliase verwenden)."}
    i_dig, i_path = cols.index("digest"), cols.index("path")
    i_type = cols.index("type") if "type" in cols else None
    items = []
    for r in rows:
        ctype = db.to_text(r[i_type]) if i_type is not None else ""
        if ctype and not ctype.lower().startswith("image/"):
            continue
        path = db.to_text(r[i_path])
        parts = [p for p in path.split("/") if p]
        items.append({"digest": db.to_text(r[i_dig]), "path": path, "type": ctype,
                      "name": parts[-1] if parts else path,
                      "folder": parts[-2] if len(parts) > 1 else ""})
    return {"items": items}


@app.get("/api/data/{digest}")
def api_data(digest: str = PathParam(..., max_length=DIGEST_MAX)):
    out = {"digest": digest, "packed": "😭", "paths": [], "tags": [], "error": None}
    try:
        cfg = db.get_config()
        conn_drv = db.connect(cfg)
    except Exception as exc:
        out["error"] = short_error(exc)
        return out
    try:
        for field, key, convert in (
            ("packed", "sql_content_bind", None),
            ("paths", "sql_contentpaths_bind", "rows"),
            ("tags", "sql_tag_for_digest_bind", "rows"),
        ):
            try:
                sql = db.get_query("data", key, cfg)
                if convert:
                    _, rows = db.run_query(sql, [digest], conn_drv, commit=False)
                    out[field] = [db.to_text(r[0]) for r in rows]
                else:
                    out[field] = db.to_text(db.scalar(sql, [digest], conn_drv))
            except Exception as exc:
                out["error"] = out["error"] or f"data.{key}: {short_error(exc)}"
    finally:
        conn_drv[0].close()
    return out


@app.post("/api/settag")
def api_settag(payload: dict = Body(...)):
    """Tag setzen. Erwartet JSON {"digest": "...", "tag": "..."}."""
    digest = str(payload.get("digest") or "").strip()
    tag = str(payload.get("tag") or "").strip()
    if not digest or len(digest) > DIGEST_MAX:
        return {"ok": False, "error": "Ungültiger digest."}
    if not tag:
        return {"ok": False, "error": "Der Tag darf nicht leer sein."}
    if len(tag) > TAG_MAX:
        return {"ok": False, "error": f"Der Tag darf höchstens {TAG_MAX} Zeichen haben."}
    try:
        cfg = db.get_config()
        conn_drv = db.connect(cfg)
    except Exception as exc:
        return {"ok": False, "error": short_error(exc)}
    try:
        db.run_query(db.get_query("data", "sql_tag_insert_unique_bind", cfg),
                     [tag], conn_drv, commit=False)
        db.run_query(db.get_query("data", "sql_datatag_insert_unique_bind", cfg),
                     [digest, tag], conn_drv, commit=False)
        conn_drv[0].commit()
        return {"ok": True}
    except Exception as exc:
        return {"ok": False, "error": short_error(exc)}
    finally:
        conn_drv[0].close()


@app.get("/api/raw/{digest}")
def api_raw(digest: str = PathParam(..., max_length=DIGEST_MAX)):
    """Dateiinhalt entpackt ausliefern. Content-Type kommt aus der Datenbank."""
    content_type = "text/plain"
    try:
        cfg = db.get_config()
        ctype = db.to_text(db.scalar(db.get_query("raw", "sql_contenttype_bind", cfg), [digest]))
        if re.fullmatch(r"[\w.+-]+/[\w.+-]+", ctype.strip()):
            content_type = ctype.strip()
    except Exception as exc:
        short_error(exc)
    try:
        cfg = db.get_config()
        data = db.decode_payload(db.scalar(db.get_query("data", "sql_content_bind", cfg), [digest]))
    except Exception as exc:
        return Response(f"Durchblick: Inhalt konnte nicht geladen werden.\n{short_error(exc)}",
                        status_code=500, media_type="text/plain")
    # Inhalte stammen aus der Datenbank: im Browser nie ausführen lassen
    return Response(content=data, media_type=content_type, headers={
        "Content-Security-Policy": "sandbox; default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'",
        "X-Content-Type-Options": "nosniff",
        "Cache-Control": "private, max-age=60"})


@app.get("/api/tags")
def api_tags():
    try:
        _, rows = db.run_query(db.get_query("tags", "sql_tags_all_ordered"), commit=False)
        return {"tags": [db.to_text(r[0]) for r in rows]}
    except Exception as exc:
        return {"tags": [], "error": short_error(exc)}


@app.get("/api/tag/{tag}")
def api_tag(tag: str = PathParam(..., max_length=TAG_MAX)):
    try:
        _, rows = db.run_query(db.get_query("tags", "sql_metapaths_for_tag_bind"),
                               [tag], commit=False)
        return {"paths": [db.to_text(r[0]) for r in rows]}
    except Exception as exc:
        return {"paths": [], "error": short_error(exc)}


# ---------------------------------------------------------------------------
# Weboberfläche und eigene Gestaltung
# ---------------------------------------------------------------------------

@app.get("/")
def index():
    return FileResponse(WEB_DIR / "index.html", media_type="text/html",
                        headers={"Cache-Control": "no-store"})


@app.get("/theme/{name}")
def theme_file(name: str):
    """Dateien aus dem Ordner theme/ (eigenes.css, Bilder, Schriften).
    Nur einfache Dateinamen mit erlaubter Endung, keine Unterordner."""
    if not THEME_FILE_RE.fullmatch(name):
        return Response("Nicht erlaubt.", status_code=404, media_type="text/plain")
    path = (THEME_DIR / name).resolve()
    if path.parent != THEME_DIR.resolve() or not path.is_file():
        if name == "eigenes.css":  # fehlt die Datei, einfach leer liefern
            return Response("/* theme/eigenes.css fehlt */\n", media_type="text/css")
        return Response("Nicht gefunden.", status_code=404, media_type="text/plain")
    headers = {"Cache-Control": "no-cache"}
    if path.suffix.lower() == ".svg":
        headers["Content-Security-Policy"] = "sandbox; default-src 'none'; style-src 'unsafe-inline'"
    return FileResponse(path, headers=headers)


app.mount("/static", StaticFiles(directory=str(WEB_DIR)), name="static")


# ---------------------------------------------------------------------------
# Start
# ---------------------------------------------------------------------------

def main():
    import uvicorn
    db.ensure_data_dir()
    try:
        cfg = db.get_config()
    except db.ConfigError as exc:
        print(f"FEHLER: {exc}", file=sys.stderr)
        sys.exit(1)
    app_cfg = cfg.get("app") or {}
    host = str(app_cfg.get("host") or "127.0.0.1")
    try:
        port = int(app_cfg.get("port") or 3000)
    except (TypeError, ValueError):
        print("FEHLER: app.port in der Konfiguration ist keine Zahl.", file=sys.stderr)
        sys.exit(1)
    if host not in LOOPBACK:
        log.warning("ACHTUNG: app.host ist «%s». Die Weboberfläche und damit deine "
                    "Datenbank sind im Netzwerk erreichbar. Für den Unterricht 127.0.0.1 "
                    "verwenden.", host)
    log.info("Config: %s", db.config_path())
    log.info("Starte %s v%s auf http://%s:%s", APP_NAME, APP_VERSION, host, port)
    uvicorn.run(app, host=host, port=port, log_level="info", server_header=False)


if __name__ == "__main__":
    main()
