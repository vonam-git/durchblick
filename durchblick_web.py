#!/usr/bin/env python3
"""
Durchblick - Datenbank-Weboberfläche
Version: 1.1
Laufzeit: Python 3.9+

Installation:   python -m pip install -r requirements.txt
Start:          python durchblick_web.py      (oder über durchblick_panel.py)

Alle SQL-Queries und Verbindungsdaten stehen NUR in durchblick.conf.yml.
Die Config wird bei jeder Anfrage auf Änderungen geprüft. Ein Neustart
nach dem Speichern ist nicht nötig.
"""

import logging
import re
import sys

from fastapi import FastAPI, Query
from fastapi.responses import Response

import durchblick_db as db

APP_NAME = "Durchblick"
APP_VERSION = "1.1"

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

app = FastAPI(title=APP_NAME, version=APP_VERSION)


def short_error(exc: Exception) -> str:
    log.warning("%s: %s", type(exc).__name__, exc)
    return (str(exc).splitlines() or [type(exc).__name__])[0][:300]


# ---------------------------------------------------------------------------
# API
# ---------------------------------------------------------------------------

@app.get("/api/status")
def api_status():
    out = {"appname": APP_NAME, "appver": APP_VERSION, "dsn": "", "connected": False,
           "author": "😇", "db_version": "😓", "error": None}
    try:
        cfg = db.get_config()
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
def api_browse(pattern: str = "%", limit: int = Query(20, ge=1, le=500)):
    try:
        sql = db.get_query("browse", "sql_browseview_bind")
        columns, rows = db.run_query(sql, [pattern.replace("~", "%"), limit])
        return {"columns": columns,
                "rows": [[None if v is None else db.to_text(v) for v in r] for r in rows]}
    except Exception as exc:
        return {"columns": [], "rows": [], "error": short_error(exc)}


@app.get("/api/data/{digest}")
def api_data(digest: str):
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
def api_settag(digest: str, tag: str):
    tag = tag.strip()[:100]
    if not tag:
        return {"ok": False, "error": "Der Tag darf nicht leer sein."}
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
def api_raw(digest: str):
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
        "Content-Security-Policy": "sandbox",
        "X-Content-Type-Options": "nosniff"})


@app.get("/api/tags")
def api_tags():
    try:
        _, rows = db.run_query(db.get_query("tags", "sql_tags_all_ordered"), commit=False)
        return {"tags": [db.to_text(r[0]) for r in rows]}
    except Exception as exc:
        return {"tags": [], "error": short_error(exc)}


@app.get("/api/tag/{tag}")
def api_tag(tag: str):
    try:
        _, rows = db.run_query(db.get_query("tags", "sql_metapaths_for_tag_bind"),
                               [tag], commit=False)
        return {"paths": [db.to_text(r[0]) for r in rows]}
    except Exception as exc:
        return {"paths": [], "error": short_error(exc)}


@app.get("/")
def index():
    return Response(content=INDEX_HTML, media_type="text/html",
                    headers={"Cache-Control": "no-store"})


# ---------------------------------------------------------------------------
# Eingebettete Weboberfläche
# ---------------------------------------------------------------------------

INDEX_HTML = r"""<!DOCTYPE html>
<html lang="de-CH">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Durchblick</title>
<style>
:root {
  --bg: #0f1220; --panel: #171a2b; --panel2: #1e2238; --border: #2a2f4a;
  --text: #e8eaf2; --muted: #9aa0b5; --accent: #6d4aff; --accent2: #8f74ff;
  --ok: #3dd68c; --err: #ff5c74; --radius: 12px;
}
* { box-sizing: border-box; margin: 0; padding: 0; }
body { background: var(--bg); color: var(--text);
  font-family: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; min-height: 100vh; }
header { background: linear-gradient(135deg, #232850 0%, #171a2b 100%);
  border-bottom: 1px solid var(--border); padding: 18px 28px; display: flex; align-items: center; }
.logo { font-size: 26px; font-weight: 700; } .logo span { color: var(--accent2); }
.appver { color: var(--muted); font-size: 13px; margin-left: auto; }
nav { display: flex; gap: 8px; padding: 14px 28px; background: var(--panel);
  border-bottom: 1px solid var(--border); position: sticky; top: 0; z-index: 10; flex-wrap: wrap; }
nav button { background: transparent; color: var(--muted); border: none; padding: 9px 20px;
  border-radius: 999px; cursor: pointer; font-size: 15px; }
nav button:hover { color: var(--text); background: var(--panel2); }
nav button.active { background: var(--accent); color: #fff; font-weight: 600; }
main { padding: 26px 28px; max-width: 1200px; margin: 0 auto; }
section.tab { display: none; } section.tab.visible { display: block; }
h2 { font-size: 19px; margin-bottom: 16px; font-weight: 600; }
.cardgrid { display: grid; grid-template-columns: repeat(auto-fill, minmax(170px, 1fr));
  gap: 14px; margin-bottom: 26px; }
.card { background: var(--panel); border: 1px solid var(--border); border-radius: var(--radius); padding: 16px 18px; }
.card .label { color: var(--muted); font-size: 12.5px; text-transform: uppercase; letter-spacing: .6px; }
.card .value { font-size: 26px; font-weight: 700; margin-top: 6px; }
.card .value.emoji { font-size: 22px; }
.statusbar { display: flex; flex-wrap: wrap; gap: 12px; margin-bottom: 18px; }
.pill { background: var(--panel); border: 1px solid var(--border); border-radius: 999px;
  padding: 7px 16px; font-size: 13.5px; color: var(--muted); }
.pill b { color: var(--text); } .pill.ok b { color: var(--ok); } .pill.err b { color: var(--err); }
table { width: 100%; border-collapse: collapse; background: var(--panel); border-radius: var(--radius);
  overflow: hidden; font-size: 14px; }
th, td { padding: 10px 14px; text-align: left; }
th { background: var(--panel2); color: var(--muted); font-size: 12.5px; text-transform: uppercase; }
tr { border-top: 1px solid var(--border); } tbody tr:hover { background: var(--panel2); }
a { color: var(--accent2); text-decoration: none; } a:hover { text-decoration: underline; }
.toolbar { display: flex; gap: 10px; margin-bottom: 16px; flex-wrap: wrap; }
input[type=text], input[type=number] { background: var(--panel2); border: 1px solid var(--border);
  color: var(--text); border-radius: 8px; padding: 9px 14px; font-size: 14px; outline: none; }
input:focus { border-color: var(--accent); }
.btn { background: var(--accent); color: #fff; border: none; border-radius: 8px; padding: 9px 18px;
  font-size: 14px; cursor: pointer; font-weight: 600; }
.btn:hover { background: var(--accent2); }
.btn.ghost { background: transparent; border: 1px solid var(--border); color: var(--muted); font-weight: 400; }
.chips { display: flex; flex-wrap: wrap; gap: 10px; }
.chip { background: var(--panel2); border: 1px solid var(--border); border-radius: 999px;
  padding: 7px 16px; cursor: pointer; font-size: 14px; color: var(--text); }
.chip:hover { border-color: var(--accent); color: var(--accent2); text-decoration: none; }
pre.raw { background: var(--panel); border: 1px solid var(--border); border-radius: var(--radius);
  padding: 16px; white-space: pre-wrap; word-break: break-all;
  font-family: ui-monospace, Menlo, Consolas, monospace; font-size: 12.5px; color: #a9c1ff;
  max-height: 260px; overflow-y: auto; }
.msg { color: var(--muted); font-size: 14px; margin: 10px 0; } .error { color: var(--err); }
.overlay { display: none; position: fixed; inset: 0; background: rgba(5,7,15,.72); z-index: 50; padding: 40px; }
.overlay.open { display: flex; align-items: flex-start; justify-content: center; }
.dialog { background: var(--panel); border: 1px solid var(--border); border-radius: 16px; padding: 26px;
  width: 100%; max-width: 780px; max-height: 85vh; overflow-y: auto; }
.dialog h3 { margin-bottom: 14px; font-size: 17px; }
.closex { float: right; background: none; border: none; color: var(--muted); font-size: 22px; cursor: pointer; }
.closex:hover { color: var(--err); }
footer { color: var(--muted); font-size: 12.5px; text-align: center; padding: 30px; }
.hint { background: var(--panel); border: 1px dashed var(--accent); border-radius: var(--radius);
  padding: 14px 18px; color: var(--muted); font-size: 13.5px; margin-bottom: 18px; }
</style>
</head>
<body>
<header>
  <div class="logo">Durch<span>blick</span></div>
  <div class="appver" id="appver"></div>
</header>
<nav>
  <button class="tabbtn active" data-tab="start">Start</button>
  <button class="tabbtn" data-tab="overview">Übersicht</button>
  <button class="tabbtn" data-tab="browse">Browser</button>
  <button class="tabbtn" data-tab="tags">Tags</button>
</nav>
<main>
<section class="tab visible" id="tab-start">
  <div class="statusbar" id="statusbar"></div>
  <div id="status-error"></div>
  <h2>Projektautor</h2>
  <pre class="raw" id="author"></pre>
  <h2 style="margin-top:26px">Hinweis zur Bearbeitung</h2>
  <div class="hint">
    Diese Oberfläche zeigt die Daten aus der Datenbank. Erscheinen Emojis, ist die
    zugehörige Query in <b>durchblick.conf.yml</b> noch nicht korrekt ans Schema angepasst.
    Config speichern und Reiter wechseln: Die Daten werden beim Wechsel neu geladen.
    Der Mauszeiger über einem Emoji in der Übersicht zeigt die Fehlermeldung.
  </div>
</section>
<section class="tab" id="tab-overview">
  <h2>Bestände</h2>
  <div class="cardgrid" id="ov-counts"></div>
  <h2>Speicherbelegung</h2>
  <table>
    <thead><tr><th>Tabelle</th><th>Original (size)</th><th>Belegt (content)</th></tr></thead>
    <tbody id="ov-sizes"></tbody>
  </table>
  <div id="ov-errors"></div>
</section>
<section class="tab" id="tab-browse">
  <h2>Dateien durchsuchen</h2>
  <div class="toolbar">
    <input type="text" id="pattern" value="%" placeholder="Pfad-Muster (% oder ~ als Platzhalter)">
    <input type="number" id="limit" value="20" min="1" max="500" style="width:90px">
    <button class="btn" id="btn-search">Suchen</button>
    <button class="btn ghost" id="btn-all">Alle</button>
  </div>
  <div class="msg" id="browse-msg"></div>
  <div style="overflow-x:auto"><table id="browse-table"><thead></thead><tbody></tbody></table></div>
</section>
<section class="tab" id="tab-tags">
  <h2>Vergebene Tags</h2>
  <div class="msg" id="tags-msg"></div>
  <div class="chips" id="tags-chips"></div>
  <div id="tag-detail" style="margin-top:26px"></div>
</section>
</main>
<div class="overlay" id="overlay"><div class="dialog" id="dialog"></div></div>
<footer>Durchblick | Konfiguration: durchblick.conf.yml</footer>

<script>
const $ = s => document.querySelector(s);
const esc = v => String(v ?? "").replace(/[&<>"']/g,
  c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const fmt = v => (typeof v === "number") ? v.toLocaleString("de-CH") : esc(v);
const isEmoji = v => typeof v === "string" && /\p{Extended_Pictographic}/u.test(v);
const offline = '<div class="msg error">Der Webserver antwortet nicht. Läuft er noch?</div>';

async function api(path, opts) {
  const r = await fetch(path, { cache: "no-store", ...opts });
  if (!r.ok) throw new Error("HTTP " + r.status);
  return r.json();
}

let browsed = false;
const loaders = {
  start: loadStatus, overview: loadOverview, tags: loadTags,
  browse: () => { if (!browsed) { browsed = true; browse(); } },
};

function switchTab(id) {
  document.querySelectorAll(".tabbtn").forEach(b => b.classList.toggle("active", b.dataset.tab === id));
  document.querySelectorAll("section.tab").forEach(s => s.classList.toggle("visible", s.id === "tab-" + id));
  loaders[id]();
}

async function loadStatus() {
  try {
    const d = await api("/api/status");
    $("#appver").textContent = `${d.appname} v${d.appver}`;
    $("#statusbar").innerHTML = `
      <div class="pill ${d.connected ? "ok" : "err"}"><b>${d.connected ? "Datenbank verbunden" : "Keine Verbindung"}</b></div>
      <div class="pill">DSN: <b>${esc(d.dsn)}</b></div>
      <div class="pill">DB-Software: <b>${esc(d.db_version)}</b></div>`;
    $("#status-error").innerHTML = d.error ? `<div class="msg error">${esc(d.error)}</div>` : "";
    $("#author").textContent = d.author;
  } catch (e) { $("#statusbar").innerHTML = offline; }
}

async function loadOverview() {
  try {
    const d = await api("/api/overview"), v = d.values, er = d.errors;
    const counts = [["Data","data_count"],["Meta","meta_count"],["Type","type_count"],
                    ["Tag","tag_count"],["User","user_count"],["Gruppen","group_count"]];
    $("#ov-counts").innerHTML = counts.map(([label, key]) => `
      <div class="card" title="${esc(er[key] || "")}"><div class="label">${esc(label)}</div>
      <div class="value ${isEmoji(v[key]) ? "emoji" : ""}">${fmt(v[key])}</div></div>`).join("");
    const sizes = [["Data","data_size","data_length"], ["Meta","meta_size","meta_length"]];
    $("#ov-sizes").innerHTML = sizes.map(([label, a, b]) =>
      `<tr><td>${esc(label)}</td><td title="${esc(er[a] || "")}">${fmt(v[a])}</td>
       <td title="${esc(er[b] || "")}">${fmt(v[b])}</td></tr>`).join("");
    const msgs = Object.values(er);
    $("#ov-errors").innerHTML = msgs.length
      ? `<h2 style="margin-top:26px">Fehlermeldungen</h2><pre class="raw error">${esc(msgs.join("\n"))}</pre>` : "";
  } catch (e) { $("#ov-counts").innerHTML = offline; }
}

async function browse() {
  const pattern = encodeURIComponent($("#pattern").value || "%");
  const limit = Math.min(500, Math.max(1, parseInt($("#limit").value, 10) || 20));
  const msg = $("#browse-msg"), table = $("#browse-table");
  const clear = () => { table.querySelector("thead").innerHTML = ""; table.querySelector("tbody").innerHTML = ""; };
  try {
    const d = await api(`/api/browse?pattern=${pattern}&limit=${limit}`);
    if (d.error) { msg.innerHTML = `<span class="error">Query-Fehler: ${esc(d.error)}</span>`; clear(); return; }
    msg.textContent = `${d.rows.length} Datensätze gefunden.`;
    if (!d.columns.length) { clear(); return; }
    table.querySelector("thead").innerHTML =
      "<tr>" + d.columns.map(c => `<th>${esc(c)}</th>`).join("") + "</tr>";
    table.querySelector("tbody").innerHTML = d.rows.map(row =>
      "<tr>" + row.map((cell, i) => d.columns[i].toLowerCase() === "digest"
        ? `<td><a href="#" data-digest="${esc(cell)}">${esc(cell)}</a></td>`
        : `<td>${esc(cell)}</td>`).join("") + "</tr>").join("");
  } catch (e) { msg.innerHTML = offline; clear(); }
}

async function showData(digest) {
  $("#overlay").classList.add("open");
  $("#dialog").innerHTML = "<h2>Lade…</h2>";
  try {
    const d = await api(`/api/data/${encodeURIComponent(digest)}`);
    const tagsHtml = d.tags.length
      ? d.tags.map(t => `<a class="chip" href="#" data-tag="${esc(t)}">${esc(t)}</a>`).join(" ")
      : "<span class='msg'>Keine Tags gesetzt</span>";
    $("#dialog").innerHTML = `
      <button class="closex" id="btn-close">✕</button>
      <h3>Datensatz <span style="color:var(--accent2)">${esc(d.digest)}</span></h3>
      ${d.error ? `<div class="msg error">Query-Fehler: ${esc(d.error)}</div>` : ""}
      <p><a href="/api/raw/${encodeURIComponent(d.digest)}" target="_blank" rel="noopener">Inhalt entpacken und anzeigen</a></p>
      <h2 style="margin-top:18px">Dateipfade</h2>
      <pre class="raw">${esc(d.paths.join("\n"))}</pre>
      <h2 style="margin-top:18px">Tags</h2>
      <div class="chips" style="margin-bottom:10px">${tagsHtml}</div>
      <div class="toolbar">
        <input type="text" id="newtag" placeholder="Neuer Tag">
        <button class="btn" id="btn-settag">Tag setzen</button>
      </div>
      <h2 style="margin-top:18px">Gepackte Daten (Base64)</h2>
      <pre class="raw">${esc(d.packed)}</pre>`;
    $("#btn-close").onclick = closeOverlay;
    $("#btn-settag").onclick = () => setTag(d.digest);
    $("#newtag").addEventListener("keydown", e => { if (e.key === "Enter") setTag(d.digest); });
  } catch (e) { $("#dialog").innerHTML = offline; }
}

async function setTag(digest) {
  const tag = $("#newtag").value.trim();
  if (!tag) return;
  try {
    const d = await api(`/api/settag?digest=${encodeURIComponent(digest)}&tag=${encodeURIComponent(tag)}`,
                        { method: "POST" });
    if (d.ok) showData(digest);
    else alert("Tag konnte nicht gesetzt werden:\n" + (d.error || "unbekannter Fehler"));
  } catch (e) { alert("Der Webserver antwortet nicht."); }
}

async function loadTags() {
  try {
    const d = await api("/api/tags");
    if (d.error) {
      $("#tags-msg").innerHTML = `<span class="error">Query-Fehler: ${esc(d.error)}</span>`;
      $("#tags-chips").innerHTML = ""; return;
    }
    $("#tags-msg").textContent = d.tags.length ? `${d.tags.length} Tags vorhanden.` : "Noch keine Tags.";
    $("#tags-chips").innerHTML = d.tags.map(t =>
      `<a class="chip" href="#" data-tag="${esc(t)}">${esc(t)}</a>`).join("");
  } catch (e) { $("#tags-msg").innerHTML = offline; }
}

async function showTag(tag) {
  try {
    const d = await api(`/api/tag/${encodeURIComponent(tag)}`);
    $("#tag-detail").innerHTML = `<h2>Pfade für Tag «${esc(tag)}»</h2>` + (d.error
      ? `<div class="msg error">Query-Fehler: ${esc(d.error)}</div>`
      : `<pre class="raw">${esc(d.paths.join("\n")) || "Keine Pfade gefunden."}</pre>`);
  } catch (e) { $("#tag-detail").innerHTML = offline; }
}

function closeOverlay() { $("#overlay").classList.remove("open"); }

document.addEventListener("click", e => {
  const tab = e.target.closest(".tabbtn");
  if (tab) return switchTab(tab.dataset.tab);
  if (e.target.id === "overlay") return closeOverlay();
  const el = e.target.closest("[data-digest],[data-tag]");
  if (!el) return;
  e.preventDefault();
  if (el.dataset.digest !== undefined) showData(el.dataset.digest);
  else { closeOverlay(); switchTab("tags"); showTag(el.dataset.tag); }
});
$("#btn-search").onclick = browse;
$("#btn-all").onclick = () => { $("#pattern").value = "%"; browse(); };
$("#pattern").addEventListener("keydown", e => { if (e.key === "Enter") browse(); });
document.addEventListener("keydown", e => { if (e.key === "Escape") closeOverlay(); });
loadStatus();
</script>
</body>
</html>
"""

# ---------------------------------------------------------------------------
# Start
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    import uvicorn
    try:
        _cfg = db.get_config()
    except db.ConfigError as exc:
        print(f"FEHLER: {exc}", file=sys.stderr)
        sys.exit(1)
    _app = _cfg.get("app") or {}
    _host = str(_app.get("host") or "127.0.0.1")
    try:
        _port = int(_app.get("port") or 3000)
    except (TypeError, ValueError):
        print("FEHLER: app.port in der Konfiguration ist keine Zahl.", file=sys.stderr)
        sys.exit(1)
    log.info("Starte %s v%s auf http://%s:%s", APP_NAME, APP_VERSION, _host, _port)
    uvicorn.run(app, host=_host, port=_port, log_level="info")
