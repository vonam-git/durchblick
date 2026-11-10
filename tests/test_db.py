"""Tests der gemeinsamen Datenbankfunktionen."""

import pytest

import durchblick_db as db
import helpers


def test_decode_payload_roundtrip():
    assert db.decode_payload(helpers.encode(b"hallo")) == b"hallo"
    assert db.decode_payload(helpers.encode(b"hallo").rstrip("=")) == b"hallo"


def test_parse_dsn():
    p = db.parse_dsn("DBI:mysql:database=m141;host=db;port=3307")
    assert p == {"driver": "mysql", "host": "db", "port": 3307, "database": "m141"}
    with pytest.raises(ValueError):
        db.parse_dsn("mysql://x")


def test_prepare_sql_placeholders():
    assert db.prepare_sql("select * from t where a like '%x' and b = ?", "mysql", True) == \
        "select * from t where a like '%%x' and b = %s"
    assert db.prepare_sql("select ?", "sqlite", True) == "select ?"


def test_is_write():
    assert db.is_write("  INSERT into x values (1)")
    assert not db.is_write("select 1")


def test_get_ui_sanitizes():
    ui = db.get_ui({"ui": {"titel": "x" * 500, "theme": "../../evil"}})
    assert len(ui["titel"]) == 120 and ui["theme"] == "standard"
    assert db.get_ui({})["theme"] == "standard"


def test_ui_and_app_not_queries():
    cfg = {"ui": {"sql_x": "select 1"}, "app": {"sql_y": "select 1"}, "a": {"sql_z": "select 1"}}
    assert list(db.iter_queries(cfg)) == [("a", "sql_z", "select 1")]


def test_local_config_preferred(tmp_path, monkeypatch):
    monkeypatch.delenv("DURCHBLICK_CONFIG", raising=False)
    monkeypatch.setattr(db, "APP_DIR", tmp_path)
    (tmp_path / db.CONFIG_NAME).write_text("a: 1\n")
    assert db.config_path().name == db.CONFIG_NAME
    (tmp_path / db.LOCAL_CONFIG_NAME).write_text("a: 2\n")
    assert db.config_path().name == db.LOCAL_CONFIG_NAME


def test_password_from_env(monkeypatch):
    seen = {}

    class FakePymysql:
        @staticmethod
        def connect(**kw):
            seen.update(kw)
            return object()
    monkeypatch.setitem(__import__("sys").modules, "pymysql", FakePymysql)
    monkeypatch.setenv(db.PASS_ENV, "geheim")
    db.connect({"db": {"dsn": "DBI:mysql:database=x", "user": "u", "pass": "DBPASS"}})
    assert seen["password"] == "geheim"


def test_check_queries_all_ok(setup_db):
    cfg = db.get_config()
    results = db.check_queries(cfg)
    bad = [r for r in results if r[2] not in ("OK", "übersprungen", "Leer")]
    assert not bad, bad
    assert any(r[1] == "sql_gallery_bind" and r[2] == "OK" for r in results)


def test_yaml_error_message():
    with pytest.raises(db.ConfigError) as exc:
        db.parse_config_text("a: [1, 2")
    assert "Zeile" in str(exc.value)
