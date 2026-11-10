'use strict';

/* ============================================================
   Durchblick Werkstatt - minimaler ZIP-Schreiber

   Erzeugt ZIP-Archive direkt im Browser (ohne Bibliothek).
   - Methode 0 (gespeichert) oder 8 (deflate) pro Datei
   - Dateinamen in UTF-8 (Flag-Bit 11)
   - Einträge aus einem anderen ZIP können unverändert
     übernommen werden (addRaw), ohne sie zu entpacken.
   Grenzen: kein ZIP64, also max. 65 535 Einträge und 4 GB.
   ============================================================ */

const CRC32_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(bytes) {
  let c = 0xFFFFFFFF;
  for (let i = 0; i < bytes.length; i++) c = CRC32_TABLE[(c ^ bytes[i]) & 0xFF] ^ (c >>> 8);
  return (c ^ 0xFFFFFFFF) >>> 0;
}

async function deflateRaw(data) {
  const stream = new Blob([data]).stream().pipeThrough(new CompressionStream('deflate-raw'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

function dosDateTime(d) {
  const year = Math.max(1980, d.getFullYear());
  return {
    time: (d.getHours() << 11) | (d.getMinutes() << 5) | Math.floor(d.getSeconds() / 2),
    date: ((year - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate()
  };
}

class ZipWriter {
  constructor() {
    this.parts = [];
    this.central = [];
    this.offset = 0;
    this.names = new Set();
    this.enc = new TextEncoder();
  }

  has(name) { return this.names.has(name); }

  _check(name, size) {
    if (!name || name.startsWith('/') || name.split('/').includes('..')) {
      throw new Error('Ungültiger Pfad im ZIP: ' + name);
    }
    if (this.names.has(name)) throw new Error('Pfad doppelt im ZIP: ' + name);
    if (this.central.length >= 65535) throw new Error('Zu viele Dateien für ein ZIP (max. 65 535).');
    if (this.offset + size > 0xFFFFFFF0) throw new Error('Das ZIP würde grösser als 4 GB.');
  }

  _header(sig, nameBytes, e, central) {
    const len = central ? 46 : 30;
    const b = new Uint8Array(len + nameBytes.length);
    const v = new DataView(b.buffer);
    let p = 0;
    v.setUint32(p, sig, true); p += 4;
    if (central) { v.setUint16(p, 20, true); p += 2; }   // erstellt mit
    v.setUint16(p, 20, true); p += 2;                     // benötigte Version
    v.setUint16(p, 0x0800, true); p += 2;                 // UTF-8-Namen
    v.setUint16(p, e.method, true); p += 2;
    v.setUint16(p, e.time, true); p += 2;
    v.setUint16(p, e.date, true); p += 2;
    v.setUint32(p, e.crc, true); p += 4;
    v.setUint32(p, e.compSize, true); p += 4;
    v.setUint32(p, e.uncompSize, true); p += 4;
    v.setUint16(p, nameBytes.length, true); p += 2;
    v.setUint16(p, 0, true); p += 2;                      // Extra-Feld
    if (central) {
      p += 2 + 2 + 2;                                     // Kommentar, Disk, interne Attribute
      v.setUint32(p, 0, true); p += 4;                    // externe Attribute
      v.setUint32(p, e.offset, true); p += 4;
    }
    b.set(nameBytes, p);
    return b;
  }

  _push(name, e, payload) {
    const nameBytes = this.enc.encode(name);
    e.offset = this.offset;
    const local = this._header(0x04034b50, nameBytes, e, false);
    this.parts.push(local, payload);
    this.offset += local.length + e.compSize;
    this.central.push(this._header(0x02014b50, nameBytes, e, true));
    this.names.add(name);
  }

  /* Neue Datei hinzufügen. data: Uint8Array */
  async add(name, data, opts = {}) {
    const { deflate = true, date = new Date() } = opts;
    this._check(name, data.length);
    const crc = crc32(data);
    let payload = data, method = 0;
    if (deflate && data.length > 64) {
      const packed = await deflateRaw(data);
      if (packed.length < data.length) { payload = packed; method = 8; }
    }
    const dt = dosDateTime(date);
    this._push(name, {
      method, time: dt.time, date: dt.date, crc,
      compSize: payload.length, uncompSize: data.length
    }, payload);
  }

  /* Eintrag aus einem anderen ZIP unverändert übernehmen.
     blob: bereits komprimierte Rohdaten, entry: Werte aus dem Central Directory */
  addRaw(name, blob, entry) {
    this._check(name, entry.compSize);
    this._push(name, {
      method: entry.method, time: entry.time || 0, date: entry.date || 0x21,
      crc: entry.crc, compSize: entry.compSize, uncompSize: entry.uncompSize
    }, blob);
  }

  get size() { return this.offset; }
  get count() { return this.central.length; }

  finish() {
    const cdSize = this.central.reduce((s, c) => s + c.length, 0);
    const eocd = new Uint8Array(22);
    const v = new DataView(eocd.buffer);
    v.setUint32(0, 0x06054b50, true);
    v.setUint16(8, this.central.length, true);
    v.setUint16(10, this.central.length, true);
    v.setUint32(12, cdSize, true);
    v.setUint32(16, this.offset, true);
    return new Blob([...this.parts, ...this.central, eocd], { type: 'application/zip' });
  }
}

/* Rohdaten (komprimiert) eines Eintrags aus einem ZIP als Blob,
   ohne sie zu entpacken. Benötigt parseZip() aus generator.js. */
async function zipEntryRawBlob(file, entry) {
  const lh = new Uint8Array(await file.slice(entry.localOffset, entry.localOffset + 30).arrayBuffer());
  const lv = new DataView(lh.buffer);
  if (lv.getUint32(0, true) !== 0x04034b50) throw new Error('Ungültiger lokaler Datei-Header: ' + entry.name);
  const start = entry.localOffset + 30 + lv.getUint16(26, true) + lv.getUint16(28, true);
  return file.slice(start, start + entry.compSize);
}

if (typeof module !== 'undefined') module.exports = { ZipWriter, crc32, zipEntryRawBlob };
