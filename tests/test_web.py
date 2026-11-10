"""Tests der Weboberfläche und der Sicherheitsfunktionen (SQLite)."""

import helpers

H = {"X-Durchblick": "1"}


def test_status_and_author(client):
    d = client.get("/api/status").json()
    assert d["connected"] is True
    assert d["author"].startswith("Anna Beispiel")
    assert d["error"] is None
    assert d["ui"]["theme"] == "standard"


def test_overview_counts(client):
    d = client.get("/api/overview").json()
    assert d["errors"] == {}
    assert d["values"]["meta_count"] == 5
    assert d["values"]["data_count"] == 4  # zwei Pfade teilen denselben Inhalt


def test_browse(client):
    d = client.get("/api/browse", params={"pattern": "%skins%", "limit": 10}).json()
    assert "digest" in d["columns"] and len(d["rows"]) == 2


def test_gallery_only_images(client):
    d = client.get("/api/gallery").json()
    assert "error" not in d
    names = sorted(i["name"] for i in d["items"])
    assert names == ["evil.svg", "kopie.png", "neon_ninja.png"]
    assert {i["folder"] for i in d["items"]} == {"skins", "game_shop"}


def test_raw_image_and_sandbox(client):
    item = next(i for i in client.get("/api/gallery").json()["items"] if i["name"] == "neon_ninja.png")
    r = client.get(f"/api/raw/{item['digest']}")
    assert r.status_code == 200
    assert r.headers["content-type"] == "image/png"
    assert r.content == helpers.PNG_1PX
    assert "sandbox" in r.headers["content-security-policy"]
    assert r.headers["x-content-type-options"] == "nosniff"


def test_svg_is_sandboxed(client):
    item = next(i for i in client.get("/api/gallery").json()["items"] if i["name"] == "evil.svg")
    r = client.get(f"/api/raw/{item['digest']}")
    assert "sandbox" in r.headers["content-security-policy"]


def test_settag_requires_header(client):
    digest = client.get("/api/gallery").json()["items"][0]["digest"]
    r = client.post("/api/settag", json={"digest": digest, "tag": "skin"})
    assert r.status_code == 403


def test_settag_rejects_foreign_origin(client):
    digest = client.get("/api/gallery").json()["items"][0]["digest"]
    r = client.post("/api/settag", json={"digest": digest, "tag": "skin"},
                    headers={**H, "Origin": "http://evil.example"})
    assert r.status_code == 403


def test_settag_and_tags(client):
    digest = client.get("/api/gallery").json()["items"][0]["digest"]
    r = client.post("/api/settag", json={"digest": digest, "tag": "skin"},
                    headers={**H, "Origin": "http://127.0.0.1:3000"})
    assert r.json() == {"ok": True}
    assert "skin" in client.get("/api/tags").json()["tags"]
    assert client.get("/api/tag/skin").json()["paths"]
    assert client.get(f"/api/data/{digest}").json()["tags"] == ["skin"]


def test_settag_validation(client):
    r = client.post("/api/settag", json={"digest": "x", "tag": "a" * 101}, headers=H)
    assert r.json()["ok"] is False


def test_dns_rebinding_blocked(client):
    r = client.get("/api/status", headers={"Host": "evil.example:3000"})
    assert r.status_code == 403


def test_localhost_allowed(client):
    assert client.get("/api/status", headers={"Host": "localhost:3000"}).status_code == 200


def test_security_headers_on_index(client):
    r = client.get("/")
    assert r.status_code == 200 and "Durchblick" in r.text
    csp = r.headers["content-security-policy"]
    assert "script-src 'self'" in csp and "frame-ancestors 'none'" in csp
    assert r.headers["x-frame-options"] == "DENY"
    assert r.headers["referrer-policy"] == "no-referrer"
    assert "server" not in {k.lower() for k in r.headers} or "uvicorn" not in r.headers.get("server", "")


def test_api_docs_disabled(client):
    assert client.get("/docs").status_code == 404
    assert client.get("/openapi.json").status_code == 404


def test_theme_files(client):
    r = client.get("/theme/eigenes.css")
    assert r.status_code == 200 and r.headers["content-type"].startswith("text/css")


def test_theme_path_traversal(client):
    for bad in ["../durchblick.conf.yml", "..%2Fdurchblick.conf.yml", "durchblick.conf.yml",
                "%2e%2e%2fdurchblick_db.py", ".hidden.css"]:
        r = client.get("/theme/" + bad)
        assert r.status_code == 404, bad


def test_static_traversal(client):
    for bad in ["/static/../durchblick.conf.yml", "/static/%2e%2e/durchblick.conf.yml"]:
        r = client.get(bad)
        assert r.status_code == 404 or "dsn" not in r.text, bad


def test_static_files(client):
    for f in ["js/app.js", "js/generator.js", "js/checker.js", "js/compressor.js",
              "js/zipwriter.js", "css/app.css", "themes/arcade.css"]:
        assert client.get("/static/" + f).status_code == 200, f


def test_limits(client):
    assert client.get("/api/browse", params={"limit": 501}).status_code == 422
    assert client.get("/api/browse", params={"pattern": "x" * 201}).status_code == 422
    assert client.get("/api/data/" + "a" * 129).status_code == 422
