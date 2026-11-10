'use strict';

/* ============================================================
   Durchblick Werkstatt - Schritt 2: Datensatz (CSV) generieren
   Basiert auf «Datensatzgenerator v1.1» (VoM & Lumo), integriert
   in Durchblick. Alles läuft lokal im Browser, nichts wird
   hochgeladen.
   ============================================================ */

/* Schutz vor sehr grossen Archiven (ZIP-Bomben, Speicherüberlauf) */
const ZIP_MAX_ENTRIES = 50000;
const ZIP_WARN_UNPACKED = 500 * 1024 * 1024;   // Hinweis ab 500 MB
const ZIP_MAX_UNPACKED = 4 * 1024 * 1024 * 1024; // harte Grenze 4 GB

/* ============================================================
   Fest aktivierte Funktionen (keine Oberflaeche dafuer)
   ============================================================ */
const SKIP_JUNK = true;
const RANDOM_TIMES = true;
const HIDE_BIRTHDAY = true;

/* ============================================================
   Benutzer- und Gruppenzuordnung mit IDs gemaess Vorgabe:

   admin    : uid 1001, Gruppe admin_L    (gid 99)
   traeumer : uid 1000, Gruppe traeumer_L (gid 98)
   gamer    : uid 999,  Gruppe admin_L    (gid 99)
   coder    : uid 998,  Gruppe coder_L    (gid 97)

   Berechtigungen: admin 700, traeumer 750, gamer 770, coder 755
   Die Zuordnung erfolgt ueber den Verzeichnisnamen im Pfad.
   mode wird wie Pythons oct(st_mode) formatiert (0o1007xx).
   ============================================================ */
const USER_RULES = {
  'admin':    { user: 'admin',    uid: 1001, group: 'admin_L',    gid: 99, mode: '0o100700' },
  'traeumer': { user: 'traeumer', uid: 1000, group: 'traeumer_L', gid: 98, mode: '0o100750' },
  'träumer':  { user: 'traeumer', uid: 1000, group: 'traeumer_L', gid: 98, mode: '0o100750' },
  'gamer':    { user: 'gamer',    uid: 999,  group: 'admin_L',    gid: 99, mode: '0o100770' },
  'coder':    { user: 'coder',    uid: 998,  group: 'coder_L',    gid: 97, mode: '0o100755' }
};

/* Fallback fuer Dateien ausserhalb der vier Benutzerverzeichnisse */
const DEFAULT_OWNER = { user: 'traeumer', uid: 1000, group: 'traeumer_L', gid: 98, mode: '0o100750' };

function ownerForPath(p) {
  for (const seg of p.split('/')) {
    if (USER_RULES[seg]) return USER_RULES[seg];
  }
  return DEFAULT_OWNER;
}

/* ============================================================
   MD5-Implementierung (reines JavaScript nach RFC 1321).
   Der Browser stellt mit crypto.subtle kein MD5 bereit.
   ============================================================ */

const rotl = (x, c) => (x << c) | (x >>> (32 - c));

class Md5 {
  static S = [
    7,12,17,22, 7,12,17,22, 7,12,17,22, 7,12,17,22,
    5, 9,14,20, 5, 9,14,20, 5, 9,14,20, 5, 9,14,20,
    4,11,16,23, 4,11,16,23, 4,11,16,23, 4,11,16,23,
    6,10,15,21, 6,10,15,21, 6,10,15,21, 6,10,15,21
  ];
  static T = Array.from({ length: 64 }, (_, i) =>
    Math.floor(Math.abs(Math.sin(i + 1)) * 4294967296));

  constructor() {
    this.state = new Int32Array([
      0x67452301 | 0, 0xefcdab89 | 0,
      0x98badcfe | 0, 0x10325476 | 0
    ]);
    this.buf = new Uint8Array(0);
    this.len = 0;
  }

  update(chunk) {
    this.len += chunk.length;
    let data;
    if (this.buf.length) {
      data = new Uint8Array(this.buf.length + chunk.length);
      data.set(this.buf, 0);
      data.set(chunk, this.buf.length);
    } else {
      data = chunk;
    }
    const full = data.length & ~63;
    if (full > 0) this._blocks(data.subarray(0, full));
    this.buf = data.slice(full);
  }

  _blocks(bytes) {
    const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const S = Md5.S, T = Md5.T;
    let a0 = this.state[0], b0 = this.state[1], c0 = this.state[2], d0 = this.state[3];
    for (let off = 0; off < bytes.length; off += 64) {
      let a = a0, b = b0, c = c0, d = d0;
      for (let i = 0; i < 64; i++) {
        let f, k;
        const s = S[i];
        if (i < 16)      { f = (b & c) | (~b & d); k = i; }
        else if (i < 32) { f = (b & d) | (c & ~d); k = (5 * i + 1) & 15; }
        else if (i < 48) { f = b ^ c ^ d;           k = (3 * i + 5) & 15; }
        else             { f = c ^ (b | ~d);        k = (7 * i) & 15; }
        const m = dv.getUint32(off + k * 4, true);
        const tmp = d;
        d = c;
        c = b;
        b = (b + rotl((a + f + T[i] + m) | 0, s)) | 0;
        a = tmp;
      }
      a0 = (a0 + a) | 0; b0 = (b0 + b) | 0;
      c0 = (c0 + c) | 0; d0 = (d0 + d) | 0;
    }
    this.state[0] = a0; this.state[1] = b0;
    this.state[2] = c0; this.state[3] = d0;
  }

  digest() {
    const bitLen = BigInt(this.len) * 8n;
    const newLen = (((this.buf.length + 8) >>> 6) + 1) << 6;
    const pad = new Uint8Array(newLen);
    pad.set(this.buf);
    pad[this.buf.length] = 0x80;
    const dv = new DataView(pad.buffer);
    dv.setUint32(newLen - 8, Number(bitLen & 0xFFFFFFFFn) >>> 0, true);
    dv.setUint32(newLen - 4, Number(bitLen >> 32n) >>> 0, true);
    this._blocks(pad);
    let hex = '';
    for (let w = 0; w < 4; w++) {
      const word = this.state[w];
      for (let j = 0; j < 4; j++) {
        hex += ((word >>> (j * 8)) & 0xff).toString(16).padStart(2, '0');
      }
    }
    return hex;
  }
}

function md5Of(data) {
  const m = new Md5();
  const CHUNK = 4 * 1024 * 1024;
  for (let i = 0; i < data.length; i += CHUNK) {
    m.update(data.subarray(i, Math.min(i + CHUNK, data.length)));
  }
  return m.digest();
}

/* ============================================================
   MIME-Typen (an das Python-Original angelehnt)
   ============================================================ */

const MIME_MAP = {
  txt:'text/plain', md:'text/markdown', csv:'text/csv', html:'text/html',
  htm:'text/html', css:'text/css', js:'text/javascript', mjs:'text/javascript',
  json:'application/json', xml:'application/xml', yml:'text/yaml',
  yaml:'text/yaml', jpg:'image/jpeg', jpeg:'image/jpeg', png:'image/png',
  gif:'image/gif', svg:'image/svg+xml', webp:'image/webp', bmp:'image/bmp',
  ico:'image/vnd.microsoft.icon', pdf:'application/pdf', zip:'application/zip',
  gz:'application/gzip', tar:'application/x-tar', '7z':'application/x-7z-compressed',
  rar:'application/rar', mp3:'audio/mpeg', wav:'audio/x-wav', ogg:'audio/ogg',
  weba:'audio/webm', m4a:'audio/mp4', aac:'audio/aac', flac:'audio/flac', opus:'audio/ogg', oga:'audio/ogg',
  m4v:'video/mp4', ogv:'video/ogg',
  mp4:'video/mp4', webm:'video/webm', mov:'video/quicktime', avi:'video/x-msvideo',
  py:'text/x-python', php:'application/x-httpd-php', sql:'application/sql',
  java:'text/x-java', c:'text/x-csrc', cpp:'text/x-c++src', h:'text/x-chdr',
  sh:'application/x-sh', bat:'text/plain', ps1:'text/plain',
  ini:'text/plain', log:'text/plain', conf:'text/plain', properties:'text/plain',
  doc:'application/msword', docx:'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xls:'application/vnd.ms-excel', xlsx:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  ppt:'application/vnd.ms-powerpoint', ttf:'font/ttf', otf:'font/otf'
};

/* Erweiterungsliste 1:1 aus dem Python-Original uebernommen */
const PYTHON_TEXT_EXTENSIONS = ['.cfg', '.lua', '.map', '.vim', '.el', '.prefs',
  '.project', '.mask', '.6', '.fai', '.po', '.g', '.xjb', '.graphml', '.zargo',
  '.floo', '.flooignore', '.xsd', '.xcscheme', '.properties', '.plist', '.cbp',
  '.workspace', '.filters', '.vcxproj', '.ini', '.in', '.rc', '.ipp', '.adoc',
  '.bnd', '.gradle', '.tt', '.ii', '.tpp', '.cmake'];

function guessType(fileName) {
  const lower = fileName.toLowerCase();
  const dot = lower.lastIndexOf('.');
  const ext = dot >= 0 ? lower.slice(dot) : '';
  if (PYTHON_TEXT_EXTENSIONS.includes(ext)) return 'text/plain';
  if (ext === '.php') return 'application/x-httpd-php';
  const mapped = dot >= 0 ? MIME_MAP[lower.slice(dot + 1)] : null;
  if (mapped) return mapped;
  return 'unknown'; // wie Python: file_type or "unknown"
}

/* ============================================================
   Hilfsfunktionen
   ============================================================ */

function formatFileSize(bytes) {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(k)), sizes.length - 1);
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}

function formatDuration(seconds) {
  if (seconds < 60) return Math.ceil(seconds) + ' s';
  if (seconds < 3600) return Math.ceil(seconds / 60) + ' Min';
  return Math.ceil(seconds / 3600) + ' Std';
}

function csvLine(fields) {
  return fields.map(f => {
    const s = String(f);
    return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }).join(',');
}

function isoToDdmmyyyy(iso) {
  const parts = iso.split('-');
  return parts[2] + '.' + parts[1] + '.' + parts[0];
}

function calculateBirthdayInfo(isoStr) {
  const birthDate = new Date(isoStr + 'T00:00:00');
  const today = new Date();
  let nextBirthday = new Date(birthDate);
  nextBirthday.setFullYear(today.getFullYear());
  if (nextBirthday < today) nextBirthday.setFullYear(today.getFullYear() + 1);
  const daysUntilBirthday = Math.ceil(
    (nextBirthday - today) / (1000 * 60 * 60 * 24));
  let age = today.getFullYear() - birthDate.getFullYear();
  if (today < nextBirthday) age--;
  return { age, daysUntilBirthday };
}

/* zlib-Kompression (identisches Format wie Pythons zlib.compress) */
async function deflateBytes(data) {
  const cs = new CompressionStream('deflate');
  const stream = new Blob([data]).stream().pipeThrough(cs);
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/* URL-safe Base64 wie base64.urlsafe_b64encode in Python */
function urlsafeBase64(bytes) {
  let binary = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_');
}

/* ============================================================
   ZIP-Parser (liest das Central Directory direkt aus dem Archiv)
   ============================================================ */

async function parseZip(file) {
  if (file.size < 22) throw new Error('Die Datei ist zu klein, um ein ZIP-Archiv zu sein.');

  const tailLen = Math.min(file.size, 66000);
  const tailStart = file.size - tailLen;
  const tail = new Uint8Array(await file.slice(tailStart, file.size).arrayBuffer());

  let eocdIdx = -1;
  for (let i = tail.length - 22; i >= 0; i--) {
    if (tail[i] === 0x50 && tail[i+1] === 0x4b && tail[i+2] === 0x05 && tail[i+3] === 0x06) {
      eocdIdx = i;
      break;
    }
  }
  if (eocdIdx === -1) throw new Error('Kein gültiges ZIP-Archiv (Signatur nicht gefunden).');

  const dv = new DataView(tail.buffer, tail.byteOffset + eocdIdx);
  const entryCount = dv.getUint16(10, true);
  const cdSize = dv.getUint32(12, true);
  const cdOffset = dv.getUint32(16, true);
  if (cdOffset === 0xFFFFFFFF || entryCount === 0xFFFF) {
    throw new Error('ZIP64-Archive werden nicht unterstützt.');
  }

  const cd = new Uint8Array(await file.slice(cdOffset, cdOffset + cdSize).arrayBuffer());
  const cdv = new DataView(cd.buffer);
  const dec = new TextDecoder();
  const entries = [];
  let p = 0;
  while (p + 46 <= cd.length) {
    if (cdv.getUint32(p, true) !== 0x02014b50) break;
    if (entries.length >= ZIP_MAX_ENTRIES) {
      throw new Error('Das Archiv enthält mehr als ' + ZIP_MAX_ENTRIES.toLocaleString('de-CH') +
        ' Einträge. Bitte zuerst in Schritt 1 verkleinern.');
    }
    entries.push({
      flags: cdv.getUint16(p + 8, true),
      method: cdv.getUint16(p + 10, true),
      time: cdv.getUint16(p + 12, true),
      date: cdv.getUint16(p + 14, true),
      crc: cdv.getUint32(p + 16, true),
      compSize: cdv.getUint32(p + 20, true),
      uncompSize: cdv.getUint32(p + 24, true),
      nameLen: cdv.getUint16(p + 28, true),
      localOffset: cdv.getUint32(p + 42, true),
      name: dec.decode(cd.subarray(p + 46, p + 46 + cdv.getUint16(p + 28, true)))
    });
    p += 46 + cdv.getUint16(p + 28, true) + cdv.getUint16(p + 30, true) + cdv.getUint16(p + 32, true);
  }
  const total = entries.reduce((sum, en) => sum + (en.uncompSize || 0), 0);
  if (total > ZIP_MAX_UNPACKED) {
    throw new Error('Das Archiv ist entpackt grösser als 4 GB (' + formatFileSize(total) +
      '). Bitte zuerst in Schritt 1 «Rohdaten vorbereiten» verkleinern.');
  }
  return entries;
}

async function readEntryData(file, entry) {
  if (entry.flags & 0x1) {
    throw new Error('Verschlüsselte ZIP-Einträge werden nicht unterstützt: ' + entry.name);
  }
  const lh = new Uint8Array(await file.slice(entry.localOffset, entry.localOffset + 30).arrayBuffer());
  const lv = new DataView(lh.buffer);
  if (lv.getUint32(0, true) !== 0x04034b50) {
    throw new Error('Ungültiger lokaler Datei-Header für: ' + entry.name);
  }
  const dataStart = entry.localOffset + 30 + lv.getUint16(26, true) + lv.getUint16(28, true);
  const raw = file.slice(dataStart, dataStart + entry.compSize);
  if (entry.method === 0) return new Uint8Array(await raw.arrayBuffer());
  if (entry.method === 8) {
    const stream = raw.stream().pipeThrough(new DecompressionStream('deflate-raw'));
    return new Uint8Array(await new Response(stream).arrayBuffer());
  }
  throw new Error('Nicht unterstützte Kompressionsmethode (' + entry.method + ') in: ' + entry.name);
}

/* ============================================================
   Dynamische Geburtstags-HTML-Datei

   Berechnet beim echten Oeffnen per JavaScript, wie viele
   Tage es bis zum Geburtstag sind - auch in spaeteren Jahren.
   ============================================================ */
function buildBirthdayHtml(isoStr) {
  const [y, m, d] = isoStr.split('-').map(Number);
  const bMonthIndex = m - 1;

  return '<!DOCTYPE html>\n' +
'<html>\n' +
'<head>\n' +
'    <meta charset="UTF-8">\n' +
'    <title>Geburtstagsinformation</title>\n' +
'</head>\n' +
'<body>\n' +
'    <h1>Hallo!</h1>\n' +
'    <p id="msg"></p>\n' +
'    <script>\n' +
'    (function () {\n' +
'        var bYear = ' + y + ', bMonth = ' + bMonthIndex + ', bDay = ' + d + ';\n' +
'        var today = new Date();\n' +
'        today.setHours(0, 0, 0, 0);\n' +
'        var thisYear = today.getFullYear();\n' +
'        var thisYearBirthday = new Date(thisYear, bMonth, bDay);\n' +
'        var isToday = today.getTime() === thisYearBirthday.getTime();\n' +
'        var yearDiff = thisYear - bYear;\n' +
'        var hadBirthday = today >= thisYearBirthday;\n' +
'        var turning = hadBirthday ? yearDiff + 1 : yearDiff;\n' +
'        var el = document.getElementById("msg");\n' +
'        if (isToday) {\n' +
'            el.textContent = "Heute ist dein Geburtstag! Du wirst heute " + turning + " Jahre alt. Herzliche Gratulation!";\n' +
'        } else {\n' +
'            var next = hadBirthday ? new Date(thisYear + 1, bMonth, bDay) : thisYearBirthday;\n' +
'            var days = Math.round((next - today) / 86400000);\n' +
'            if (days === 1) {\n' +
'                el.textContent = "Morgen hast du Geburtstag und wirst " + turning + " Jahre alt.";\n' +
'            } else {\n' +
'                el.textContent = "Du hast in " + days + " Tagen Geburtstag und wirst " + turning + " Jahre alt.";\n' +
'            }\n' +
'        }\n' +
'    })();\n' +
'    </scr' + 'ipt>\n' +
'</body>\n' +
'</html>\n';
}

/* ============================================================
   UI-Logik
   ============================================================ */

document.addEventListener('DOMContentLoaded', () => {
  const dropZone = document.getElementById('dropZone');
  const zipInput = document.getElementById('zipInput');
  const filePreview = document.getElementById('filePreview');
  const previewName = document.getElementById('previewName');
  const previewMeta = document.getElementById('previewMeta');
  const removeFile = document.getElementById('removeFile');
  const generateBtn = document.getElementById('generateBtn');
  const progressCard = document.getElementById('progressCard');
  const progressBar = document.getElementById('progressBar');
  const progressPercent = document.getElementById('progressPercent');
  const progressDetail = document.getElementById('progressDetail');
  const currentFile = document.getElementById('currentFile');
  const phaseLabel = document.getElementById('phaseLabel');
  const resultCard = document.getElementById('resultCard');
  const errorCard = document.getElementById('errorCard');
  const errorMessage = document.getElementById('errorMessage');
  const errorWarnings = document.getElementById('errorWarnings');

  const birthDay = document.getElementById('birthDay');
  const birthMonth = document.getElementById('birthMonth');
  const birthYear = document.getElementById('birthYear');

  let selectedZip = null;   // { file, entries }
  let running = false;

  const JUNK = ['.ds_store', 'thumbs.db', 'desktop.ini'];

  function isJunk(name) {
    const base = name.toLowerCase().split('/').pop();
    return JUNK.includes(base) || name.startsWith('__MACOSX/');
  }

  // ----- Geburtsdatum: Auswahl ueber drei Dropdowns -----

  const MONTHS = ['Januar', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli',
    'August', 'September', 'Oktober', 'November', 'Dezember'];

  function fillDayOptions() {
    const m = parseInt(birthMonth.value, 10);
    const y = parseInt(birthYear.value, 10);
    const prev = parseInt(birthDay.value, 10) || null;
    let n = 31;
    if (m && y) n = new Date(y, m, 0).getDate();
    else if (m) n = new Date(y || 2024, m, 0).getDate();
    let opts = '<option value="">Tag</option>';
    for (let i = 1; i <= n; i++) opts += '<option value="' + i + '">' + i + '</option>';
    birthDay.innerHTML = opts;
    if (prev && prev <= n) birthDay.value = prev;
    else if (prev) birthDay.value = ''; // z.B. 31. Februar zuruecksetzen
  }

  (function initBirthdate() {
    birthMonth.innerHTML = '<option value="">Monat</option>' +
      MONTHS.map((m, i) => '<option value="' + (i + 1) + '">' + m + '</option>').join('');
    const now = new Date();
    let yOpts = '<option value="">Jahr</option>';
    for (let y = now.getFullYear(); y >= 1940; y--) {
      yOpts += '<option value="' + y + '">' + y + '</option>';
    }
    birthYear.innerHTML = yOpts;
    fillDayOptions();

    birthMonth.addEventListener('change', () => { fillDayOptions(); updateGenerateButton(); });
    birthYear.addEventListener('change', () => { fillDayOptions(); updateGenerateButton(); });
    birthDay.addEventListener('change', updateGenerateButton);
  })();

  function getSelectedBirthdate() {
    const d = parseInt(birthDay.value, 10);
    const m = parseInt(birthMonth.value, 10);
    const y = parseInt(birthYear.value, 10);
    if (!d || !m || !y) return null;
    return y + '-' + String(m).padStart(2, '0') + '-' + String(d).padStart(2, '0');
  }

  // ----- ZIP-Auswahl -----
  dropZone.addEventListener('click', () => zipInput.click());

  zipInput.addEventListener('change', async (e) => {
    if (e.target.files.length > 0) await setZip(e.target.files[0]);
  });

  dropZone.addEventListener('dragover', (e) => {
    e.preventDefault();
    dropZone.classList.add('dragover');
  });
  dropZone.addEventListener('dragleave', () => dropZone.classList.remove('dragover'));
  dropZone.addEventListener('drop', async (e) => {
    e.preventDefault();
    dropZone.classList.remove('dragover');
    const zip = Array.from(e.dataTransfer.files).find(f => f.name.toLowerCase().endsWith('.zip'));
    if (zip) await setZip(zip);
    else showError('Bitte nur ZIP-Archive hierher ziehen. 🙈');
  });

  removeFile.addEventListener('click', () => {
    const fresh = zipInput.cloneNode(true);
    zipInput.parentNode.replaceChild(fresh, zipInput);
    fresh.addEventListener('change', async (e) => {
      if (e.target.files.length > 0) await setZip(e.target.files[0]);
    });
    selectedZip = null;
    filePreview.hidden = true;
    dropZone.style.display = '';
    updateGenerateButton();
    hideError();
  });

  async function setZip(file) {
    if (!file.name.toLowerCase().endsWith('.zip')) {
      showError('Bitte nur ZIP-Archive auswählen.');
      return;
    }
    try {
      if (typeof DecompressionStream === 'undefined') {
        throw new Error('Dieser Browser unterstützt die benötigte Dekompression nicht. Bitte einen aktuellen Chrome, Edge oder Firefox verwenden.');
      }
      const entries = await parseZip(file);
      selectedZip = { file, entries };
      const filesOnly = entries.filter(en => !en.name.endsWith('/') && !isJunk(en.name));
      if (filesOnly.length === 0) {
        selectedZip = null;
        showError('Das ZIP-Archiv enthält keine verwertbaren Dateien.');
        return;
      }
      const totalUnpacked = filesOnly.reduce((s, en) => s + (en.uncompSize || 0), 0);
      previewName.textContent = '📦 ' + file.name;
      previewMeta.textContent = filesOnly.length.toLocaleString('de-CH') +
        ' Dateien - ' + formatFileSize(totalUnpacked) + ' entpackt (' +
        formatFileSize(file.size) + ' Archiv)' +
        (totalUnpacked > ZIP_WARN_UNPACKED
          ? ' - ⚠️ sehr gross, Tipp: zuerst in Schritt 1 verkleinern' : '');
      filePreview.hidden = false;
      dropZone.style.display = 'none';
      updateGenerateButton();
      hideError();
    } catch (err) {
      showError('Archiv konnte nicht gelesen werden: ' + err.message);
    }
  }

  /* Von Schritt 1 (Rohdaten vorbereiten) aus aufrufbar */
  window.useZipInGenerator = async (file) => {
    if (typeof window.werkstattMode === 'function') window.werkstattMode('generate');
    await setZip(file);
    document.getElementById('userName').focus();
  };

  function updateGenerateButton() {
    const name = document.getElementById('userName').value.trim();
    generateBtn.disabled = running ||
      !(selectedZip && name && getSelectedBirthdate());
  }

  document.getElementById('userName').addEventListener('input', updateGenerateButton);

  // ----- Generieren -----
  generateBtn.addEventListener('click', run);

  async function run() {
    if (running || !selectedZip) return;
    running = true;
    updateGenerateButton();

    const name = document.getElementById('userName').value.trim();
    const birthdateIso = getSelectedBirthdate();
    if (!birthdateIso) {
      showError('Bitte Geburtsdatum vollständig auswählen (Tag, Monat und Jahr).');
      running = false;
      updateGenerateButton();
      return;
    }

    let entries = selectedZip.entries.filter(en => !en.name.endsWith('/'));
    if (SKIP_JUNK) entries = entries.filter(en => !isJunk(en.name));

    if (entries.length === 0) {
      showError('Das ZIP-Archiv enthält keine verwertbaren Dateien.');
      running = false;
      updateGenerateButton();
      return;
    }

    const totalBytes = entries.reduce((s, en) => s + (en.uncompSize || 0), 0);
    const startedAt = performance.now();
    let doneBytes = 0;
    let filesDone = 0;

    const warnings = [];

    resultCard.hidden = true;
    errorCard.hidden = true;
    progressCard.hidden = false;
    setProgress(0, 'Analysiere Dateien...', '');

    try {
      // Spalten 1:1 wie im Python-Original
      const parts = [csvLine(['count', 'hash', 'path', 'size', 'type', 'mode',
        'uid', 'user', 'gid', 'group', 'time', 'compressed_size',
        'compression_ratio', 'encoded_data'])];

      let count = 1;

      async function addRow(data, opts) {
        const owner = ownerForPath(opts.path);
        const hash = md5Of(data);
        const compressed = await deflateBytes(data);
        const encoded = urlsafeBase64(compressed);
        const ratio = data.length > 0
          ? Math.round((compressed.length / data.length) * 10000) / 100
          : 0;
        parts.push(csvLine([
          count++, hash, opts.path, data.length, opts.type,
          owner.mode, owner.uid, owner.user, owner.gid, owner.group,
          opts.time, compressed.length, ratio, encoded
        ]));
      }

      for (const entry of entries) {
        currentFile.textContent = '📄 ' + entry.name;
        try {
          const data = await readEntryData(selectedZip.file, entry);
          await addRow(data, {
            path: '/' + entry.name,
            type: guessType(entry.name),
            time: RANDOM_TIMES ? randomRecentTimestamp() : Math.floor(Date.now() / 1000)
          });
          doneBytes += entry.uncompSize || 0;
        } catch (err) {
          warnings.push(entry.name + ': ' + err.message);
        }
        filesDone++;
        updateProgress(doneBytes, totalBytes, startedAt, filesDone, entries.length);
      }

      // Geburtstagsdateien wie im Python-Original verstecken
      if (HIDE_BIRTHDAY) {
        const info = calculateBirthdayInfo(birthdateIso);
        const ddmm = isoToDdmmyyyy(birthdateIso);
        const stamp = ddmm.replace(/\./g, '');

        const txtContent = 'Geburtsdatum: ' + ddmm + '\nAlter: ' + info.age +
          '\nTage bis zum Geburtstag: ' + info.daysUntilBirthday + '\n';
        const htmlContent = buildBirthdayHtml(birthdateIso);

        // Prefix: gemeinsamer Hauptordner des Archivs, falls vorhanden
        let prefix = '';
        const firstSeg = entries[0].name.split('/')[0];
        const hasFolders = entries.some(en => en.name.includes('/'));
        if (hasFolders && entries.every(en => en.name.split('/')[0] === firstSeg)) {
          prefix = firstSeg + '/';
        }

        const enc = new TextEncoder();

        currentFile.textContent = '📄 Geburtstagsdateien werden versteckt...';
        await addRow(enc.encode(txtContent), {
          path: '/' + prefix + 'Files/gamer/wesnoth-1.14.7/data/' + stamp + '.txt',
          type: 'text/plain',
          time: randomRecentTimestamp()
        });
        await addRow(enc.encode(htmlContent), {
          path: '/' + prefix + 'Files/admin/licenses/hidden/' + stamp + '.html',
          type: 'text/html',
          time: randomRecentTimestamp()
        });
      }

      if (parts.length <= 1) {
        throw new Error('Keine Datei konnte verarbeitet werden. ' +
          (warnings.length ? 'Siehe Hinweise unten.' : ''));
      }

      // CSV als Blob mit UTF-8-BOM (wie utf-8-sig in Python)
      const blobParts = ['\ufeff'];
      for (const part of parts) blobParts.push(part + '\r\n');
      const blob = new Blob(blobParts, { type: 'text/csv;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      // Dateiname nur aus Buchstaben, Ziffern, _ und - (keine Pfadzeichen)
      const safeName = name.normalize('NFC').replace(/\s+/g, '_')
        .replace(/[^\p{L}\p{N}_-]/gu, '').slice(0, 60) || 'lernende';
      const fileName = 'datensatz_' + safeName + '.csv';

      document.getElementById('downloadBtn').onclick = () => {
        const a = document.createElement('a');
        a.href = url;
        a.download = fileName;
        document.body.appendChild(a);
        a.click();
        a.remove();
      };

      const generatedFile = new File([blob], fileName, { type: 'text/csv' });
      document.getElementById('checkGeneratedBtn').onclick = () => {
        if (typeof window.startCsvCheck === 'function') window.startCsvCheck(generatedFile);
      };

      setProgress(100, 'Fertig!', '');
      currentFile.textContent = '';

      setTimeout(() => {
        progressCard.hidden = true;
        showResult(name, count - 1, totalBytes, warnings);
      }, 500);
    } catch (err) {
      progressCard.hidden = true;
      showError('Bei der Verarbeitung ist ein Fehler aufgetreten: ' + err.message);
    } finally {
      running = false;
      updateGenerateButton();
    }
  }

  function randomRecentTimestamp() {
    const msAgo = Math.floor(Math.random() * 180 * 24 * 3600 * 1000);
    return Math.floor((Date.now() - msAgo) / 1000);
  }

  function updateProgress(done, total, startedAt, filesDone, filesTotal) {
    const pct = total > 0 ? Math.round((done / total) * 100) : 100;
    let detail = filesDone + ' / ' + filesTotal + ' Dateien - ' +
      formatFileSize(done) + ' / ' + formatFileSize(total);
    const elapsed = (performance.now() - startedAt) / 1000;
    if (done > 0 && elapsed > 2) {
      const speed = done / elapsed;
      const remaining = (total - done) / speed;
      detail += ' - ' + formatFileSize(speed) + '/s - noch ca. ' + formatDuration(remaining);
    }
    setProgress(pct, 'Analysiere Dateien...', detail);
  }

  function setProgress(pct, phase, detail) {
    progressBar.style.width = pct + '%';
    progressPercent.textContent = pct + '%';
    if (phase) phaseLabel.textContent = phase;
    if (detail !== undefined) progressDetail.textContent = detail;
  }

  function showResult(name, fileCount, totalBytes, warnings) {
    document.getElementById('resultName').textContent = name.split(' ')[0];
    document.getElementById('resultFiles').textContent = fileCount.toLocaleString('de-CH');
    document.getElementById('resultSize').textContent = formatFileSize(totalBytes);
    resultCard.hidden = false;
    if (warnings.length > 0) {
      errorMessage.textContent = warnings.length + ' Datei(en) konnten nicht verarbeitet werden:';
      errorWarnings.innerHTML = '';
      for (const w of warnings.slice(0, 10)) {
        const li = document.createElement('li');
        li.textContent = w;
        errorWarnings.appendChild(li);
      }
      errorWarnings.hidden = false;
      errorCard.hidden = false;
    }
    resultCard.scrollIntoView({ behavior: 'smooth' });
  }

  function showError(msg) {
    progressCard.hidden = true;
    errorMessage.textContent = msg;
    errorWarnings.hidden = true;
    errorCard.hidden = false;
  }

  function hideError() {
    errorCard.hidden = true;
    errorWarnings.hidden = true;
  }

  document.getElementById('againBtn').addEventListener('click', () => {
    resultCard.hidden = true;
    errorCard.hidden = true;
    updateGenerateButton();
  });

  document.getElementById('retryBtn').addEventListener('click', () => {
    errorCard.hidden = true;
    updateGenerateButton();
  });
});
