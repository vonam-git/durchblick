import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(Path(__file__).parent))

import helpers  # noqa: E402


@pytest.fixture()
def setup_db(tmp_path, monkeypatch):
    """Testdatenbank + Config in einem temporären Ordner."""
    db_path = tmp_path / "m141.db"
    helpers.import_csv(helpers.make_csv(helpers.sample_files()), db_path)
    cfg_text = helpers.sqlite_config(db_path, (ROOT / "durchblick.conf.yml").read_text(encoding="utf-8"))
    cfg_path = tmp_path / "durchblick.conf.yml"
    cfg_path.write_text(cfg_text, encoding="utf-8")
    monkeypatch.setenv("DURCHBLICK_CONFIG", str(cfg_path))
    monkeypatch.delenv("DURCHBLICK_DB_PASS", raising=False)
    return db_path, cfg_path


@pytest.fixture()
def client(setup_db):
    from fastapi.testclient import TestClient
    import durchblick_web
    return TestClient(durchblick_web.app, base_url="http://127.0.0.1:3000")
