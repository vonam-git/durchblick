'use strict';

/* ============================================================
   Durchblick Werkstatt - Schritt 1: Rohdaten vorbereiten

   Liest einen Ordner, einzelne Dateien oder ein ZIP ein und
   erzeugt daraus ein kleines ZIP für den Datensatzgenerator:
   - Bilder werden verkleinert und neu kodiert (WebP/JPEG/PNG).
     Dabei gehen EXIF-Metadaten wie GPS-Koordinaten verloren.
   - Videos werden zu einem Vorschaubild (oder übersprungen).
   - Grosse Dateien werden übersprungen, Textdateien bleiben.
   - Optional werden die Dateien in Files/<benutzer>/<projekt>/
     einsortiert und mit einem bestehenden Rohdaten-ZIP vereint.
   Alles passiert lokal im Browser. Es wird nichts hochgeladen.
   Benötigt: generator.js (parseZip, readEntryData, formatFileSize)
             zipwriter.js (ZipWriter, zipEntryRawBlob)
   ============================================================ */

const CMP = {
  IMAGE_EXT: ['jpg', 'jpeg', 'png', 'webp', 'bmp', 'gif', 'avif'],
  VIDEO_EXT: ['mp4', 'webm', 'mov', 'm4v', 'ogv'],
  AUDIO_EXT: ['mp3', 'wav', 'ogg', 'oga', 'm4a', 'aac', 'flac', 'opus', 'weba'],
  TEXT_EXT: ['txt', 'md', 'json', 'csv', 'xml', 'yml', 'yaml', 'html', 'htm', 'css',
    'js', 'sql', 'svg', 'ini', 'log', 'cfg', 'conf', 'py', 'java', 'c', 'h', 'cpp', 'sh'],
  JUNK: ['.ds_store', 'thumbs.db', 'desktop.ini'],
  MAX_INPUT_FILES: 20000
};

function cmpExt(name) {
  const base = name.split('/').pop();
  const i = base.lastIndexOf('.');
  return i > 0 ? base.slice(i + 1).toLowerCase() : '';
}

function cmpKind(name) {
  const e = cmpExt(name);
  if (e === 'gif') return 'gif';
  if (CMP.IMAGE_EXT.includes(e)) return 'image';
  if (CMP.VIDEO_EXT.includes(e)) return 'video';
  if (CMP.AUDIO_EXT.includes(e)) return 'audio';
  if (CMP.TEXT_EXT.includes(e)) return 'text';
  return 'other';
}

function cmpIsJunk(path) {
  const base = path.toLowerCase().split('/').pop();
  return CMP.JUNK.includes(base) || path.startsWith('__MACOSX/') || path.includes('/__MACOSX/');
}

/* Pfadteil für Datenbank und Linux tauglich machen:
   «Kaktus Kalle (Gold).PNG» -> «kaktus_kalle_gold.png» */
function cleanSegment(seg) {
  const map = { 'ä': 'ae', 'ö': 'oe', 'ü': 'ue', 'Ä': 'ae', 'Ö': 'oe', 'Ü': 'ue', 'ß': 'ss', 'é': 'e', 'è': 'e', 'ê': 'e', 'à': 'a', 'ç': 'c' };
  let s = seg.normalize('NFC').replace(/[äöüÄÖÜßéèêàç]/g, c => map[c]);
  s = s.normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase();
  s = s.replace(/[^a-z0-9._-]+/g, '_').replace(/_+/g, '_').replace(/^[_.-]+|[_-]+$/g, '');
  return s || 'datei';
}

function changeExt(path, ext) {
  const i = path.lastIndexOf('.');
  const slash = path.lastIndexOf('/');
  return (i > slash ? path.slice(0, i) : path) + '.' + ext;
}

/* Bild verkleinern und neu kodieren. Gibt Blob und Masse zurück. */
async function shrinkImage(blob, maxEdge, format, quality) {
  let bmp;
  try {
    bmp = await createImageBitmap(blob);
  } catch (e) {
    throw new Error('Bild konnte nicht gelesen werden');
  }
  const w = bmp.width, h = bmp.height;
  const scale = Math.min(1, maxEdge / Math.max(w, h));
  const cw = Math.max(1, Math.round(w * scale)), ch = Math.max(1, Math.round(h * scale));
  const canvas = document.createElement('canvas');
  canvas.width = cw; canvas.height = ch;
  const ctx = canvas.getContext('2d');
  if (format === 'image/jpeg') { ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, cw, ch); }
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(bmp, 0, 0, cw, ch);
  bmp.close();
  let out = await new Promise(r => canvas.toBlob(r, format, quality));
  if (!out || out.type !== format) {
    // z.B. Safari ohne WebP-Encoder: auf JPEG ausweichen
    ctx.globalCompositeOperation = 'destination-over';
    ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, cw, ch);
    out = await new Promise(r => canvas.toBlob(r, 'image/jpeg', quality));
  }
  return { blob: out, w, h, cw, ch };
}

/* Vorschaubild aus einem Video (Bild bei ca. 1 Sekunde) */
function videoPoster(blob, maxEdge, format, quality) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob);
    const v = document.createElement('video');
    let done = false;
    const finish = (fn, val) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      v.removeAttribute('src'); v.load();
      URL.revokeObjectURL(url);
      fn(val);
    };
    const timer = setTimeout(() => finish(reject, new Error('Zeitüberschreitung beim Lesen des Videos')), 10000);
    v.muted = true;
    v.preload = 'auto';
    v.playsInline = true;
    v.onloadedmetadata = () => {
      const d = Number.isFinite(v.duration) ? v.duration : 0;
      v.currentTime = Math.min(1, d / 2);
    };
    v.onseeked = async () => {
      try {
        const vw = v.videoWidth, vh = v.videoHeight;
        if (!vw || !vh) throw new Error('Video ohne Bildspur');
        const scale = Math.min(1, maxEdge / Math.max(vw, vh));
        const canvas = document.createElement('canvas');
        canvas.width = Math.round(vw * scale); canvas.height = Math.round(vh * scale);
        canvas.getContext('2d').drawImage(v, 0, 0, canvas.width, canvas.height);
        let out = await new Promise(r => canvas.toBlob(r, format, quality));
        if (!out || out.type !== format) out = await new Promise(r => canvas.toBlob(r, 'image/jpeg', quality));
        finish(resolve, { blob: out, w: vw, h: vh, cw: canvas.width, ch: canvas.height,
          duration: Math.round((v.duration || 0) * 10) / 10 });
      } catch (e) { finish(reject, e); }
    };
    v.onerror = () => finish(reject, new Error('Videoformat wird von diesem Browser nicht unterstützt'));
    v.src = url;
  });
}

/* ------------------------------------------------------------
   Kurzclips aus Video und Audio
   Der Browser spielt die Datei unsichtbar ab und nimmt dabei mit
   MediaRecorder einen kurzen Ausschnitt auf (Echtzeit: 5 s Clip
   brauchen ca. 5 s). Video wird dabei klein skaliert, Audio wird
   sanft ein- und ausgeblendet. Ergebnis: WebM (VP8/VP9 + Opus),
   in Safari MP4.
   ------------------------------------------------------------ */
function recorderMime(kind) {
  if (typeof MediaRecorder === 'undefined' || !MediaRecorder.isTypeSupported) return '';
  const list = kind === 'video'
    ? ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm', 'video/mp4']
    : ['audio/webm;codecs=opus', 'audio/ogg;codecs=opus', 'audio/webm', 'audio/mp4'];
  return list.find(m => MediaRecorder.isTypeSupported(m)) || '';
}

function mimeExt(mime) {
  if (mime.startsWith('video/webm')) return 'webm';
  if (mime.startsWith('video/mp4')) return 'mp4';
  if (mime.startsWith('audio/webm')) return 'weba';
  if (mime.startsWith('audio/ogg')) return 'ogg';
  return 'm4a';
}

/* Chrome schreibt in MediaRecorder-WebM keine Dauer. Ohne Dauer zeigt der
   Player keine Zeitleiste. Hier wird das Element «Duration» (0x4489) in den
   Abschnitt «Info» des WebM-Kopfs eingefügt. Unbekannte Dateien bleiben
   unverändert. */
function fixWebmDuration(bytes, ms) {
  const u8 = bytes;
  const vint = (p) => {               // EBML-Zahl: { len, value, unknown }
    const b = u8[p];
    let len = 1, mask = 0x80;
    while (len <= 8 && !(b & mask)) { len++; mask >>= 1; }
    if (len > 8) return null;
    let value = b & (mask - 1), allOnes = value === mask - 1;
    for (let i = 1; i < len; i++) { value = value * 256 + u8[p + i]; if (u8[p + i] !== 0xFF) allOnes = false; }
    return { len, value, unknown: allOnes };
  };
  const idLen = (p) => { const b = u8[p]; return b & 0x80 ? 1 : b & 0x40 ? 2 : b & 0x20 ? 3 : b & 0x10 ? 4 : 0; };
  const readId = (p) => { let v = 0; const n = idLen(p); for (let i = 0; i < n; i++) v = v * 256 + u8[p + i]; return { id: v, len: n }; };
  const encSize = (value, len) => {
    const out = new Uint8Array(len);
    let v = value;
    for (let i = len - 1; i >= 0; i--) { out[i] = v % 256; v = Math.floor(v / 256); }
    out[0] |= 0x80 >> (len - 1);
    return out;
  };
  try {
    let p = 0;
    let e = readId(p); if (e.id !== 0x1A45DFA3) return bytes;          // EBML-Kopf
    let sz = vint(p + e.len); p += e.len + sz.len + sz.value;
    e = readId(p); if (e.id !== 0x18538067) return bytes;               // Segment
    const segSizePos = p + e.len, seg = vint(segSizePos);
    p = segSizePos + seg.len;
    const segEnd = seg.unknown ? u8.length : p + seg.value;
    while (p < segEnd) {
      e = readId(p);
      if (!e.len) return bytes;
      const s2 = vint(p + e.len);
      if (!s2) return bytes;
      if (e.id === 0x1549A966) {                                        // Info
        const dataStart = p + e.len + s2.len, dataEnd = dataStart + s2.value;
        for (let q = dataStart; q < dataEnd;) {
          const c = readId(q), cs = vint(q + c.len);
          if (c.id === 0x4489) return bytes;                            // Dauer schon da
          q += c.len + cs.len + cs.value;
        }
        const dur = new Uint8Array(11);
        dur.set([0x44, 0x89, 0x88]);
        new DataView(dur.buffer).setFloat64(3, ms);
        const newSize = s2.value + dur.length;
        let sizeLen = s2.len;
        while (newSize >= Math.pow(2, 7 * sizeLen) - 1) sizeLen++;
        const head = new Uint8Array([...u8.subarray(p, p + e.len), ...encSize(newSize, sizeLen)]);
        const delta = head.length + newSize - (e.len + s2.len + s2.value);
        let prefix = u8.subarray(0, p);
        if (!seg.unknown) {                                             // Segmentgrösse anpassen
          prefix = new Uint8Array(prefix);
          prefix.set(encSize(seg.value + delta, seg.len), segSizePos);
        }
        const out = new Uint8Array(u8.length + delta);
        let o = 0;
        for (const part of [prefix, head, u8.subarray(dataStart, dataEnd), dur, u8.subarray(dataEnd)]) {
          out.set(part, o); o += part.length;
        }
        return out;
      }
      if (s2.unknown) return bytes;
      p += e.len + s2.len + s2.value;
    }
  } catch (err) { /* unbekannter Aufbau: unverändert lassen */ }
  return bytes;
}

let cmpAudioCtx = null;
function cmpGetAudioCtx() {
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return null;
  if (!cmpAudioCtx || cmpAudioCtx.state === 'closed') cmpAudioCtx = new AC();
  if (cmpAudioCtx.state === 'suspended') cmpAudioCtx.resume();
  return cmpAudioCtx;
}

function waitFor(target, okEvent, ms) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => { off(); reject(new Error('Zeitüberschreitung beim Lesen der Datei')); }, ms);
    const ok = () => { off(); resolve(); };
    const bad = () => { off(); reject(new Error('Format wird von diesem Browser nicht unterstützt')); };
    const off = () => { clearTimeout(t); target.removeEventListener(okEvent, ok); target.removeEventListener('error', bad); };
    target.addEventListener(okEvent, ok);
    target.addEventListener('error', bad);
  });
}

/* opt: { kind: 'video'|'audio', seconds, startMode: 'anfang'|'mitte', edge, withAudio } */
async function mediaClip(blob, opt) {
  const url = URL.createObjectURL(blob);
  const el = document.createElement(opt.kind === 'video' ? 'video' : 'audio');
  el.preload = 'auto';
  el.playsInline = true;
  el.crossOrigin = 'anonymous';
  let rec = null, srcNode = null, gain = null, stopTimer = null, stopped = false;
  const cleanup = () => {
    stopped = true;
    clearTimeout(stopTimer);
    try { el.pause(); } catch (e) { /* egal */ }
    try { srcNode && srcNode.disconnect(); gain && gain.disconnect(); } catch (e) { /* egal */ }
    el.removeAttribute('src'); el.load();
    URL.revokeObjectURL(url);
  };
  try {
    el.src = url;
    await waitFor(el, 'loadedmetadata', 15000);
    const total = Number.isFinite(el.duration) ? el.duration : 0;
    let kind = opt.kind;
    if (kind === 'video' && !el.videoWidth) kind = 'audio';   // z.B. WebM nur mit Ton
    const start = opt.startMode === 'mitte' && total > opt.seconds ? (total - opt.seconds) / 2 : 0;
    const len = total ? Math.min(opt.seconds, total - start) : opt.seconds;
    if (start > 0) { el.currentTime = start; await waitFor(el, 'seeked', 15000); }
    else if (el.readyState < 2) await waitFor(el, 'loadeddata', 15000);

    const mime = recorderMime(kind);
    if (!mime) throw new Error('Dieser Browser kann keine Ausschnitte aufnehmen (Chrome, Edge oder Firefox verwenden)');

    const stream = new MediaStream();
    let w = 0, h = 0, canvas = null, ctx2d = null;
    if (kind === 'video') {
      const scale = Math.min(1, opt.edge / Math.max(el.videoWidth, el.videoHeight));
      w = Math.max(2, Math.round(el.videoWidth * scale / 2) * 2);
      h = Math.max(2, Math.round(el.videoHeight * scale / 2) * 2);
      canvas = document.createElement('canvas');
      canvas.width = w; canvas.height = h;
      ctx2d = canvas.getContext('2d');
      ctx2d.drawImage(el, 0, 0, w, h);
      canvas.captureStream(15).getVideoTracks().forEach(t => stream.addTrack(t));
    }
    const withAudio = kind === 'audio' || opt.withAudio;
    const actx = withAudio ? cmpGetAudioCtx() : null;
    if (withAudio && actx) {
      // Ton läuft nur in die Aufnahme, nicht aus dem Lautsprecher
      srcNode = actx.createMediaElementSource(el);
      gain = actx.createGain();
      const dest = actx.createMediaStreamDestination();
      srcNode.connect(gain).connect(dest);
      dest.stream.getAudioTracks().forEach(t => stream.addTrack(t));
      const t0 = actx.currentTime, fade = Math.min(0.3, len / 4);
      gain.gain.setValueAtTime(0, t0);
      gain.gain.linearRampToValueAtTime(1, t0 + fade);
      gain.gain.setValueAtTime(1, t0 + Math.max(fade, len - fade));
      gain.gain.linearRampToValueAtTime(0, t0 + len);
    } else {
      el.muted = true;
    }
    if (!stream.getTracks().length) throw new Error('Keine Bild- oder Tonspur gefunden');

    const chunks = [];
    rec = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 220000, audioBitsPerSecond: 40000 });
    rec.ondataavailable = e => { if (e.data && e.data.size) chunks.push(e.data); };
    const finished = new Promise(res => { rec.onstop = res; });

    const draw = () => {
      if (stopped || !ctx2d) return;
      ctx2d.drawImage(el, 0, 0, w, h);
      if (el.requestVideoFrameCallback) el.requestVideoFrameCallback(draw);
      else requestAnimationFrame(draw);
    };
    rec.start(250);
    const recStart = performance.now();
    try {
      await el.play();
    } catch (e) {
      if (!withAudio) throw e;
      el.muted = true;          // Ton nicht erlaubt: ohne Ton weiter
      await el.play();
    }
    draw();
    const stop = () => {
      if (rec.state !== 'inactive') { try { rec.requestData(); } catch (e) { /* egal */ } rec.stop(); }
      stopped = true;
      el.pause();
    };
    el.addEventListener('ended', stop, { once: true });
    el.addEventListener('timeupdate', () => { if (el.currentTime >= start + len) stop(); });
    stopTimer = setTimeout(stop, len * 1000 + 1500);
    await finished;

    let out = new Blob(chunks, { type: mime.split(';')[0] });
    if (!out.size) throw new Error('Aufnahme ist leer');
    if (mime.includes('webm')) {
      const ms = Math.min(performance.now() - recStart, len * 1000 + 300);
      out = new Blob([fixWebmDuration(new Uint8Array(await out.arrayBuffer()), ms)], { type: out.type });
    }
    return { blob: out, ext: mimeExt(mime), kind, w, h,
      duration: Math.round(total * 10) / 10, clip: Math.round(len * 10) / 10 };
  } finally {
    cleanup();
  }
}

/* ------------------------------------------------------------
   Fiktive Beispiel-Rohdaten (eigene Grafiken, keine echten
   Spielinhalte): Skins, Rucksäcke, Tänze und eine Item-Liste
   ------------------------------------------------------------ */
async function buildDemoFiles(onProgress) {
  const files = [];
  const rnd = (a, b) => a + Math.random() * (b - a);
  const rar = ['gewöhnlich', 'selten', 'episch', 'legendär'];
  const skins = ['Neon Ninja', 'Kaktus Kalle', 'Galaxy Gina', 'Pixel Pirat', 'Lava Luca',
    'Frost Fiona', 'Robo Rico', 'Banana Ben', 'Schatten Sam', 'Disco Dana', 'Alpen Alex', 'Matrix Mia'];
  const packs = ['Raketen-Rucksack', 'Pizza-Box', 'Mini-Drache', 'Kristall-Flügel',
    'Gitarren-Case', 'Kuhglocke', 'Satelliten-Schüssel', 'Bergsteiger-Pack'];
  const dances = ['Robo-Wackler', 'Fondue-Shuffle', 'Pixel-Hüpfer', 'Disco-Kreisel', 'Matterhorn-Moonwalk',
    'Banana-Boogie', 'Alphorn-Groove', 'Schneeflocken-Spin', 'Laser-Lasso', 'Kuhglocken-Klatsch'];

  const toBlob = (c, type) => new Promise(r => c.toBlob(r, type));

  function paintBase(ctx, size, hue) {
    const g = ctx.createLinearGradient(0, 0, size, size);
    g.addColorStop(0, `hsl(${hue},85%,60%)`);
    g.addColorStop(1, `hsl(${(hue + 70) % 360},80%,30%)`);
    ctx.fillStyle = g; ctx.fillRect(0, 0, size, size);
    for (let i = 0; i < 900; i++) { // Rauschen: macht die PNGs realistisch gross
      ctx.fillStyle = `hsla(${rnd(0, 360)},70%,${rnd(40, 90)}%,${rnd(0.05, 0.25)})`;
      ctx.fillRect(rnd(0, size), rnd(0, size), rnd(2, 14), rnd(2, 14));
    }
  }
  function label(ctx, size, text) {
    ctx.fillStyle = 'rgba(0,0,0,.45)';
    ctx.fillRect(0, size * 0.84, size, size * 0.16);
    ctx.fillStyle = '#fff';
    ctx.font = `bold ${Math.round(size * 0.07)}px system-ui, sans-serif`;
    ctx.textAlign = 'center';
    ctx.fillText(text, size / 2, size * 0.94);
  }

  let step = 0;
  const total = skins.length + packs.length + 2;
  for (let i = 0; i < skins.length; i++) {
    const size = 1024, c = document.createElement('canvas');
    c.width = c.height = size;
    const ctx = c.getContext('2d');
    const hue = (i * 31) % 360;
    paintBase(ctx, size, hue);
    ctx.fillStyle = `hsl(${(hue + 180) % 360},70%,25%)`;
    ctx.beginPath(); ctx.arc(size / 2, size * 0.3, size * 0.12, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath();
    ctx.moveTo(size * 0.32, size * 0.8); ctx.lineTo(size * 0.38, size * 0.45);
    ctx.lineTo(size * 0.62, size * 0.45); ctx.lineTo(size * 0.68, size * 0.8); ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.beginPath(); ctx.arc(size * 0.46, size * 0.29, size * 0.018, 0, 7); ctx.arc(size * 0.54, size * 0.29, size * 0.018, 0, 7); ctx.fill();
    label(ctx, size, skins[i]);
    files.push(new File([await toBlob(c, 'image/png')], skins[i] + '.png', { type: 'image/png' }));
    files[files.length - 1].relPath = 'skins/' + skins[i] + '.png';
    onProgress(++step / total);
  }
  for (let i = 0; i < packs.length; i++) {
    const size = 800, c = document.createElement('canvas');
    c.width = c.height = size;
    const ctx = c.getContext('2d');
    const hue = (i * 47 + 200) % 360;
    paintBase(ctx, size, hue);
    ctx.fillStyle = `hsl(${(hue + 160) % 360},60%,35%)`;
    ctx.beginPath();
    ctx.roundRect ? ctx.roundRect(size * 0.28, size * 0.22, size * 0.44, size * 0.56, size * 0.08)
      : ctx.rect(size * 0.28, size * 0.22, size * 0.44, size * 0.56);
    ctx.fill();
    ctx.strokeStyle = '#fff'; ctx.lineWidth = size * 0.02;
    ctx.beginPath(); ctx.arc(size / 2, size * 0.22, size * 0.1, Math.PI, 0); ctx.stroke();
    label(ctx, size, packs[i]);
    files.push(new File([await toBlob(c, 'image/png')], packs[i] + '.png', { type: 'image/png' }));
    files[files.length - 1].relPath = 'rucksaecke/' + packs[i] + '.png';
    onProgress(++step / total);
  }
  const danceList = dances.map((n, i) => ({
    id: i + 1, name: n, dauer_s: Math.round(rnd(3, 12) * 10) / 10,
    bpm: Math.round(rnd(90, 140)), seltenheit: rar[i % 4], loop: i % 3 !== 0
  }));
  const dj = new File([JSON.stringify({ quelle: 'Fiktive Beispieldaten aus Durchblick', taenze: danceList }, null, 2)],
    'taenze.json', { type: 'application/json' });
  dj.relPath = 'taenze/taenze.json';
  files.push(dj);
  onProgress(++step / total);
  const csv = ['typ,name,seltenheit,preis_muenzen']
    .concat(skins.map((n, i) => `skin,${n},${rar[i % 4]},${[800, 1200, 1500, 2000][i % 4]}`))
    .concat(packs.map((n, i) => `rucksack,${n},${rar[(i + 1) % 4]},${[400, 600, 800, 1200][(i + 1) % 4]}`));
  const cf = new File([csv.join('\n') + '\n'], 'items.csv', { type: 'text/csv' });
  cf.relPath = 'items.csv';
  files.push(cf);

  // Sounds als WAV (gross, unkomprimiert - wie echte Rohdaten)
  for (const [name, notes, bpm] of [
    ['Sieges-Jingle', [523, 659, 784, 1047, 784, 1047, 1319], 150],
    ['Emote-Beat', [220, 0, 330, 0, 262, 294, 0, 392], 120]]) {
    files.push(Object.assign(new File([await synthWav(notes, bpm, 12)], name + '.wav', { type: 'audio/wav' }),
      { relPath: 'sounds/' + name + '.wav' }));
  }
  // Tanz-Videos (werden live aufgenommen, darum parallel)
  if (recorderMime('video')) {
    const vids = await Promise.all(['Robo-Wackler', 'Disco-Kreisel'].map((n, i) => recordDanceVideo(n, i, 6)));
    vids.forEach((b, i) => { if (b) {
      const n = ['Robo-Wackler', 'Disco-Kreisel'][i];
      files.push(Object.assign(new File([b], n + '.webm', { type: 'video/webm' }), { relPath: 'taenze/' + n + '.webm' }));
    } });
  }
  onProgress(1);
  return files;
}

/* Kleine Melodie als 16-bit-WAV (mono, 44.1 kHz) */
async function synthWav(notes, bpm, seconds) {
  const rate = 44100, OAC = window.OfflineAudioContext || window.webkitOfflineAudioContext;
  const ctx = new OAC(1, rate * seconds, rate);
  const beat = 60 / bpm;
  for (let t = 0, i = 0; t < seconds - beat; t += beat, i++) {
    const f = notes[i % notes.length];
    if (!f) continue;
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.type = i % 2 ? 'square' : 'triangle';
    o.frequency.value = f;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.25, t + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, t + beat * 0.9);
    o.connect(g).connect(ctx.destination);
    o.start(t); o.stop(t + beat);
  }
  const buf = await ctx.startRendering();
  const pcm = buf.getChannelData(0);
  const out = new DataView(new ArrayBuffer(44 + pcm.length * 2));
  const str = (o, s) => { for (let i = 0; i < s.length; i++) out.setUint8(o + i, s.charCodeAt(i)); };
  str(0, 'RIFF'); out.setUint32(4, 36 + pcm.length * 2, true); str(8, 'WAVE'); str(12, 'fmt ');
  out.setUint32(16, 16, true); out.setUint16(20, 1, true); out.setUint16(22, 1, true);
  out.setUint32(24, rate, true); out.setUint32(28, rate * 2, true); out.setUint16(32, 2, true);
  out.setUint16(34, 16, true); str(36, 'data'); out.setUint32(40, pcm.length * 2, true);
  for (let i = 0; i < pcm.length; i++) out.setInt16(44 + i * 2, Math.max(-1, Math.min(1, pcm[i])) * 0x7FFF, true);
  return new Blob([out.buffer], { type: 'audio/wav' });
}

/* Tanzende Figur als Video aufnehmen (640x640, mit Beat) */
async function recordDanceVideo(name, seed, seconds) {
  const size = 640, c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d');
  const stream = c.captureStream(30);
  const actx = cmpGetAudioCtx();
  let osc = null;
  if (actx) {
    const dest = actx.createMediaStreamDestination(), g = actx.createGain();
    osc = actx.createOscillator();
    osc.type = 'square'; osc.frequency.value = seed ? 196 : 147;
    g.gain.value = 0;
    const t0 = actx.currentTime;
    for (let t = 0; t < seconds; t += 0.25) {
      g.gain.setValueAtTime(0.12, t0 + t);
      g.gain.setTargetAtTime(0, t0 + t + 0.02, 0.04);
    }
    osc.connect(g).connect(dest);
    osc.start();
    dest.stream.getAudioTracks().forEach(t => stream.addTrack(t));
  }
  const mime = recorderMime('video');
  const rec = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 2500000 });
  const chunks = [];
  rec.ondataavailable = e => { if (e.data.size) chunks.push(e.data); };
  const done = new Promise(r => { rec.onstop = r; });
  const t0 = performance.now();
  const frame = () => {
    const t = (performance.now() - t0) / 1000;
    const hue = (seed * 140 + t * 40) % 360;
    ctx.fillStyle = `hsl(${hue},70%,18%)`; ctx.fillRect(0, 0, size, size);
    for (let i = 0; i < 6; i++) {
      ctx.fillStyle = `hsla(${(hue + i * 60) % 360},90%,60%,.35)`;
      ctx.beginPath(); ctx.arc(size / 2 + Math.cos(t * 2 + i) * 220, size / 2 + Math.sin(t * 3 + i) * 220, 40, 0, 7); ctx.fill();
    }
    const sw = Math.sin(t * Math.PI * 4), cx = size / 2 + sw * 40;
    ctx.strokeStyle = '#fff'; ctx.lineWidth = 16; ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.arc(cx, 190, 44, 0, 7);
    ctx.moveTo(cx, 236); ctx.lineTo(size / 2, 380);
    ctx.moveTo(cx, 270); ctx.lineTo(cx - 90, 230 + sw * 70);
    ctx.moveTo(cx, 270); ctx.lineTo(cx + 90, 230 - sw * 70);
    ctx.moveTo(size / 2, 380); ctx.lineTo(size / 2 - 70, 500 + sw * 20);
    ctx.moveTo(size / 2, 380); ctx.lineTo(size / 2 + 70, 500 - sw * 20);
    ctx.stroke();
    ctx.fillStyle = '#fff'; ctx.font = 'bold 40px system-ui, sans-serif'; ctx.textAlign = 'center';
    ctx.fillText(name, size / 2, 590);
    if (t < seconds) requestAnimationFrame(frame); else { rec.stop(); if (osc) osc.stop(); }
  };
  rec.start(250);
  frame();
  await done;
  return chunks.length ? new Blob(chunks, { type: 'video/webm' }) : null;
}

/* ------------------------------------------------------------
   Oberfläche
   ------------------------------------------------------------ */
document.addEventListener('DOMContentLoaded', () => {
  const $ = id => document.getElementById(id);
  const el = {
    drop: $('cmpDrop'), pickFolder: $('cmpPickFolder'), pickFiles: $('cmpPickFiles'), demo: $('cmpDemo'),
    folderInput: $('cmpFolderInput'), filesInput: $('cmpFilesInput'),
    preview: $('cmpPreview'), previewName: $('cmpPreviewName'), previewMeta: $('cmpPreviewMeta'),
    remove: $('cmpRemove'), mode: $('cmpMode'), userRow: $('cmpUserRow'), user: $('cmpUser'),
    project: $('cmpProject'), edge: $('cmpEdge'), format: $('cmpFormat'), quality: $('cmpQuality'),
    qualityVal: $('cmpQualityVal'), video: $('cmpVideo'), maxOther: $('cmpMaxOther'),
    perFolder: $('cmpPerFolder'), info: $('cmpInfo'),
    audio: $('cmpAudio'), clipLen: $('cmpClipLen'), clipStart: $('cmpClipStart'), clipSound: $('cmpClipSound'),
    baseDrop: $('cmpBaseDrop'), baseInput: $('cmpBaseInput'), basePreview: $('cmpBasePreview'),
    baseName: $('cmpBaseName'), baseRemove: $('cmpBaseRemove'),
    run: $('cmpRun'), inputCard: $('cmpInputCard'), progressCard: $('cmpProgressCard'),
    bar: $('cmpBar'), percent: $('cmpPercent'), phase: $('cmpPhase'), detail: $('cmpDetail'),
    current: $('cmpCurrent'), cancel: $('cmpCancel'),
    resultCard: $('cmpResultCard'), errorCard: $('cmpErrorCard'), errorMsg: $('cmpErrorMessage')
  };

  // Quelle: Liste von { path, size, getBlob() }
  let source = null;     // { label, items }
  let base = null;       // { file, entries, prefix }
  let running = false, cancelled = false, lastZip = null;

  const updateBtn = () => { el.run.disabled = running || !source; };
  const showErr = msg => {
    el.progressCard.hidden = true;
    el.errorMsg.textContent = msg;
    el.errorCard.hidden = false;
  };

  function commonTop(paths) {
    const first = paths[0].split('/')[0];
    return paths.length && paths.every(p => p.includes('/') && p.split('/')[0] === first) ? first : '';
  }

  function describe(items) {
    const k = { image: 0, gif: 0, video: 0, audio: 0, text: 0, other: 0 };
    let size = 0;
    for (const it of items) { k[cmpKind(it.path)]++; size += it.size; }
    const parts = [];
    if (k.image + k.gif) parts.push((k.image + k.gif) + ' Bilder');
    if (k.video) parts.push(k.video + ' Videos');
    if (k.audio) parts.push(k.audio + ' Audio');
    if (k.text) parts.push(k.text + ' Textdateien');
    if (k.other) parts.push(k.other + ' andere');
    return items.length.toLocaleString('de-CH') + ' Dateien (' + parts.join(', ') + ') - ' + formatFileSize(size);
  }

  function setSource(label, items) {
    items = items.filter(it => !cmpIsJunk(it.path));
    if (!items.length) { showErr('Keine verwertbaren Dateien gefunden.'); return; }
    if (items.length > CMP.MAX_INPUT_FILES) {
      showErr('Zu viele Dateien (' + items.length.toLocaleString('de-CH') + '). Maximal ' +
        CMP.MAX_INPUT_FILES.toLocaleString('de-CH') + ' pro Durchgang.');
      return;
    }
    source = { label, items };
    el.previewName.textContent = label;
    el.previewMeta.textContent = describe(items);
    el.preview.hidden = false;
    el.drop.hidden = true;
    el.errorCard.hidden = true;
    el.resultCard.hidden = true;
    updateBtn();
  }

  function fromFileList(list, label) {
    const items = Array.from(list).map(f => ({
      path: f.relPath || f.webkitRelativePath || f.name, size: f.size, getBlob: async () => f
    }));
    setSource(label, items);
  }

  async function fromZip(file) {
    try {
      const entries = (await parseZip(file)).filter(e => !e.name.endsWith('/'));
      const items = entries.map(e => ({
        path: e.name, size: e.uncompSize,
        getBlob: async () => new Blob([await readEntryData(file, e)])
      }));
      setSource('📦 ' + file.name, items);
    } catch (err) { showErr('ZIP konnte nicht gelesen werden: ' + err.message); }
  }

  el.pickFolder.addEventListener('click', e => { e.stopPropagation(); el.folderInput.click(); });
  el.pickFiles.addEventListener('click', e => { e.stopPropagation(); el.filesInput.click(); });
  el.drop.addEventListener('click', () => el.filesInput.click());
  el.folderInput.addEventListener('change', e => {
    const fl = e.target.files;
    if (fl.length) fromFileList(fl, '📁 ' + (fl[0].webkitRelativePath.split('/')[0] || 'Ordner'));
  });
  el.filesInput.addEventListener('change', e => {
    const fl = Array.from(e.target.files);
    if (fl.length === 1 && /\.zip$/i.test(fl[0].name)) fromZip(fl[0]);
    else if (fl.length) fromFileList(fl, '🗂️ ' + fl.length + ' ausgewählte Dateien');
  });
  el.drop.addEventListener('dragover', e => { e.preventDefault(); el.drop.classList.add('dragover'); });
  el.drop.addEventListener('dragleave', () => el.drop.classList.remove('dragover'));
  el.drop.addEventListener('drop', async e => {
    e.preventDefault();
    el.drop.classList.remove('dragover');
    const items = Array.from(e.dataTransfer.items || []);
    const entries = items.map(i => i.webkitGetAsEntry && i.webkitGetAsEntry()).filter(Boolean);
    if (entries.some(en => en.isDirectory)) {
      const files = [];
      const walk = (entry, prefix) => new Promise(res => {
        if (entry.isFile) {
          entry.file(f => { f.relPath = prefix + f.name; files.push(f); res(); }, () => res());
        } else {
          const reader = entry.createReader();
          const all = [];
          const read = () => reader.readEntries(async batch => {
            if (!batch.length) {
              for (const b of all) await walk(b, prefix + entry.name + '/');
              res();
            } else { all.push(...batch); read(); }
          }, () => res());
          read();
        }
      });
      for (const en of entries) await walk(en, '');
      fromFileList(files, '📁 ' + entries.map(en => en.name).join(', '));
      return;
    }
    const fl = Array.from(e.dataTransfer.files);
    if (fl.length === 1 && /\.zip$/i.test(fl[0].name)) fromZip(fl[0]);
    else if (fl.length) fromFileList(fl, '🗂️ ' + fl.length + ' Dateien');
  });
  el.remove.addEventListener('click', () => {
    source = null;
    el.folderInput.value = ''; el.filesInput.value = '';
    el.preview.hidden = true; el.drop.hidden = false;
    updateBtn();
  });

  el.demo.addEventListener('click', async e => {
    e.stopPropagation();
    el.demo.disabled = true;
    const old = el.demo.textContent;
    try {
      const files = await buildDemoFiles(p => { el.demo.textContent = '⏳ Erzeuge Beispieldaten … ' + Math.round(p * 100) + '%'; });
      fromFileList(files, '🎲 Beispiel-Rohdaten «Game-Shop» (fiktiv)');
      el.mode.value = 'sort';
      el.user.value = 'gamer';
      el.project.value = 'game_shop';
      el.mode.dispatchEvent(new Event('change'));
    } catch (err) { showErr('Beispieldaten konnten nicht erzeugt werden: ' + err.message); }
    el.demo.textContent = old;
    el.demo.disabled = false;
  });

  el.mode.addEventListener('change', () => { el.userRow.hidden = el.mode.value !== 'sort'; });
  el.quality.addEventListener('input', () => { el.qualityVal.textContent = el.quality.value + ' %'; });

  // Optional: bestehendes Rohdaten-ZIP ergänzen
  el.baseDrop.addEventListener('click', () => el.baseInput.click());
  el.baseInput.addEventListener('change', async e => {
    const f = e.target.files[0];
    if (!f) return;
    try {
      const entries = (await parseZip(f)).filter(en => !en.name.endsWith('/'));
      const names = entries.map(en => en.name);
      const top = commonTop(names);
      base = { file: f, entries, prefix: top ? top + '/' : '' };
      el.baseName.textContent = '📦 ' + f.name + ' - ' + entries.length.toLocaleString('de-CH') +
        ' Einträge werden unverändert übernommen';
      el.basePreview.hidden = false;
      el.baseDrop.hidden = true;
    } catch (err) { showErr('Basis-ZIP konnte nicht gelesen werden: ' + err.message); }
  });
  el.baseRemove.addEventListener('click', () => {
    base = null; el.baseInput.value = '';
    el.basePreview.hidden = true; el.baseDrop.hidden = false;
  });

  el.cancel.addEventListener('click', () => { cancelled = true; });
  el.run.addEventListener('click', run);
  $('cmpRetry').addEventListener('click', () => { el.errorCard.hidden = true; });
  $('cmpAgain').addEventListener('click', () => {
    el.resultCard.hidden = true;
    el.inputCard.scrollIntoView({ behavior: 'smooth' });
  });

  function setProgress(pct, phase, detail) {
    el.bar.style.width = pct + '%';
    el.percent.textContent = pct + '%';
    if (phase) el.phase.textContent = phase;
    if (detail !== undefined) el.detail.textContent = detail;
  }

  async function run() {
    if (running || !source) return;
    running = true; cancelled = false; updateBtn();
    el.resultCard.hidden = true; el.errorCard.hidden = true; el.progressCard.hidden = false;
    setProgress(0, 'Bereite vor …', '');

    const opt = {
      sort: el.mode.value === 'sort',
      user: el.user.value,
      project: cleanSegment(el.project.value || 'mein_projekt'),
      edge: parseInt(el.edge.value, 10),
      format: el.format.value,
      quality: parseInt(el.quality.value, 10) / 100,
      video: el.video.value,
      audio: el.audio.value,
      clipSeconds: parseInt(el.clipLen.value, 10),
      clipStart: el.clipStart.value,
      clipSound: el.clipSound.checked,
      maxOther: parseInt(el.maxOther.value, 10),
      perFolder: Math.max(0, parseInt(el.perFolder.value, 10) || 0),
      info: el.info.checked
    };
    const fmtExt = { 'image/webp': 'webp', 'image/jpeg': 'jpg', 'image/png': 'png' };

    const zip = new ZipWriter();
    const stats = { inBytes: 0, outBytes: 0, files: 0, images: 0, posters: 0, clips: 0, audios: 0, kept: 0, copied: 0 };
    const skipped = [];
    const manifest = [];

    try {
      // 1) Basis-ZIP unverändert übernehmen
      if (base) {
        let i = 0;
        for (const en of base.entries) {
          if (en.flags & 1) { skipped.push([en.name, 'verschlüsselt']); continue; }
          zip.addRaw(en.name, await zipEntryRawBlob(base.file, en), en);
          stats.copied++;
          if (++i % 200 === 0) {
            setProgress(Math.round(i / base.entries.length * 20), 'Übernehme Basis-ZIP …',
              i.toLocaleString('de-CH') + ' / ' + base.entries.length.toLocaleString('de-CH'));
            await new Promise(r => setTimeout(r, 0));
            if (cancelled) throw new Error('abgebrochen');
          }
        }
      }

      // 2) Zielpfade bestimmen
      const items = source.items.slice().sort((a, b) => a.path.localeCompare(b.path, 'de'));
      const top = commonTop(items.map(it => it.path));
      const rootPrefix = opt.sort
        ? (base ? base.prefix : opt.project + '/') + 'Files/' + opt.user + '/' + opt.project + '/'
        : '';
      const perFolderCount = new Map();
      const targetOf = it => {
        let rel = it.path.replace(/\\/g, '/').replace(/^\/+/, '');
        if (opt.sort) {
          if (top) rel = rel.slice(top.length + 1);
          rel = rel.split('/').filter(s => s && s !== '.' && s !== '..').map(cleanSegment).join('/');
          return rootPrefix + rel;
        }
        return rel.split('/').filter(s => s && s !== '.' && s !== '..').join('/');
      };

      // 3) Dateien verarbeiten. Ein Element kann mehrere Ausgaben liefern
      //    (z.B. Kurzclip + Vorschaubild). Clips laufen in Echtzeit, darum
      //    bis zu 3 gleichzeitig; ZIP-Einträge werden der Reihe nach geschrieben.
      const tooBig = it => opt.maxOther && it.size > opt.maxOther;
      const sizeNote = () => 'grösser als ' + formatFileSize(opt.maxOther);

      async function imageOut(blob, it, target) {
        const r = await shrinkImage(blob, opt.edge, opt.format, opt.quality);
        const keepOriginal = r.blob.size >= blob.size && r.w <= opt.edge && r.h <= opt.edge &&
          !['jpg', 'jpeg'].includes(cmpExt(it.path));
        stats.images++;
        return keepOriginal
          ? { name: target, data: blob, note: { breite: r.w, hoehe: r.h } }
          : { name: changeExt(target, fmtExt[r.blob.type] || 'jpg'), data: r.blob,
              note: { breite: r.cw, hoehe: r.ch, original_breite: r.w, original_hoehe: r.h } };
      }

      async function processItem(it, kind, target) {
        const blob = await it.getBlob();
        if (kind === 'image') return [await imageOut(blob, it, target)];
        if (kind === 'gif') {
          if (opt.video === 'skip') throw new Error('GIF übersprungen');
          if ((opt.video === 'keep' || opt.video.startsWith('clip')) && !tooBig(it)) {
            stats.kept++;
            return [{ name: target, data: blob }];
          }
          if (opt.video === 'keep') throw new Error(sizeNote());
          return [await imageOut(blob, it, target)];   // erstes Bild des GIFs
        }
        if (kind === 'video') {
          if (opt.video === 'skip') throw new Error('Video übersprungen');
          if (opt.video === 'keep') {
            if (tooBig(it)) throw new Error(sizeNote());
            stats.kept++;
            return [{ name: target, data: blob }];
          }
          const outs = [];
          if (opt.video.startsWith('clip')) {
            const r = await mediaClip(blob, { kind: 'video', seconds: opt.clipSeconds, startMode: opt.clipStart,
              edge: opt.edge, withAudio: opt.clipSound });
            stats.clips++;
            outs.push({ name: changeExt(target, 'clip.' + r.ext), data: r.blob,
              note: { breite: r.w, hoehe: r.h, dauer_s: r.duration, clip_s: r.clip, art: 'Kurzclip aus Video' } });
          }
          if (opt.video === 'poster' || opt.video === 'clippost') {
            const r = await videoPoster(blob, opt.edge, opt.format, opt.quality);
            stats.posters++;
            outs.push({ name: changeExt(target, 'vorschau.' + (fmtExt[r.blob.type] || 'jpg')), data: r.blob,
              note: { breite: r.cw, hoehe: r.ch, dauer_s: r.duration, art: 'Vorschaubild aus Video' } });
          }
          return outs;
        }
        if (kind === 'audio') {
          if (opt.audio === 'skip') throw new Error('Audio übersprungen');
          if (opt.audio === 'keep') {
            if (tooBig(it)) throw new Error(sizeNote());
            stats.kept++;
            return [{ name: target, data: blob }];
          }
          const r = await mediaClip(blob, { kind: 'audio', seconds: opt.clipSeconds, startMode: opt.clipStart });
          stats.audios++;
          return [{ name: changeExt(target, 'clip.' + r.ext), data: r.blob,
            note: { dauer_s: r.duration, clip_s: r.clip, art: 'Ausschnitt aus Audio' } }];
        }
        if (tooBig(it)) throw new Error(sizeNote());
        stats.kept++;
        return [{ name: target, data: blob, deflate: true }];
      }

      // Pro Ordner höchstens opt.perFolder Dateien (in sortierter Reihenfolge)
      const jobs = [];
      for (const it of items) {
        const target = targetOf(it);
        const dir = target.slice(0, target.lastIndexOf('/') + 1);
        if (opt.perFolder) {
          const n = perFolderCount.get(dir) || 0;
          if (n >= opt.perFolder) { skipped.push([it.path, 'Ordnerlimit (' + opt.perFolder + ')']); continue; }
          perFolderCount.set(dir, n + 1);
        }
        jobs.push({ it, kind: cmpKind(it.path), target });
      }

      const slow = j => j.kind === 'audio' || (j.kind === 'video' && opt.video.startsWith('clip'));
      const nSlow = jobs.filter(slow).length;
      let writeChain = Promise.resolve(), doneCount = 0;
      const started = performance.now();
      const progress = (label) => {
        const el2 = (performance.now() - started) / 1000;
        const pct = Math.round(doneCount / Math.max(1, jobs.length) * (base ? 78 : 98)) + (base ? 20 : 0);
        setProgress(pct, nSlow ? 'Verkleinere Dateien und schneide Clips …' : 'Verkleinere Dateien …',
          doneCount + ' / ' + jobs.length + ' Dateien' +
          (el2 > 3 && doneCount > 0 ? ' - noch ca. ' + formatDuration(el2 / doneCount * (jobs.length - doneCount)) : ''));
        if (label) el.current.textContent = label;
      };
      const write = (job, outs) => {
        writeChain = writeChain.then(async () => {
          for (const o of outs) {
            const data = o.data instanceof Uint8Array ? o.data : new Uint8Array(await o.data.arrayBuffer());
            let unique = o.name, n = 2;
            while (zip.has(unique)) unique = changeExt(o.name, '').replace(/\.$/, '') + '_' + (n++) + '.' + cmpExt(o.name);
            await zip.add(unique, data, { deflate: !!o.deflate });
            stats.files++;
            stats.outBytes += data.length;
            manifest.push(Object.assign({ pfad: '/' + unique, quelle: job.it.path,
              groesse_vorher: job.it.size, groesse_nachher: data.length }, o.note || {}));
          }
          stats.inBytes += job.it.size;
        });
        return writeChain;
      };

      async function worker(queue) {
        while (queue.length) {
          if (cancelled) throw new Error('abgebrochen');
          const job = queue.shift();
          progress((slow(job) ? '🎬 Clip: ' : '📄 ') + job.it.path);
          try {
            await write(job, await processItem(job.it, job.kind, job.target));
          } catch (err) {
            skipped.push([job.it.path, err.message]);
          }
          doneCount++;
          progress();
          await new Promise(r => setTimeout(r, 0));
        }
      }
      const fastQ = jobs.filter(j => !slow(j)), slowQ = jobs.filter(slow);
      await Promise.all([worker(fastQ), worker(slowQ), worker(slowQ), worker(slowQ)]);
      await writeChain;

      if (!stats.files && !stats.copied) throw new Error('Keine Datei konnte übernommen werden.');

      // 4) Beschreibung beilegen
      if (opt.info && stats.files) {
        const infoDir = opt.sort ? rootPrefix : (top ? top + '/' : '');
        const enc = new TextEncoder();
        const info = {
          werkzeug: 'Durchblick Werkstatt - Rohdaten vorbereiten',
          erstellt: new Date().toISOString().slice(0, 10),
          einstellungen: { max_kante_px: opt.edge, format: opt.format, qualitaet: opt.quality, videos: opt.video },
          hinweis: 'Bilder wurden neu kodiert, dabei wurden Metadaten (EXIF, GPS) entfernt.',
          dateien: manifest
        };
        await zip.add(infoDir + '_info.json', enc.encode(JSON.stringify(info, null, 2)));
        const readme = [
          'LIESMICH - vorbereitete Rohdaten',
          '================================',
          'Erstellt mit der Durchblick Werkstatt am ' + new Date().toLocaleDateString('de-CH') + '.',
          '',
          'Quelle der Daten: ________________________________ (bitte ergänzen)',
          'Lizenz / Erlaubnis: ______________________________ (bitte ergänzen)',
          '',
          'Wichtig: Bilder, Videos und Texte aus Spielen, Filmen oder dem Internet',
          'sind meist urheberrechtlich geschützt. Nur im Unterricht verwenden,',
          'nicht öffentlich ins Internet stellen. Keine Fotos von Personen ohne',
          'deren Einverständnis verwenden.'
        ].join('\r\n') + '\r\n';
        await zip.add(infoDir + 'LIESMICH.txt', enc.encode(readme));
      }

      setProgress(100, 'Fertig!', '');
      el.current.textContent = '';
      const blob = zip.finish();
      const name = (opt.sort ? opt.project : 'rohdaten') + '_klein.zip';
      lastZip = new File([blob], name, { type: 'application/zip' });
      showResult(stats, skipped, lastZip);
    } catch (err) {
      if (err.message === 'abgebrochen') showErr('Die Verarbeitung wurde abgebrochen.');
      else showErr('Fehler beim Verkleinern: ' + err.message);
    } finally {
      running = false;
      updateBtn();
    }
  }

  function showResult(stats, skipped, file) {
    el.progressCard.hidden = true;
    const ratio = stats.inBytes > 0 ? Math.max(0, (1 - stats.outBytes / stats.inBytes) * 100) : 0;
    const saved = ratio >= 99 || ratio < 10 ? ratio.toFixed(1) : String(Math.round(ratio));
    $('cmpResFiles').textContent = stats.files.toLocaleString('de-CH');
    $('cmpResBefore').textContent = formatFileSize(stats.inBytes);
    $('cmpResAfter').textContent = formatFileSize(stats.outBytes);
    $('cmpResSaved').textContent = saved + ' %';
    const facts = [
      ['🖼️', 'Bilder verkleinert', String(stats.images)],
      ['🎬', 'Kurzclips aus Videos', String(stats.clips)],
      ['🎵', 'Audio-Ausschnitte', String(stats.audios)],
      ['🖼️', 'Vorschaubilder aus Videos', String(stats.posters)],
      ['📄', 'Unverändert übernommen', String(stats.kept)],
      ['📦', 'Aus Basis-ZIP übernommen', String(stats.copied)],
      ['🗜️', 'ZIP-Datei', file.name + ' (' + formatFileSize(file.size) + ')']
    ];
    $('cmpResFacts').innerHTML = '';
    for (const [i, k, v] of facts) {
      const li = document.createElement('li');
      for (const [cls, t] of [['', i], ['k', k], ['v', v]]) {
        const s = document.createElement('span');
        if (cls) s.className = cls;
        s.textContent = t;
        li.appendChild(s);
      }
      $('cmpResFacts').appendChild(li);
    }
    const sk = $('cmpSkipped');
    sk.innerHTML = '';
    $('cmpSkippedWrap').hidden = skipped.length === 0;
    $('cmpSkippedTitle').textContent = '⏭️ Übersprungen (' + skipped.length + ')';
    for (const [p, why] of skipped.slice(0, 200)) {
      const li = document.createElement('li');
      li.textContent = p + ' - ' + why;
      sk.appendChild(li);
    }
    $('cmpDownload').onclick = () => {
      const url = URL.createObjectURL(file);
      const a = document.createElement('a');
      a.href = url; a.download = file.name;
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 10000);
    };
    $('cmpToGenerator').onclick = () => {
      if (typeof window.useZipInGenerator === 'function') window.useZipInGenerator(file);
    };
    el.resultCard.hidden = false;
    el.resultCard.scrollIntoView({ behavior: 'smooth' });
  }
});
