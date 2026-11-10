"""Hilfsfunktionen für die Tests: CSV wie der Datensatzgenerator erzeugen
und in eine SQLite-Testdatenbank importieren."""

import base64
import csv
import hashlib
import io
import re
import sqlite3
import zlib
from pathlib import Path

FIXTURES = Path(__file__).parent / "fixtures"
COLUMNS = ["count", "hash", "path", "size", "type", "mode", "uid", "user", "gid",
           "group", "time", "compressed_size", "compression_ratio", "encoded_data"]

# 1x1-PNG (rot)
PNG_1PX = base64.b64decode(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==")


def encode(data: bytes) -> str:
    return base64.urlsafe_b64encode(zlib.compress(data)).decode("ascii")


def make_csv(files) -> str:
    """files: Liste von (pfad, bytes, mime, user, uid, group, gid, mode)"""
    out = io.StringIO()
    w = csv.writer(out, lineterminator="\r\n")
    w.writerow(COLUMNS)
    for i, (path, data, mime, user, uid, group, gid, mode) in enumerate(files, 1):
        packed = zlib.compress(data)
        w.writerow([i, hashlib.md5(data).hexdigest(), path, len(data), mime, mode, uid, user,
                    gid, group, 1700000000 + i, len(packed),
                    round(len(packed) / len(data) * 100, 2) if data else 0,
                    base64.urlsafe_b64encode(packed).decode("ascii")])
    return out.getvalue()


def sample_files():
    g = ("gamer", 999, "admin_L", 99, "0o100770")
    a = ("admin", 1001, "admin_L", 99, "0o100700")
    return [
        ("/opt/frigg/admin/projekt.txt", "Anna Beispiel, Klasse INF2a".encode(), "text/plain", *a),
        ("/opt/frigg/Files/gamer/game_shop/skins/neon_ninja.png", PNG_1PX, "image/png", *g),
        ("/opt/frigg/Files/gamer/game_shop/skins/kopie.png", PNG_1PX, "image/png", *g),
        ("/opt/frigg/Files/gamer/game_shop/taenze/taenze.json", b'{"taenze": []}', "application/json", *g),
        ("/opt/frigg/Files/gamer/game_shop/taenze/robo.clip.webm", bytes(range(256)) * 4, "video/webm", *g),
        ("/opt/frigg/Files/gamer/game_shop/sounds/beat.clip.weba", b"OggS-fake-audio" * 10, "audio/webm", *g),
        ("/opt/frigg/Files/gamer/game_shop/evil.svg",
         b'<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>', "image/svg+xml", *g),
    ]


def import_csv(csv_text: str, db_path: Path):
    con = sqlite3.connect(db_path)
    con.executescript((FIXTURES / "schema_sqlite.sql").read_text(encoding="utf-8"))
    for row in csv.DictReader(io.StringIO(csv_text.lstrip("﻿"))):
        con.execute("insert or ignore into Usr values (?, ?)", (int(row["uid"]), row["user"]))
        con.execute("insert or ignore into Grp values (?, ?)", (int(row["gid"]), row["group"]))
        con.execute("insert or ignore into Type values (?)", (row["type"],))
        con.execute("insert or ignore into Data values (?, ?, ?, ?)",
                    (row["hash"], int(row["size"]), row["type"], row["encoded_data"]))
        con.execute("insert into Meta values (?, ?, ?, ?, ?, ?, ?, ?, ?)",
                    (row["path"], row["hash"], int(row["size"]), row["type"], row["mode"],
                     int(row["uid"]), int(row["gid"]), int(row["time"]),
                     float(row["compression_ratio"])))
    con.commit()
    con.close()


def sqlite_config(db_path: Path, base_cfg: str) -> str:
    """Die mitgelieferte Config auf SQLite umstellen."""
    text = re.sub(r"(?m)^  dsn: .*$", f"  dsn: 'DBI:SQLite:dbname={db_path.as_posix()}'", base_cfg, count=1)
    text = text.replace("'select version();'", "'select sqlite_version();'")
    text = text.replace('"insert ignore into Tag (name) values (?);"',
                        '"insert or ignore into Tag (name) values (?);"')
    text = text.replace('"insert ignore into DataTag (data, tag) values (?, ?);"',
                        '"insert or ignore into DataTag (data, tag) values (?, ?);"')
    return text
