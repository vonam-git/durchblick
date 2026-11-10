'use strict';

/* ============================================================
   CSV-Prüfung

   Liest eine CSV-Datei als Stream ein (auch mehrere hundert MB),
   zerlegt sie mit einem eigenen CSV-Parser nach RFC 4180 und
   prüft Kopfzeile, Spaltenanzahl, Formate, Plausibilität und
   optional den Inhalt (Base64 -> zlib -> Grösse und MD5).
   ============================================================ */

const EXPECTED_COLUMNS = ['count', 'hash', 'path', 'size', 'type', 'mode',
  'uid', 'user', 'gid', 'group', 'time', 'compressed_size',
  'compression_ratio', 'encoded_data'];

const SEV_LABEL = { error: 'Fehler', warn: 'Warnung', info: 'Hinweis' };
const SEV_ORDER = { error: 0, warn: 1, info: 2 };

const HIDDEN_TXT_RE = /\/Files\/gamer\/wesnoth-1\.14\.7\/data\/(\d{8})\.txt$/;
const HIDDEN_HTML_RE = /\/Files\/admin\/licenses\/hidden\/(\d{8})\.html$/;
const RE_INT = /^\d+$/;
const RE_MD5 = /^[0-9a-f]{32}$/;
const RE_B64URL = /^[A-Za-z0-9_-]*={0,2}$/;
const EXCEL_CELL_LIMIT = 32767;

/* Kurze, lesbare Darstellung eines Feldwertes für Meldungen */
function shortVal(v) {
  if (v === undefined || v === null) return '(fehlt)';
  if (v === '') return '(leer)';
  const s = String(v);
  return s.length > 60 ? '«' + s.slice(0, 57) + '…» (' + s.length + ' Zeichen)' : '«' + s + '»';
}

function ddmmyyyyValid(s) {
  const d = +s.slice(0, 2), m = +s.slice(2, 4), y = +s.slice(4, 8);
  const dt = new Date(y, m - 1, d);
  return dt.getFullYear() === y && dt.getMonth() === m - 1 && dt.getDate() === d &&
    y >= 1900 && dt <= new Date();
}

function b64urlToBytes(s) {
  const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/'));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function inflateZlib(bytes) {
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/* ------------------------------------------------------------
   Streaming-CSV-Parser
   Verarbeitet beliebig zerstückelte Textblöcke und liefert
   fertige Datensätze mit ihrer Zeilennummer in der Datei.
   ------------------------------------------------------------ */
class CsvStreamParser {
  constructor() {
    this.field = '';
    this.record = [];
    this.inQuotes = false;
    this.pendingQuote = false; // " am Blockende innerhalb eines Feldes
    this.afterQuote = false;   // direkt nach schliessendem "
    this.pendingCR = false;    // CR am Blockende
    this.line = 1;
    this.recordLine = 1;
    this.out = [];
    this.problems = [];
    this.eol = { crlf: 0, lf: 0, cr: 0 };
    this.noFinalNewline = false;
  }

  problem(code, line) { this.problems.push({ code, line }); }

  endField() {
    this.record.push(this.field);
    this.field = '';
    this.afterQuote = false;
  }

  endRecord() {
    this.endField();
    this.out.push({ fields: this.record, line: this.recordLine });
    this.record = [];
    this.recordLine = this.line;
  }

  feed(s) {
    const n = s.length;
    let i = 0, start = 0;

    if (this.pendingCR) {
      this.pendingCR = false;
      if (n > 0 && s.charCodeAt(0) === 10) { this.eol.crlf++; i = start = 1; }
      else this.eol.cr++;
    }
    if (this.pendingQuote) {
      this.pendingQuote = false;
      if (n > 0 && s.charCodeAt(0) === 34) { this.field += '"'; i = start = 1; }
      else { this.inQuotes = false; this.afterQuote = true; }
    }

    while (i < n) {
      const c = s.charCodeAt(i);

      if (this.inQuotes) {
        if (c === 34) {
          this.field += s.slice(start, i);
          if (i + 1 < n) {
            if (s.charCodeAt(i + 1) === 34) { this.field += '"'; i += 2; }
            else { this.inQuotes = false; this.afterQuote = true; i++; }
          } else {
            this.pendingQuote = true; i++;
          }
          start = i;
          continue;
        }
        if (c === 10) this.line++;
        i++;
        continue;
      }

      if (c === 44) { // Komma
        this.field += s.slice(start, i);
        this.endField();
        start = ++i;
        continue;
      }
      if (c === 13 || c === 10) { // Zeilenende
        this.field += s.slice(start, i);
        this.line++;
        this.endRecord();
        if (c === 13) {
          if (i + 1 < n) {
            if (s.charCodeAt(i + 1) === 10) { this.eol.crlf++; i += 2; }
            else { this.eol.cr++; i++; }
          } else { this.pendingCR = true; i++; }
        } else { this.eol.lf++; i++; }
        start = i;
        continue;
      }
      if (c === 34) { // Anführungszeichen ausserhalb eines Feldes in "..."
        if (i === start && this.field === '' && !this.afterQuote) {
          this.inQuotes = true;
          start = ++i;
          continue;
        }
        this.problem('quote_mid', this.line);
        i++;
        continue;
      }
      if (this.afterQuote) {
        this.problem('after_quote', this.line);
        this.afterQuote = false;
      }
      i++;
    }
    this.field += s.slice(start, n);
  }

  end() {
    if (this.pendingQuote) { this.pendingQuote = false; this.inQuotes = false; this.afterQuote = true; }
    if (this.inQuotes) this.problem('unclosed_quote', this.recordLine);
    if (this.field !== '' || this.record.length > 0 || this.afterQuote) {
      this.noFinalNewline = true;
      this.record.push(this.field);
      this.out.push({ fields: this.record, line: this.recordLine });
      this.record = [];
      this.field = '';
    }
  }
}

/* ------------------------------------------------------------
   Prüflogik
   ------------------------------------------------------------ */
class CsvChecker {
  constructor(deep) {
    this.deep = deep;
    this.counts = { error: 0, warn: 0, info: 0 };
    this.findings = new Map();  // code -> Gruppe
    this.details = [];
    this.maxDetails = 1000;
    this.truncated = false;

    this.bom = false;
    this.header = null;
    this.col = null;
    this.headerUsable = false;
    this.headerOrderOk = false;
    this.delimiter = ',';

    this.rows = 0;
    this.expectedCount = 1;
    this.deepChecked = 0;
    this.badUtf8Rows = 0;
    this.pendingEmpty = [];

    this.paths = new Map();       // path -> Zeile
    this.hashCount = new Map();   // hash -> Anzahl
    this.userUids = new Map();    // user -> Set(uid)
    this.uidUsers = new Map();    // uid -> Set(user)
    this.groupGids = new Map();   // group -> Set(gid)
    this.gidGroups = new Map();   // gid -> Set(group)
    this.hiddenTxt = null;
    this.hiddenHtml = null;
    this.eol = null;
    this.nowSec = Math.floor(Date.now() / 1000);
  }

  add(sev, code, title, line, col, detail) {
    this.counts[sev]++;
    let g = this.findings.get(code);
    if (!g) {
      g = { sev, code, title, count: 0, lines: [] };
      this.findings.set(code, g);
    }
    g.count++;
    if (line && g.lines.length < 5) g.lines.push(line);
    if (this.details.length < this.maxDetails) {
      this.details.push({ sev, code, title, line: line || '', col: col || '', detail: detail || '' });
    } else {
      this.truncated = true;
    }
  }

  drainParser(parser) {
    for (const p of parser.problems) {
      if (p.code === 'quote_mid') {
        this.add('error', 'quote_mid', 'Anführungszeichen mitten in einem Feld', p.line, '',
          'Ein Feld mit " muss komplett in Anführungszeichen stehen und " verdoppeln ("").');
      } else if (p.code === 'after_quote') {
        this.add('error', 'after_quote', 'Zeichen nach schliessendem Anführungszeichen', p.line, '',
          'Nach dem schliessenden " darf nur ein Komma oder ein Zeilenende folgen.');
      } else if (p.code === 'unclosed_quote') {
        this.add('error', 'unclosed_quote', 'Anführungszeichen wird nie geschlossen', p.line, '',
          'Ab dieser Zeile wird der Rest der Datei als ein einziges Feld gelesen.');
      }
    }
    parser.problems = [];
  }

  track(map, key, val) {
    let s = map.get(key);
    if (!s) { s = new Set(); map.set(key, s); }
    s.add(val);
  }

  checkHeader(f, line) {
    this.header = f;

    if (f.length === 1 && f[0].includes(';')) {
      this.delimiter = ';';
      this.add('error', 'delim_semicolon', 'Falsches Trennzeichen: Semikolon statt Komma', line, '',
        'Die Datei wurde vermutlich in Excel geöffnet und wieder gespeichert. Bitte die Original-CSV aus dem Datensatzgenerator verwenden.');
      return;
    }
    if (f.length === 1 && f[0].includes('\t')) {
      this.delimiter = 'Tab';
      this.add('error', 'delim_tab', 'Falsches Trennzeichen: Tabulator statt Komma', line, '',
        'Erwartet wird eine kommagetrennte Datei.');
      return;
    }

    const trimmed = f.map(h => h.trim());
    if (trimmed.some((h, i) => h !== f[i])) {
      this.add('warn', 'header_space', 'Leerzeichen in Spaltennamen', line, '',
        'Spaltennamen sollten keine Leerzeichen am Anfang oder Ende haben.');
    }

    this.col = {};
    trimmed.forEach((h, i) => {
      const k = h.toLowerCase();
      if (k in this.col) {
        this.add('warn', 'header_dup', 'Spaltenname doppelt vorhanden', line, h, 'Es wird die erste Spalte mit diesem Namen verwendet.');
      } else {
        this.col[k] = i;
      }
    });

    const missing = EXPECTED_COLUMNS.filter(c => !(c in this.col));
    if (missing.length) {
      if (RE_INT.test(trimmed[0]) && /^[0-9a-f]{32}$/i.test(trimmed[1] || '')) {
        this.add('error', 'header_none', 'Kopfzeile fehlt', line, '',
          'Die erste Zeile enthält bereits Daten. Erwartet wird: ' + EXPECTED_COLUMNS.join(','));
      } else {
        this.add('error', 'header_missing', 'Pflichtspalten fehlen in der Kopfzeile', line, '',
          'Fehlend: ' + missing.join(', ') + '. Gefunden: ' + trimmed.join(', '));
      }
      return;
    }

    if (trimmed.some(h => EXPECTED_COLUMNS.includes(h.toLowerCase()) && !EXPECTED_COLUMNS.includes(h))) {
      this.add('warn', 'header_case', 'Spaltennamen mit Grossbuchstaben', line, '',
        'Erwartet werden Kleinbuchstaben wie im Original (z.B. «count» statt «Count»).');
    }
    const extra = trimmed.filter(h => !EXPECTED_COLUMNS.includes(h.toLowerCase()));
    if (extra.length) {
      this.add('warn', 'header_extra', 'Zusätzliche Spalten vorhanden', line, '',
        'Nicht erwartet: ' + extra.join(', '));
    }
    this.headerOrderOk = trimmed.length === EXPECTED_COLUMNS.length &&
      EXPECTED_COLUMNS.every((c, i) => trimmed[i].toLowerCase() === c);
    if (!this.headerOrderOk && !extra.length) {
      this.add('warn', 'header_order', 'Spaltenreihenfolge weicht vom Original ab', line, '',
        'Beim Import mit LOAD DATA oder COPY werden Spalten über ihre Position zugeordnet. Erwartet: ' + EXPECTED_COLUMNS.join(','));
    }
    this.headerUsable = true;
  }

  async checkRecord(rec) {
    const f = rec.fields, line = rec.line;

    if (f.length === 1 && f[0] === '') { this.pendingEmpty.push(line); return; }
    if (this.pendingEmpty.length) {
      for (const l of this.pendingEmpty) {
        this.add('warn', 'empty_line', 'Leere Zeile mitten in der Datei', l, '',
          'Leere Zeilen können beim Import als fehlerhafte Datensätze gelten.');
      }
      this.pendingEmpty = [];
    }

    if (!this.header) { this.checkHeader(f, line); return; }
    this.rows++;
    if (!this.headerUsable) return;

    if (f.some(v => v.indexOf('�') !== -1)) {
      this.badUtf8Rows++;
      this.add('error', 'bad_utf8', 'Ungültige Zeichenkodierung (kein UTF-8)', line, '',
        'Die Zeile enthält Bytes, die kein gültiges UTF-8 sind. Die Datei wurde vermutlich in einer anderen Kodierung gespeichert (z.B. ANSI/Windows-1252).');
    }

    if (f.length !== this.header.length) {
      this.add('error', 'col_count', 'Falsche Anzahl Spalten', line, '',
        f.length + ' statt ' + this.header.length + ' Spalten. Häufige Ursache: Komma oder Zeilenumbruch in einem Feld ohne Anführungszeichen.');
      this.expectedCount = RE_INT.test(f[0]) ? Number(f[0]) + 1 : this.expectedCount + 1;
      return;
    }

    const v = name => f[this.col[name]];
    const countStr = v('count'), hash = v('hash'), path = v('path'), sizeStr = v('size');
    const type = v('type'), mode = v('mode'), uidStr = v('uid'), user = v('user');
    const gidStr = v('gid'), group = v('group'), timeStr = v('time');
    const csStr = v('compressed_size'), ratioStr = v('compression_ratio'), enc = v('encoded_data');

    // count
    if (!RE_INT.test(countStr)) {
      this.add('error', 'count_format', 'Laufnummer ist keine ganze Zahl', line, 'count', 'Gefunden: ' + shortVal(countStr));
      this.expectedCount++;
    } else {
      const c = Number(countStr);
      if (c !== this.expectedCount) {
        this.add('warn', 'count_seq', 'Laufnummer nicht fortlaufend', line, 'count',
          'Erwartet ' + this.expectedCount + ', gefunden ' + c + '.');
      }
      this.expectedCount = c + 1;
    }

    // hash
    let hashOk = false;
    if (RE_MD5.test(hash)) hashOk = true;
    else if (/^[0-9A-F]{32}$/i.test(hash)) {
      this.add('warn', 'hash_case', 'MD5-Hash in Grossbuchstaben', line, 'hash', 'Üblich sind Kleinbuchstaben wie im Original.');
      hashOk = true;
    } else {
      this.add('error', 'hash_format', 'Ungültiger MD5-Hash', line, 'hash',
        'Erwartet 32 Hexadezimalzeichen, gefunden ' + shortVal(hash) + '.');
    }
    if (hashOk) {
      const h = hash.toLowerCase();
      this.hashCount.set(h, (this.hashCount.get(h) || 0) + 1);
    }

    // path
    if (!path) {
      this.add('error', 'path_empty', 'Pfad fehlt', line, 'path', '');
    } else {
      if (path[0] !== '/') this.add('warn', 'path_slash', 'Pfad beginnt nicht mit /', line, 'path', shortVal(path));
      if (path.includes('\\')) this.add('warn', 'path_backslash', 'Pfad enthält Backslash (\\)', line, 'path', 'Erwartet werden Schrägstriche (/) wie unter Linux. ' + shortVal(path));
      if (path !== path.trim()) this.add('warn', 'path_space', 'Pfad mit Leerzeichen am Anfang oder Ende', line, 'path', shortVal(path));
      const prev = this.paths.get(path);
      if (prev) {
        this.add('error', 'path_dup', 'Pfad mehrfach vorhanden', line, 'path',
          'Bereits in Zeile ' + prev + ': ' + shortVal(path) + '. Der Pfad muss eindeutig sein (Primärschlüssel der Tabelle Meta).');
      } else {
        this.paths.set(path, line);
      }
      if (/^[=+\-@\t\r]/.test(path)) {
        this.add('warn', 'path_formula', 'Pfad beginnt mit =, +, - oder @ (CSV-Injection)', line, 'path',
          'Tabellenprogramme wie Excel könnten den Wert als Formel ausführen. ' + shortVal(path));
      }
      let m = path.match(HIDDEN_TXT_RE);
      if (m && !this.hiddenTxt) this.hiddenTxt = { date: m[1], line };
      m = path.match(HIDDEN_HTML_RE);
      if (m && !this.hiddenHtml) this.hiddenHtml = { date: m[1], line };
    }

    // size
    const size = RE_INT.test(sizeStr) ? Number(sizeStr) : null;
    if (size === null) this.add('error', 'size_format', 'Grösse (size) ist keine ganze Zahl', line, 'size', 'Gefunden: ' + shortVal(sizeStr));

    // type
    if (!type) {
      this.add('error', 'type_empty', 'Dateityp fehlt', line, 'type', '');
    } else if (type === 'unknown') {
      this.add('info', 'type_unknown', 'Dateityp unbekannt', line, 'type', 'Für ' + shortVal(path) + ' konnte kein MIME-Typ bestimmt werden.');
    } else if (!/^[a-z0-9][a-z0-9.+-]*\/[a-z0-9][a-z0-9.+-]*$/i.test(type)) {
      this.add('warn', 'type_format', 'Dateityp hat kein MIME-Format', line, 'type', 'Erwartet z.B. text/plain, gefunden ' + shortVal(type) + '.');
    }

    // mode
    if (!/^0o[0-7]+$/.test(mode)) {
      this.add('error', 'mode_format', 'Berechtigung nicht in Oktalnotation', line, 'mode',
        'Erwartet z.B. 0o100750, gefunden ' + shortVal(mode) + '.');
    } else if (!mode.startsWith('0o100')) {
      this.add('info', 'mode_type', 'Berechtigung beschreibt keine reguläre Datei', line, 'mode',
        'Reguläre Dateien beginnen mit 0o100, gefunden ' + shortVal(mode) + '.');
    }

    // uid, user, gid, group
    const uidOk = RE_INT.test(uidStr), gidOk = RE_INT.test(gidStr);
    if (!uidOk) this.add('error', 'uid_format', 'uid ist keine ganze Zahl', line, 'uid', 'Gefunden: ' + shortVal(uidStr));
    if (!gidOk) this.add('error', 'gid_format', 'gid ist keine ganze Zahl', line, 'gid', 'Gefunden: ' + shortVal(gidStr));
    if (!user) this.add('error', 'user_empty', 'Benutzername fehlt', line, 'user', '');
    if (!group) this.add('error', 'group_empty', 'Gruppenname fehlt', line, 'group', '');
    if (uidOk && user) { this.track(this.userUids, user, uidStr); this.track(this.uidUsers, uidStr, user); }
    if (gidOk && group) { this.track(this.groupGids, group, gidStr); this.track(this.gidGroups, gidStr, group); }

    if (path) {
      const rule = ownerForPath(path);
      if (rule !== DEFAULT_OWNER) {
        const diffs = [];
        if (user !== rule.user) diffs.push('user ' + shortVal(user) + ' statt «' + rule.user + '»');
        if (uidStr !== String(rule.uid)) diffs.push('uid ' + shortVal(uidStr) + ' statt «' + rule.uid + '»');
        if (group !== rule.group) diffs.push('group ' + shortVal(group) + ' statt «' + rule.group + '»');
        if (gidStr !== String(rule.gid)) diffs.push('gid ' + shortVal(gidStr) + ' statt «' + rule.gid + '»');
        if (mode !== rule.mode) diffs.push('mode ' + shortVal(mode) + ' statt «' + rule.mode + '»');
        if (diffs.length) {
          this.add('warn', 'owner_rule', 'Besitzer oder Berechtigung passt nicht zum Benutzerverzeichnis', line, 'user',
            diffs.join(', ') + '.');
        }
      }
    }

    // time
    if (!RE_INT.test(timeStr)) {
      const hint = /[.:\/-]/.test(timeStr) ? ' Der Wert sieht wie ein Datum aus, vermutlich von Excel umformatiert.' : '';
      this.add('error', 'time_format', 'Zeitstempel ist keine ganze Zahl', line, 'time',
        'Erwartet ein Unix-Zeitstempel in Sekunden, gefunden ' + shortVal(timeStr) + '.' + hint);
    } else {
      const t = Number(timeStr);
      if (t > this.nowSec + 86400) {
        this.add('warn', 'time_future', 'Zeitstempel liegt in der Zukunft', line, 'time',
          new Date(t * 1000).toLocaleString('de-CH') + (t > 1e11 ? ' (vermutlich Millisekunden statt Sekunden)' : ''));
      } else if (t < 315532800) {
        this.add('warn', 'time_old', 'Zeitstempel vor 1980', line, 'time', new Date(t * 1000).toLocaleString('de-CH'));
      }
    }

    // compressed_size
    const cs = RE_INT.test(csStr) ? Number(csStr) : null;
    if (cs === null) this.add('error', 'cs_format', 'compressed_size ist keine ganze Zahl', line, 'compressed_size', 'Gefunden: ' + shortVal(csStr));

    // compression_ratio
    if (!/^\d+(\.\d+)?$/.test(ratioStr)) {
      const hint = /^\d+,\d+$/.test(ratioStr) ? ' Dezimalkomma statt Dezimalpunkt, vermutlich von Excel umformatiert.' : '';
      this.add('error', 'ratio_format', 'Kompressionsrate ist keine Zahl', line, 'compression_ratio',
        'Gefunden: ' + shortVal(ratioStr) + '.' + hint);
    } else if (size !== null && cs !== null) {
      const exp = size > 0 ? Math.round((cs / size) * 10000) / 100 : 0;
      if (Math.abs(exp - Number(ratioStr)) > 0.011) {
        this.add('warn', 'ratio_calc', 'Kompressionsrate passt nicht zu size und compressed_size', line, 'compression_ratio',
          'Erwartet ' + exp + ', gefunden ' + ratioStr + '.');
      }
    }

    // encoded_data
    let encOk = false;
    if (enc === '') {
      this.add('error', 'enc_empty', 'Kodierter Inhalt fehlt', line, 'encoded_data',
        'Auch eine leere Datei hat einen zlib-Inhalt (eJwDAAAAAAE=).');
    } else if (/[+/]/.test(enc) && /^[A-Za-z0-9+/_=-]*$/.test(enc)) {
      this.add('error', 'enc_std', 'Standard-Base64 statt URL-safe Base64', line, 'encoded_data',
        'Enthält + oder /. Erwartet werden - und _ wie bei base64.urlsafe_b64encode.');
    } else if (!RE_B64URL.test(enc)) {
      const bad = enc.match(/[^A-Za-z0-9_=-]/);
      this.add('error', 'enc_chars', 'Ungültige Zeichen in encoded_data', line, 'encoded_data',
        bad ? 'Erstes ungültiges Zeichen: «' + bad[0] + '» an Position ' + (bad.index + 1) + '.' : 'Gleichheitszeichen nur am Ende erlaubt.');
    } else if (enc.length % 4 !== 0) {
      this.add('error', 'enc_len', 'Base64-Länge ungültig (nicht durch 4 teilbar)', line, 'encoded_data',
        enc.length === EXCEL_CELL_LIMIT
          ? 'Genau 32 767 Zeichen: Der Inhalt wurde vermutlich von Excel abgeschnitten (maximale Zellenlänge).'
          : 'Länge ' + enc.length + ' Zeichen. Der Inhalt ist vermutlich abgeschnitten.');
    } else {
      const pad = enc.endsWith('==') ? 2 : enc.endsWith('=') ? 1 : 0;
      const decLen = enc.length / 4 * 3 - pad;
      if (cs !== null && decLen !== cs) {
        this.add('error', 'enc_size', 'Länge von encoded_data passt nicht zu compressed_size', line, 'encoded_data',
          'Dekodiert ' + decLen + ' Bytes, compressed_size sagt ' + cs + ' Bytes.');
      }
      encOk = true;
    }

    if (this.deep && encOk) await this.deepCheck(line, enc, size, hashOk ? hash.toLowerCase() : null, path);
  }

  async deepCheck(line, enc, size, hash, path) {
    let bytes;
    try {
      bytes = b64urlToBytes(enc);
    } catch (e) {
      this.add('error', 'enc_decode', 'encoded_data lässt sich nicht dekodieren', line, 'encoded_data', '');
      return;
    }
    if (bytes.length < 2 || (bytes[0] & 0x0f) !== 8 || ((bytes[0] << 8) | bytes[1]) % 31 !== 0) {
      this.add('error', 'zlib_header', 'Kein gültiges zlib-Format', line, 'encoded_data',
        'Die Daten müssen mit zlib komprimiert sein (wie Pythons zlib.compress), sie beginnen normalerweise mit «eJ».');
      return;
    }
    let data;
    try {
      data = await inflateZlib(bytes);
    } catch (e) {
      this.add('error', 'zlib_inflate', 'Entpacken fehlgeschlagen, Daten beschädigt', line, 'encoded_data',
        'Der komprimierte Inhalt ist unvollständig oder verändert.');
      return;
    }
    this.deepChecked++;

    if (size !== null && data.length !== size) {
      this.add('error', 'content_size', 'Entpackte Grösse stimmt nicht mit size überein', line, 'size',
        'Entpackt ' + data.length + ' Bytes, size sagt ' + size + ' Bytes.');
    }
    if (hash) {
      const h = md5Of(data);
      if (h !== hash) {
        this.add('error', 'content_hash', 'MD5-Hash stimmt nicht mit dem Inhalt überein', line, 'hash',
          'Berechnet ' + h + ', in der CSV steht ' + hash + '.');
      }
    }
    const m = path ? path.match(HIDDEN_TXT_RE) : null;
    if (m) {
      const d = m[1];
      const expected = 'Geburtsdatum: ' + d.slice(0, 2) + '.' + d.slice(2, 4) + '.' + d.slice(4);
      const text = new TextDecoder().decode(data);
      if (!text.includes(expected)) {
        this.add('warn', 'hidden_content', 'Inhalt der Geburtstagsdatei passt nicht zum Dateinamen', line, 'encoded_data',
          'Erwartet wurde die Zeile «' + expected + '».');
      }
    }
  }

  finish(parser, file) {
    this.eol = parser.eol;

    if (!this.header) {
      this.add('error', 'empty_file', 'Die Datei ist leer', '', '', 'Es wurde weder eine Kopfzeile noch ein Datensatz gefunden.');
    } else if (this.headerUsable && this.rows === 0) {
      this.add('error', 'no_rows', 'Keine Datensätze vorhanden', '', '', 'Die Datei enthält nur die Kopfzeile.');
    }

    if (this.pendingEmpty.length) {
      this.add('info', 'trailing_empty', 'Leere Zeilen am Dateiende', this.pendingEmpty[0], '',
        this.pendingEmpty.length + ' leere Zeile(n). Je nach Importwerkzeug entsteht dadurch ein leerer Datensatz.');
    }
    if (parser.noFinalNewline && this.header) {
      this.add('info', 'no_final_newline', 'Letzte Zeile ohne Zeilenumbruch', '', '', 'Für den Import meist unproblematisch.');
    }

    const types = ['crlf', 'lf', 'cr'].filter(k => this.eol[k] > 0);
    if (types.length > 1) {
      this.add('warn', 'eol_mixed', 'Gemischte Zeilenenden', '', '',
        'CRLF: ' + this.eol.crlf + ', LF: ' + this.eol.lf + ', CR: ' + this.eol.cr + '. Die Datei wurde vermutlich von Hand bearbeitet.');
    } else if (types[0] === 'lf') {
      this.add('info', 'eol_lf', 'Zeilenenden LF (Linux) statt CRLF', '', '',
        'Für den Import meist unproblematisch. Bei LOAD DATA die Angabe LINES TERMINATED BY passend wählen.');
    } else if (types[0] === 'cr') {
      this.add('warn', 'eol_cr', 'Zeilenenden nur CR (altes Mac-Format)', '', '', 'Viele Importwerkzeuge erkennen diese Zeilenenden nicht.');
    }

    if (!this.bom && this.header) {
      this.add('info', 'no_bom', 'Kein UTF-8-BOM am Dateianfang', '', '',
        'Excel zeigt Umlaute ohne BOM eventuell falsch an. Für den Datenbankimport unproblematisch.');
    }
    if (!/\.csv$/i.test(file.name)) {
      this.add('warn', 'ext', 'Dateiendung ist nicht .csv', '', '', shortVal(file.name));
    }

    for (const [u, ids] of this.userUids) {
      if (ids.size > 1) this.add('warn', 'user_uid', 'Benutzer mit mehreren uid', '', 'uid',
        '«' + u + '» hat uid ' + [...ids].join(', ') + '. Beim Import in die Tabelle Usr führt das zu Konflikten.');
    }
    for (const [id, names] of this.uidUsers) {
      if (names.size > 1) this.add('warn', 'uid_user', 'uid mit mehreren Benutzernamen', '', 'user',
        'uid ' + id + ' gehört zu ' + [...names].map(n => '«' + n + '»').join(', ') + '.');
    }
    for (const [g, ids] of this.groupGids) {
      if (ids.size > 1) this.add('warn', 'group_gid', 'Gruppe mit mehreren gid', '', 'gid',
        '«' + g + '» hat gid ' + [...ids].join(', ') + '. Beim Import in die Tabelle Grp führt das zu Konflikten.');
    }
    for (const [id, names] of this.gidGroups) {
      if (names.size > 1) this.add('warn', 'gid_group', 'gid mit mehreren Gruppennamen', '', 'group',
        'gid ' + id + ' gehört zu ' + [...names].map(n => '«' + n + '»').join(', ') + '.');
    }

    this.dupHashes = 0;
    for (const n of this.hashCount.values()) if (n > 1) this.dupHashes++;
    if (this.dupHashes > 0) {
      this.add('info', 'hash_dup', 'Gleicher Inhalt in mehreren Dateien', '', 'hash',
        this.dupHashes + ' Hashwert(e) kommen mehrfach vor. Das ist erlaubt: In der Tabelle Data wird jeder Inhalt nur einmal gespeichert, in Meta stehen alle Pfade.');
    }

    if (this.headerUsable && this.rows > 0) {
      const t = this.hiddenTxt, h = this.hiddenHtml;
      if (!t && !h) {
        this.add('warn', 'hidden_missing', 'Versteckte Geburtstagsdateien nicht gefunden', '', 'path',
          'Erwartet unter …/Files/gamer/wesnoth-1.14.7/data/TTMMJJJJ.txt und …/Files/admin/licenses/hidden/TTMMJJJJ.html.');
      } else {
        if (!t) this.add('warn', 'hidden_txt', 'Geburtstagsdatei (.txt) fehlt', '', 'path', 'Nur die HTML-Datei wurde gefunden.');
        if (!h) this.add('warn', 'hidden_html', 'Geburtstagsdatei (.html) fehlt', '', 'path', 'Nur die Textdatei wurde gefunden.');
        if (t && h && t.date !== h.date) {
          this.add('warn', 'hidden_mismatch', 'Geburtstagsdateien mit unterschiedlichem Datum', t.line, 'path',
            'Textdatei ' + t.date + ', HTML-Datei ' + h.date + '.');
        }
        const any = t || h;
        if (!ddmmyyyyValid(any.date)) {
          this.add('warn', 'hidden_date', 'Ungültiges Datum im Namen der Geburtstagsdatei', any.line, 'path', any.date);
        }
      }
    }
  }

  get status() {
    if (this.counts.error > 0) return 'err';
    if (this.counts.warn > 0) return 'warn';
    return 'ok';
  }
}

/* ------------------------------------------------------------
   Ablauf der Prüfung
   ------------------------------------------------------------ */
async function checkCsvFile(file, deep, onProgress, isCancelled) {
  const ck = new CsvChecker(deep);
  const parser = new CsvStreamParser();
  const reader = file.stream().getReader();
  const decoder = new TextDecoder('utf-8', { ignoreBOM: true });
  let first = true, bytesRead = 0, lastYield = performance.now();

  while (true) {
    const { done, value } = await reader.read();
    let text;
    if (done) text = decoder.decode();
    else { bytesRead += value.length; text = decoder.decode(value, { stream: true }); }

    if (first && text.length) {
      first = false;
      if (text.charCodeAt(0) === 0xFEFF) { ck.bom = true; text = text.slice(1); }
    }
    parser.feed(text);
    if (done) parser.end();
    ck.drainParser(parser);

    const recs = parser.out;
    parser.out = [];
    for (const r of recs) {
      await ck.checkRecord(r);
      if (performance.now() - lastYield > 60) {
        onProgress(bytesRead, ck);
        await new Promise(res => setTimeout(res, 0));
        lastYield = performance.now();
        if (isCancelled()) { try { await reader.cancel(); } catch (e) {} return null; }
      }
    }
    if (performance.now() - lastYield > 60) {
      onProgress(bytesRead, ck);
      await new Promise(res => setTimeout(res, 0));
      lastYield = performance.now();
    }
    if (isCancelled()) { try { await reader.cancel(); } catch (e) {} return null; }
    if (done) break;
  }
  ck.finish(parser, file);
  onProgress(file.size, ck);
  return ck;
}

/* ------------------------------------------------------------
   Oberfläche der CSV-Prüfung
   ------------------------------------------------------------ */
document.addEventListener('DOMContentLoaded', () => {
  const $ = id => document.getElementById(id);
  const modeTabs = { compress: $('tabCompress'), generate: $('tabGenerate'), check: $('tabCheck') };
  const modeViews = { compress: $('viewCompress'), generate: $('viewGenerate'), check: $('viewCheck') };
  const dropZone = $('csvDropZone'), csvInput = $('csvInput');
  const preview = $('csvPreview'), previewName = $('csvPreviewName'), previewMeta = $('csvPreviewMeta');
  const checkBtn = $('checkBtn'), deepCheck = $('deepCheck');
  const inputCard = $('checkInputCard'), progressCard = $('checkProgressCard');
  const resultCard = $('checkResultCard'), errorCard = $('checkErrorCard');

  let selected = null;
  let running = false;
  let cancelled = false;
  let lastResult = null;
  let filter = 'all';

  /* Unterreiter der Werkstatt: compress | generate | check */
  function setMode(mode) {
    for (const k of Object.keys(modeTabs)) {
      const on = k === mode;
      modeViews[k].hidden = !on;
      modeTabs[k].classList.toggle('active', on);
      modeTabs[k].setAttribute('aria-selected', String(on));
    }
  }
  window.werkstattMode = setMode;
  for (const k of Object.keys(modeTabs)) modeTabs[k].addEventListener('click', () => setMode(k));

  function setFile(file) {
    if (!/\.(csv|txt)$/i.test(file.name)) {
      showCheckError('Bitte eine CSV-Datei auswählen (Endung .csv).');
      return;
    }
    selected = file;
    previewName.textContent = '🧾 ' + file.name;
    previewMeta.textContent = formatFileSize(file.size);
    preview.hidden = false;
    dropZone.style.display = 'none';
    errorCard.hidden = true;
    resultCard.hidden = true;
    updateBtn();
  }

  function clearFile() {
    selected = null;
    csvInput.value = '';
    preview.hidden = true;
    dropZone.style.display = '';
    updateBtn();
  }

  function updateBtn() { checkBtn.disabled = running || !selected; }

  dropZone.addEventListener('click', () => csvInput.click());
  csvInput.addEventListener('change', e => { if (e.target.files.length) setFile(e.target.files[0]); });
  dropZone.addEventListener('dragover', e => { e.preventDefault(); dropZone.classList.add('dragover'); });
  dropZone.addEventListener('dragleave', () => dropZone.classList.remove('dragover'));
  dropZone.addEventListener('drop', e => {
    e.preventDefault();
    dropZone.classList.remove('dragover');
    const f = Array.from(e.dataTransfer.files)[0];
    if (f) setFile(f);
  });
  $('csvRemove').addEventListener('click', () => { clearFile(); errorCard.hidden = true; resultCard.hidden = true; });

  checkBtn.addEventListener('click', () => runCheck());
  $('checkCancel').addEventListener('click', () => { cancelled = true; });
  $('checkAgainBtn').addEventListener('click', () => {
    resultCard.hidden = true;
    clearFile();
    inputCard.scrollIntoView({ behavior: 'smooth' });
  });
  $('checkRetryBtn').addEventListener('click', () => { errorCard.hidden = true; });
  $('reportBtn').addEventListener('click', downloadReport);

  /* Vom Generator aus aufrufbar */
  window.startCsvCheck = file => {
    setMode('check');
    setFile(file);
    runCheck();
  };

  function showCheckError(msg) {
    progressCard.hidden = true;
    $('checkErrorMessage').textContent = msg;
    errorCard.hidden = false;
  }

  async function runCheck() {
    if (running || !selected) return;
    if (typeof DecompressionStream === 'undefined' && deepCheck.checked) {
      showCheckError('Dieser Browser unterstützt die benötigte Dekompression nicht. Bitte einen aktuellen Chrome, Edge oder Firefox verwenden oder die Inhaltsprüfung abwählen.');
      return;
    }
    running = true;
    cancelled = false;
    updateBtn();
    resultCard.hidden = true;
    errorCard.hidden = true;
    progressCard.hidden = false;
    setProgress(0, 'Prüfe Datensätze...', '');

    const file = selected;
    const startedAt = performance.now();
    try {
      const ck = await checkCsvFile(file, deepCheck.checked, (done, ck) => {
        const pct = file.size > 0 ? Math.min(100, Math.round(done / file.size * 100)) : 100;
        let detail = ck.rows.toLocaleString('de-CH') + ' Datensätze - ' +
          formatFileSize(done) + ' / ' + formatFileSize(file.size);
        const elapsed = (performance.now() - startedAt) / 1000;
        if (done > 0 && elapsed > 2 && done < file.size) {
          const speed = done / elapsed;
          detail += ' - noch ca. ' + formatDuration((file.size - done) / speed);
        }
        if (ck.counts.error) detail += ' - ' + ck.counts.error.toLocaleString('de-CH') + ' Fehler bisher';
        setProgress(pct, 'Prüfe Datensätze...', detail);
      }, () => cancelled);

      progressCard.hidden = true;
      if (!ck) {
        showCheckError('Die Prüfung wurde abgebrochen.');
        return;
      }
      lastResult = { ck, file, deep: deepCheck.checked, when: new Date() };
      filter = 'all';
      renderResult();
    } catch (err) {
      showCheckError('Die Datei konnte nicht geprüft werden: ' + err.message);
    } finally {
      running = false;
      updateBtn();
    }
  }

  function setProgress(pct, phase, detail) {
    $('checkBar').style.width = pct + '%';
    $('checkPercent').textContent = pct + '%';
    $('checkPhase').textContent = phase;
    $('checkDetail').textContent = detail;
  }

  /* ----- Darstellung ----- */
  const esc = s => String(s).replace(/[&<>"']/g,
    c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const num = n => Number(n).toLocaleString('de-CH');

  function factsFor(r) {
    const ck = r.ck;
    const facts = [];
    const ok = '✅', warn = '⚠️', bad = '❌', neutral = '•';

    facts.push([neutral, 'Datei', r.file.name + ' (' + formatFileSize(r.file.size) + ')']);
    facts.push([ck.badUtf8Rows ? bad : ok, 'Kodierung',
      (ck.badUtf8Rows ? 'fehlerhaft, ' + num(ck.badUtf8Rows) + ' Zeile(n) kein gültiges UTF-8' : 'UTF-8') +
      (ck.bom ? ' mit BOM' : ' ohne BOM')]);

    const e = ck.eol || { crlf: 0, lf: 0, cr: 0 };
    const eolTypes = ['crlf', 'lf', 'cr'].filter(k => e[k] > 0);
    const eolText = eolTypes.length > 1 ? 'gemischt (CRLF ' + e.crlf + ', LF ' + e.lf + ', CR ' + e.cr + ')'
      : eolTypes[0] === 'crlf' ? 'CRLF (Windows)' : eolTypes[0] === 'lf' ? 'LF (Linux/macOS)'
      : eolTypes[0] === 'cr' ? 'CR (altes Mac-Format)' : 'keine (nur eine Zeile)';
    facts.push([eolTypes.length > 1 || eolTypes[0] === 'cr' ? warn : ok, 'Zeilenenden', eolText]);

    facts.push([ck.delimiter === ',' ? ok : bad, 'Trennzeichen', ck.delimiter === ',' ? 'Komma' : ck.delimiter]);

    if (ck.header) {
      facts.push([ck.headerUsable ? (ck.headerOrderOk ? ok : warn) : bad, 'Spalten',
        ck.headerUsable
          ? ck.header.length + (ck.headerOrderOk ? ', Reihenfolge wie im Original' : ', Reihenfolge oder Anzahl weicht ab')
          : 'Kopfzeile unbrauchbar']);
    }
    facts.push([ck.rows > 0 ? ok : bad, 'Datensätze', num(ck.rows)]);
    facts.push([r.deep ? (ck.deepChecked === ck.rows ? ok : warn) : neutral, 'Inhaltsprüfung',
      r.deep ? num(ck.deepChecked) + ' von ' + num(ck.rows) + ' Inhalten entpackt und geprüft' : 'nicht durchgeführt']);

    if (ck.userUids.size) {
      const users = [...ck.userUids].map(([u, ids]) => u + ' (' + [...ids].join('/') + ')').join(', ');
      facts.push([[...ck.userUids.values()].some(s => s.size > 1) ? warn : ok, 'Benutzer', users]);
    }
    if (ck.groupGids.size) {
      const groups = [...ck.groupGids].map(([g, ids]) => g + ' (' + [...ids].join('/') + ')').join(', ');
      facts.push([[...ck.groupGids.values()].some(s => s.size > 1) ? warn : ok, 'Gruppen', groups]);
    }
    if (ck.headerUsable && ck.rows > 0) {
      const t = ck.hiddenTxt, h = ck.hiddenHtml;
      let txt, icon;
      if (t && h) {
        const d = t.date;
        txt = 'beide gefunden, Datum ' + d.slice(0, 2) + '.' + d.slice(2, 4) + '.' + d.slice(4) + ' (Zeilen ' + t.line + ' und ' + h.line + ')';
        icon = t.date === h.date ? ok : warn;
      } else if (t || h) {
        txt = 'nur ' + (t ? 'Textdatei' : 'HTML-Datei') + ' gefunden';
        icon = warn;
      } else { txt = 'nicht gefunden'; icon = warn; }
      facts.push([icon, 'Geburtstagsdateien', txt]);
      facts.push([neutral, 'Gleiche Inhalte', ck.dupHashes ? num(ck.dupHashes) + ' Hashwert(e) mehrfach' : 'keine']);
    }
    return facts;
  }

  function renderResult() {
    const { ck, deep } = lastResult;
    const st = ck.status;
    const banner = $('checkBanner');
    banner.className = 'status-banner ' + st;
    if (st === 'err') {
      $('bannerIcon').textContent = '❌';
      $('bannerTitle').textContent = 'Die CSV-Datei enthält Fehler';
      $('bannerSub').textContent = num(ck.counts.error) + ' Fehler gefunden. Vor dem Import in die Datenbank beheben oder die CSV neu generieren.';
    } else if (st === 'warn') {
      $('bannerIcon').textContent = '⚠️';
      $('bannerTitle').textContent = 'Die CSV-Datei ist gültig, mit Warnungen';
      $('bannerSub').textContent = 'Ein Import ist möglich. Die Warnungen zeigen Abweichungen vom erwarteten Aufbau.';
    } else {
      $('bannerIcon').textContent = '✅';
      $('bannerTitle').textContent = 'Die CSV-Datei ist gültig';
      $('bannerSub').textContent = deep
        ? 'Aufbau und Inhalte aller Datensätze sind in Ordnung.'
        : 'Der Aufbau ist in Ordnung. Die Inhalte wurden nicht entpackt.';
    }

    $('crRows').textContent = num(ck.rows);
    $('crErrors').textContent = num(ck.counts.error);
    $('crWarns').textContent = num(ck.counts.warn);
    $('crInfos').textContent = num(ck.counts.info);

    $('crFacts').innerHTML = factsFor(lastResult).map(([i, k, v]) =>
      '<li><span>' + i + '</span><span class="k">' + esc(k) + '</span><span class="v">' + esc(v) + '</span></li>').join('');

    const groups = [...ck.findings.values()].sort((a, b) =>
      SEV_ORDER[a.sev] - SEV_ORDER[b.sev] || b.count - a.count);
    $('crGroupsWrap').hidden = groups.length === 0;
    $('crGroups').innerHTML = '<thead><tr><th>Art</th><th>Befund</th><th class="num">Anzahl</th><th>Zeilen</th></tr></thead><tbody>' +
      groups.map(g => '<tr><td><span class="sev ' + g.sev + '">' + SEV_LABEL[g.sev] + '</span></td><td>' + esc(g.title) +
        '</td><td class="num">' + num(g.count) + '</td><td>' +
        (g.lines.length ? esc(g.lines.join(', ')) + (g.count > g.lines.length ? ', …' : '') : '–') +
        '</td></tr>').join('') + '</tbody>';

    renderFilter();
    renderDetails();
    resultCard.hidden = false;
    resultCard.scrollIntoView({ behavior: 'smooth' });
  }

  function renderFilter() {
    const ck = lastResult.ck;
    const total = ck.counts.error + ck.counts.warn + ck.counts.info;
    $('crDetailsWrap').hidden = total === 0;
    const opts = [['all', 'Alle', total], ['error', 'Fehler', ck.counts.error],
      ['warn', 'Warnungen', ck.counts.warn], ['info', 'Hinweise', ck.counts.info]];
    const box = $('crFilter');
    box.innerHTML = opts.filter(o => o[0] === 'all' || o[2] > 0).map(([k, label, n]) =>
      '<button data-f="' + k + '" class="' + (filter === k ? 'active' : '') + '">' + label + ' (' + num(n) + ')</button>').join('');
    box.querySelectorAll('button').forEach(b => b.addEventListener('click', () => {
      filter = b.dataset.f;
      renderFilter();
      renderDetails();
    }));
  }

  function renderDetails() {
    const ck = lastResult.ck;
    const list = ck.details
      .filter(d => filter === 'all' || d.sev === filter)
      .sort((a, b) => (a.line || 0) - (b.line || 0) || SEV_ORDER[a.sev] - SEV_ORDER[b.sev]);
    const shown = list.slice(0, 500);
    $('crDetails').innerHTML = shown.length
      ? '<thead><tr><th class="num">Zeile</th><th>Art</th><th>Spalte</th><th>Meldung</th></tr></thead><tbody>' +
        shown.map(d => '<tr><td class="num">' + (d.line || '–') + '</td><td><span class="sev ' + d.sev + '">' + SEV_LABEL[d.sev] +
          '</span></td><td>' + (d.col ? '<code>' + esc(d.col) + '</code>' : '–') + '</td><td>' + esc(d.title) +
          (d.detail ? '<div class="detail">' + esc(d.detail) + '</div>' : '') + '</td></tr>').join('') + '</tbody>'
      : '<tbody><tr><td class="empty-note">Keine Befunde in dieser Kategorie.</td></tr></tbody>';

    const notes = [];
    if (list.length > shown.length) notes.push('Angezeigt werden die ersten ' + num(shown.length) + ' von ' + num(list.length) + ' Einzelbefunden.');
    if (ck.truncated) notes.push('Gespeichert wurden die ersten ' + num(ck.maxDetails) + ' Einzelbefunde, die Zählung oben ist vollständig.');
    notes.push('Die Zeilennummer bezieht sich auf die Datei, Zeile 1 ist die Kopfzeile.');
    $('crTruncated').textContent = notes.join(' ');
  }

  function downloadReport() {
    if (!lastResult) return;
    const { ck, file, deep, when } = lastResult;
    const L = [];
    const statusText = ck.status === 'err' ? 'ENTHÄLT FEHLER' : ck.status === 'warn' ? 'GÜLTIG, MIT WARNUNGEN' : 'GÜLTIG';
    L.push('Prüfbericht CSV - Durchblick Werkstatt (Datensatzgenerator v1.1)');
    L.push('='.repeat(60));
    L.push('Datei:      ' + file.name + ' (' + formatFileSize(file.size) + ')');
    L.push('Geprüft am: ' + when.toLocaleString('de-CH'));
    L.push('Ergebnis:   ' + statusText);
    L.push('Datensätze: ' + ck.rows + ' | Fehler: ' + ck.counts.error + ' | Warnungen: ' + ck.counts.warn + ' | Hinweise: ' + ck.counts.info);
    L.push('');
    L.push('Eigenschaften der Datei');
    L.push('-'.repeat(60));
    for (const [, k, v] of factsFor(lastResult)) L.push(('  ' + k + ':').padEnd(22) + v);
    L.push('');
    L.push('Befunde nach Art');
    L.push('-'.repeat(60));
    const groups = [...ck.findings.values()].sort((a, b) => SEV_ORDER[a.sev] - SEV_ORDER[b.sev] || b.count - a.count);
    if (!groups.length) L.push('  keine');
    for (const g of groups) {
      L.push('  [' + SEV_LABEL[g.sev] + '] ' + g.title + ' - ' + g.count + 'x' +
        (g.lines.length ? ' (Zeilen ' + g.lines.join(', ') + (g.count > g.lines.length ? ', ...' : '') + ')' : ''));
    }
    L.push('');
    L.push('Einzelbefunde');
    L.push('-'.repeat(60));
    const list = ck.details.slice().sort((a, b) => (a.line || 0) - (b.line || 0));
    if (!list.length) L.push('  keine');
    for (const d of list) {
      L.push('  Zeile ' + String(d.line || '-').padStart(6) + ' | ' + SEV_LABEL[d.sev].padEnd(8) + ' | ' +
        (d.col || '-').padEnd(17) + ' | ' + d.title + (d.detail ? ' - ' + d.detail : ''));
    }
    if (ck.truncated) L.push('  ... weitere Einzelbefunde nicht gespeichert (Zählung oben vollständig).');

    const blob = new Blob(['﻿' + L.join('\r\n') + '\r\n'], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'pruefbericht_' + file.name.replace(/\.[^.]+$/, '') + '.txt';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  }
});
