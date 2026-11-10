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
  onProgress(1);
  return files;
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
    const k = { image: 0, gif: 0, video: 0, text: 0, other: 0 };
    let size = 0;
    for (const it of items) { k[cmpKind(it.path)]++; size += it.size; }
    const parts = [];
    if (k.image + k.gif) parts.push((k.image + k.gif) + ' Bilder');
    if (k.video) parts.push(k.video + ' Videos');
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
      maxOther: parseInt(el.maxOther.value, 10),
      perFolder: Math.max(0, parseInt(el.perFolder.value, 10) || 0),
      info: el.info.checked
    };
    const fmtExt = { 'image/webp': 'webp', 'image/jpeg': 'jpg', 'image/png': 'png' };

    const zip = new ZipWriter();
    const stats = { inBytes: 0, outBytes: 0, files: 0, images: 0, posters: 0, kept: 0, copied: 0 };
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

      // 3) Dateien verarbeiten
      const started = performance.now();
      for (let i = 0; i < items.length; i++) {
        if (cancelled) throw new Error('abgebrochen');
        const it = items[i];
        const kind = cmpKind(it.path);
        let target = targetOf(it);
        el.current.textContent = '📄 ' + it.path;
        const pct = 20 + Math.round(i / items.length * 78);
        const el2 = (performance.now() - started) / 1000;
        setProgress(base ? pct : Math.round(i / items.length * 98), 'Verkleinere Dateien …',
          (i + 1) + ' / ' + items.length + ' Dateien' +
          (el2 > 2 && i > 0 ? ' - noch ca. ' + formatDuration(el2 / i * (items.length - i)) : ''));
        if (i % 5 === 0) await new Promise(r => setTimeout(r, 0));

        const dir = target.slice(0, target.lastIndexOf('/') + 1);
        if (opt.perFolder) {
          const n = perFolderCount.get(dir) || 0;
          if (n >= opt.perFolder) { skipped.push([it.path, 'Ordnerlimit (' + opt.perFolder + ')']); continue; }
        }

        let out = null, note = {};
        try {
          const blob = await it.getBlob();
          if (kind === 'image' || (kind === 'gif' && opt.video === 'poster')) {
            const r = await shrinkImage(blob, opt.edge, opt.format, opt.quality);
            const keepOriginal = r.blob.size >= blob.size && r.w <= opt.edge && r.h <= opt.edge &&
              !['jpg', 'jpeg'].includes(cmpExt(it.path));
            if (keepOriginal) out = new Uint8Array(await blob.arrayBuffer());
            else {
              out = new Uint8Array(await r.blob.arrayBuffer());
              target = changeExt(target, fmtExt[r.blob.type] || 'jpg');
            }
            note = { breite: r.cw, hoehe: r.ch, original_breite: r.w, original_hoehe: r.h };
            stats.images++;
          } else if (kind === 'video' || kind === 'gif') {
            if (opt.video === 'skip') { skipped.push([it.path, 'Video übersprungen']); continue; }
            if (opt.video === 'keep') {
              if (opt.maxOther && it.size > opt.maxOther) { skipped.push([it.path, 'grösser als ' + formatFileSize(opt.maxOther)]); continue; }
              out = new Uint8Array(await blob.arrayBuffer());
              stats.kept++;
            } else {
              const r = await videoPoster(blob, opt.edge, opt.format, opt.quality);
              out = new Uint8Array(await r.blob.arrayBuffer());
              target = changeExt(target, 'vorschau.' + (fmtExt[r.blob.type] || 'jpg'));
              note = { breite: r.cw, hoehe: r.ch, dauer_s: r.duration, art: 'Vorschaubild aus Video' };
              stats.posters++;
            }
          } else {
            if (opt.maxOther && it.size > opt.maxOther) { skipped.push([it.path, 'grösser als ' + formatFileSize(opt.maxOther)]); continue; }
            out = new Uint8Array(await blob.arrayBuffer());
            stats.kept++;
          }
        } catch (err) {
          skipped.push([it.path, err.message]);
          continue;
        }

        // Namenskonflikte (z.B. a.png und a.jpg -> a.webp) auflösen
        let unique = target, n = 2;
        while (zip.has(unique)) unique = changeExt(target, '').replace(/\.$/, '') + '_' + (n++) + '.' + cmpExt(target);
        const compressible = !['image', 'gif', 'video'].includes(kind);
        await zip.add(unique, out, { deflate: compressible });
        perFolderCount.set(dir, (perFolderCount.get(dir) || 0) + 1);
        stats.files++;
        stats.inBytes += it.size;
        stats.outBytes += out.length;
        manifest.push(Object.assign({ pfad: '/' + unique, quelle: it.path, groesse_vorher: it.size, groesse_nachher: out.length }, note));
      }

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
      ['🎬', 'Vorschaubilder aus Videos', String(stats.posters)],
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
