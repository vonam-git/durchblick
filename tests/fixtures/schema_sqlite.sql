-- Minimales Testschema für SQLite (nur für die automatischen Tests).
-- HINWEIS FÜR LEHRPERSONEN: Dies ist eine mögliche Lösung des Schemas.
-- Für die Version der Lernenden kann der Ordner tests/ entfernt werden.
CREATE TABLE Usr (uid INTEGER PRIMARY KEY, name TEXT NOT NULL UNIQUE);
CREATE TABLE Grp (gid INTEGER PRIMARY KEY, name TEXT NOT NULL UNIQUE);
CREATE TABLE Type (name TEXT PRIMARY KEY);
CREATE TABLE Data (
  digest TEXT PRIMARY KEY,
  size INTEGER NOT NULL,
  type TEXT REFERENCES Type(name),
  content TEXT NOT NULL
);
CREATE TABLE Meta (
  path TEXT PRIMARY KEY,
  digest TEXT NOT NULL REFERENCES Data(digest),
  size INTEGER NOT NULL,
  type TEXT REFERENCES Type(name),
  perm TEXT, usr INTEGER REFERENCES Usr(uid), grp INTEGER REFERENCES Grp(gid),
  time INTEGER, compression REAL
);
CREATE TABLE Tag (name TEXT PRIMARY KEY);
CREATE TABLE DataTag (
  data TEXT NOT NULL REFERENCES Data(digest),
  tag TEXT NOT NULL REFERENCES Tag(name),
  PRIMARY KEY (data, tag)
);
