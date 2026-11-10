#!/usr/bin/env python3
"""
Durchblick - gemeinsame Funktionen für Webserver und Control Panel.

Enthält: Config laden (mit Änderungserkennung), DSN zerlegen, Datenbank-
Verbindung, Query-Ausführung und den Query-Check. Hier steht die gesamte
Datenbanklogik genau einmal. Webserver und Panel verwenden dieselben Funktionen.
Dieses Modul braucht kein fastapi und kein tkinter.
"""

import base64
import os
import zlib
from decimal import Decimal
from pathlib import Path

import yaml

APP_DIR = Path(__file__).resolve().parent
CONFIG_NAME = "durchblick.conf.yml"
# Persönliche Kopie mit echtem Passwort, wird von Git ignoriert (.gitignore)
LOCAL_CONFIG_NAME = "durchblick.conf.local.yml"
# Passwort alternativ aus der Umgebung (überschreibt db.pass der Config)
PASS_ENV = "DURCHBLICK_DB_PASS"
TIMEOUT = 5  # Sekunden für den Verbindungsaufbau

DRIVERS = {
    "mysql": "mysql", "mariadb": "mysql",
    "pg": "pg", "postgres": "pg", "postgresql": "pg",
    "sqlite": "sqlite", "sqlite3": "sqlite",
    "odbc": "odbc",
}
WRITE_PREFIXES = ("insert", "update", "delete", "drop", "alter", "create",
                  "replace", "truncate")


class ConfigError(Exception):
    """Fehler in der Konfigurationsdatei (verständlich formuliert)."""


# ---------------------------------------------------------------------------
# Konfiguration
# ---------------------------------------------------------------------------

def config_path() -> Path:
    """Pfad der Config. Reihenfolge:
    1. Umgebungsvariable DURCHBLICK_CONFIG
    2. durchblick.conf.local.yml im Programmordner (falls vorhanden)
    3. durchblick.conf.yml im Programmordner"""
    env = os.environ.get("DURCHBLICK_CONFIG")
    if env:
        return Path(env)
    local = APP_DIR / LOCAL_CONFIG_NAME
    return local if local.exists() else APP_DIR / CONFIG_NAME


def parse_config_text(text: str) -> dict:
    """YAML-Text prüfen und als dict zurückgeben."""
    try:
        data = yaml.safe_load(text)
    except yaml.YAMLError as exc:
        mark = getattr(exc, "problem_mark", None)
        where = f" (Zeile {mark.line + 1}, Spalte {mark.column + 1})" if mark else ""
        problem = getattr(exc, "problem", None) or str(exc)
        raise ConfigError(f"Ungültiges YAML{where}: {problem}") from exc
    if not isinstance(data, dict):
        raise ConfigError("Die Konfiguration muss aus «Schlüssel: Wert»-Paaren bestehen.")
    return data


_cache = {"path": None, "mtime": None, "cfg": None}


def get_config() -> dict:
    """Config laden. Wird nur neu gelesen, wenn sich die Datei geändert hat."""
    path = config_path()
    try:
        mtime = path.stat().st_mtime
    except OSError:
        raise ConfigError(f"Konfigurationsdatei nicht gefunden: {path}")
    if _cache["path"] != path or _cache["mtime"] != mtime:
        cfg = parse_config_text(path.read_text(encoding="utf-8"))
        _cache.update(path=path, mtime=mtime, cfg=cfg)
    return _cache["cfg"]


def get_query(section: str, key: str, cfg: dict = None) -> str:
    """Query aus der Config lesen. Fehlt sie, gibt es einen verständlichen Fehler."""
    cfg = cfg if cfg is not None else get_config()
    body = cfg.get(section)
    sql = body.get(key) if isinstance(body, dict) else None
    if not isinstance(sql, str) or not sql.strip():
        raise ConfigError(f"Query «{section}.{key}» fehlt in der Konfiguration.")
    return sql


UI_DEFAULTS = {"titel": "", "untertitel": "", "logo": "", "fusszeile": "", "theme": "standard"}
THEMES = ("standard", "hell", "arcade", "terminal", "alpen")


def get_ui(cfg: dict) -> dict:
    """Abschnitt «ui» der Config (Titel, Logo, Vorlage). Nur kurze Texte."""
    body = cfg.get("ui") if isinstance(cfg.get("ui"), dict) else {}
    out = {}
    for key, default in UI_DEFAULTS.items():
        value = body.get(key, default)
        out[key] = str(value if value is not None else "").strip()[:120]
    if out["theme"] not in THEMES:
        out["theme"] = "standard"
    return out


def iter_queries(cfg: dict):
    """Alle SQL-Queries der Config als (Abschnitt, Schlüssel, SQL)."""
    for section, body in cfg.items():
        if section in ("db", "app", "ui") or not isinstance(body, dict):
            continue
        for key, sql in body.items():
            if isinstance(sql, str) and (key.startswith("sql_") or key == "author"):
                yield section, key, sql


# ---------------------------------------------------------------------------
# Verbindung
# ---------------------------------------------------------------------------

def parse_dsn(dsn: str) -> dict:
    """DSN im DBI-Stil zerlegen: DBI:treiber:schlüssel=wert;schlüssel=wert"""
    parts = str(dsn).split(":", 2)
    if len(parts) < 3 or parts[0].strip().upper() != "DBI":
        raise ValueError(f"Ungültiges DSN-Format: «{dsn}». "
                         "Erwartet: DBI:treiber:schlüssel=wert;schlüssel=wert")
    name = parts[1].strip().lower()
    if name not in DRIVERS:
        raise ValueError(f"Unbekannter Treiber «{parts[1]}». Erlaubt: mysql, Pg, SQLite, ODBC.")
    result = {"driver": DRIVERS[name], "host": "localhost", "port": 0, "database": ""}
    rest = parts[2].strip()
    if result["driver"] == "odbc":
        result["database"] = rest  # bei ODBC ist der Rest der DSN-Name
        return result
    for pair in rest.split(";"):
        if "=" not in pair:
            continue
        key, value = pair.split("=", 1)
        key, value = key.strip().lower(), value.strip()
        if key == "port":
            try:
                result["port"] = int(value)
            except ValueError:
                raise ValueError(f"Ungültiger Port: «{value}»")
        elif key in ("database", "dbname"):
            result["database"] = value
        elif key == "host":
            result["host"] = value
    return result


def connect(cfg: dict = None):
    """Verbindung öffnen. Gibt (connection, treiber) zurück."""
    cfg = cfg if cfg is not None else get_config()
    dbc = cfg.get("db") or {}
    p = parse_dsn(dbc.get("dsn", ""))
    user = str(dbc.get("user") or "")
    password = os.environ.get(PASS_ENV) or str(dbc.get("pass") or "")
    drv = p["driver"]
    try:
        if drv == "mysql":
            import pymysql
            conn = pymysql.connect(host=p["host"], port=p["port"] or 3306, user=user,
                                   password=password, database=p["database"],
                                   charset="utf8mb4", connect_timeout=TIMEOUT)
        elif drv == "pg":
            import psycopg2
            conn = psycopg2.connect(dbname=p["database"], user=user, password=password,
                                    host=p["host"], port=p["port"] or 5432,
                                    connect_timeout=TIMEOUT)
        elif drv == "sqlite":
            import sqlite3
            path = p["database"] or ":memory:"
            if path != ":memory:" and not Path(path).exists():
                raise FileNotFoundError(f"SQLite-Datei nicht gefunden: {path}")
            conn = sqlite3.connect(path, timeout=TIMEOUT)
        else:
            import pyodbc
            conn = pyodbc.connect(f"DSN={p['database']};UID={user};PWD={password}",
                                  timeout=TIMEOUT)
    except ImportError as exc:
        raise RuntimeError(f"Python-Modul «{exc.name}» fehlt. "
                           "Installieren mit: python -m pip install -r requirements.txt") from exc
    return conn, drv


# ---------------------------------------------------------------------------
# Queries
# ---------------------------------------------------------------------------

def prepare_sql(sql: str, drv: str, has_params: bool) -> str:
    """In der Config steht immer «?». MySQL und PostgreSQL erwarten «%s»."""
    if drv in ("mysql", "pg") and has_params:
        return sql.replace("%", "%%").replace("?", "%s")
    return sql


def run_query(sql: str, params=None, conn_drv=None, commit: bool = True):
    """Query ausführen. Gibt (Spaltennamen, Zeilen) zurück.
    Mit conn_drv=(conn, drv) wird eine bestehende Verbindung wiederverwendet."""
    own = conn_drv is None
    conn, drv = conn_drv if conn_drv else connect()
    try:
        cur = conn.cursor()
        try:
            final = prepare_sql(sql, drv, bool(params))
            if params:
                cur.execute(final, list(params))
            else:
                cur.execute(final)
            cols = [d[0] for d in cur.description] if cur.description else []
            rows = [tuple(r) for r in cur.fetchall()] if cur.description else []
        finally:
            cur.close()
        if commit:
            conn.commit()
        return cols, rows
    except Exception:
        try:
            conn.rollback()  # PostgreSQL: abgebrochene Transaktion aufräumen
        except Exception:
            pass
        raise
    finally:
        if own:
            conn.close()


def scalar(sql: str, params=None, conn_drv=None):
    """Einzelnen Wert (erste Zeile, erste Spalte) abfragen oder None."""
    _, rows = run_query(sql, params, conn_drv)
    return rows[0][0] if rows else None


def is_write(sql: str) -> bool:
    return sql.lstrip().lower().startswith(WRITE_PREFIXES)


def to_text(value) -> str:
    """Beliebigen DB-Wert als Text (bytes werden dekodiert, None wird leer)."""
    if value is None:
        return ""
    if isinstance(value, (bytes, bytearray, memoryview)):
        return bytes(value).decode("utf-8", "replace")
    return str(value)


def to_number(value):
    """Zahlen JSON-tauglich machen (Decimal aus SUM() bei MySQL/PostgreSQL)."""
    if isinstance(value, Decimal):
        return int(value) if value == value.to_integral_value() else float(value)
    if isinstance(value, (int, float)):
        return value
    return to_text(value)


def decode_payload(content) -> bytes:
    """Base64url-kodierte und zlib-komprimierte Inhalte entpacken."""
    if content is None:
        raise ValueError("kein Inhalt")
    raw = bytes(content) if isinstance(content, (bytes, bytearray, memoryview)) \
        else str(content).encode("utf-8")
    raw = raw.strip()
    raw += b"=" * (-len(raw) % 4)  # fehlendes Padding ergänzen
    return zlib.decompress(base64.urlsafe_b64decode(raw))


# ---------------------------------------------------------------------------
# Query-Check (für das Control Panel)
# ---------------------------------------------------------------------------

def dummy_params(key: str, n: int) -> list:
    base = ["%", 5] if key in ("sql_browseview_bind", "sql_gallery_bind") else []
    return (base + ["x"] * n)[:n]


def check_queries(cfg: dict) -> list:
    """Jede Query der Config einzeln testen.
    Gibt Tupel (Abschnitt, Schlüssel, Status, Details) zurück.
    Schreibende Queries werden nie ausgeführt."""
    conn_drv = connect(cfg)
    results = []
    try:
        for section, key, sql in iter_queries(cfg):
            n = sql.count("?")
            if is_write(sql):
                results.append((section, key, "übersprungen",
                                "Schreibende Query wird nicht getestet"))
                continue
            try:
                cols, rows = run_query(sql, dummy_params(key, n) or None,
                                       conn_drv, commit=False)
                if key in ("sql_browseview_bind", "sql_gallery_bind") and \
                        "digest" not in [c.lower() for c in cols]:
                    status, detail = "Hinweis", "Spalte «digest» fehlt (Link im Browser nicht möglich)"
                elif n == 0 and (not rows or (len(rows[0]) == 1 and rows[0][0] is None)):
                    status, detail = "Leer", "Query läuft, liefert aber kein Ergebnis"
                else:
                    status, detail = "OK", f"{len(rows)} Zeile(n)"
            except Exception as exc:
                status, detail = "Fehler", (str(exc).splitlines() or [""])[0][:200]
            results.append((section, key, status, detail))
    finally:
        conn_drv[0].close()
    return results
