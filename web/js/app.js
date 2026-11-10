'use strict';

/* ============================================================
   Durchblick - Weboberfläche (Datenbank-Ansichten, Galerie,
   Design und Navigation). Alle Daten kommen über /api/… vom
   lokalen Webserver, der die Queries aus der Config ausführt.
   ============================================================ */
(() => {
  const $ = s => document.querySelector(s);
  const esc = v => String(v ?? '').replace(/[&<>"']/g,
    c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const fmt = v => (typeof v === 'number') ? v.toLocaleString('de-CH') : esc(v);
  const isEmoji = v => typeof v === 'string' && /\p{Extended_Pictographic}/u.test(v);
  const offline = '<div class="msg error">Der Webserver antwortet nicht. Läuft er noch?</div>';
  const store = {
    get(k) { try { return localStorage.getItem('durchblick.' + k); } catch (e) { return null; } },
    set(k, v) { try { localStorage.setItem('durchblick.' + k, v); } catch (e) { /* privat */ } }
  };

  async function api(path, opts = {}) {
    const headers = Object.assign({ 'X-Durchblick': '1' }, opts.headers || {});
    const r = await fetch(path, Object.assign({ cache: 'no-store', credentials: 'same-origin' }, opts, { headers }));
    if (!r.ok) throw new Error('HTTP ' + r.status);
    return r.json();
  }

  /* ---------------------------------------------- Navigation */
  let browsed = false, galleryLoaded = false;
  const loaders = {
    start: loadStatus, overview: loadOverview, tags: loadTags,
    browse: () => { if (!browsed) { browsed = true; browse(); } },
    gallery: () => { if (!galleryLoaded) { galleryLoaded = true; loadGallery(); } },
    werkstatt: () => {}, design: () => {}, hilfe: () => {}
  };

  function switchTab(id, sub) {
    if (!loaders[id]) id = 'start';
    document.querySelectorAll('.tabbtn').forEach(b => b.classList.toggle('active', b.dataset.tab === id));
    document.querySelectorAll('section.tab').forEach(s => s.classList.toggle('visible', s.id === 'tab-' + id));
    if (id === 'werkstatt' && sub && window.werkstattMode) window.werkstattMode(sub);
    const hash = '#' + id + (sub ? ':' + sub : '');
    if (location.hash !== hash) history.replaceState(null, '', hash);
    loaders[id]();
  }
  function fromHash() {
    const [id, sub] = location.hash.replace(/^#/, '').split(':');
    switchTab(id || 'start', sub);
  }

  /* ---------------------------------------------- Start */
  async function loadStatus() {
    try {
      const d = await api('/api/status');
      $('#appver').textContent = `${d.appname} v${d.appver}`;
      $('#statusbar').innerHTML = `
        <div class="pill ${d.connected ? 'ok' : 'err'}"><b>${d.connected ? 'Datenbank verbunden' : 'Keine Verbindung'}</b></div>
        <div class="pill">DSN: <b>${esc(d.dsn)}</b></div>
        <div class="pill">DB-Software: <b>${esc(d.db_version)}</b></div>`;
      $('#status-error').innerHTML = d.error ? `<div class="msg error">${esc(d.error)}</div>` : '';
      $('#author').textContent = d.author;
      applyUi(d.ui || {});
    } catch (e) { $('#statusbar').innerHTML = offline; }
  }

  let configTheme = 'standard';
  function applyUi(ui) {
    if (ui.titel) { $('#ui-title').textContent = ui.titel; document.title = ui.titel; }
    if (ui.untertitel) $('#ui-subtitle').textContent = ui.untertitel;
    if (ui.logo) $('#ui-logo').textContent = ui.logo;
    if (ui.fusszeile) $('#ui-footer').textContent = ui.fusszeile;
    configTheme = THEMES.some(t => t.id === ui.theme) ? ui.theme : 'standard';
    if (!store.get('preview-theme')) setTheme(configTheme, false);
  }

  /* ---------------------------------------------- Übersicht */
  async function loadOverview() {
    try {
      const d = await api('/api/overview'), v = d.values, er = d.errors;
      const counts = [['Data', 'data_count'], ['Meta', 'meta_count'], ['Type', 'type_count'],
        ['Tag', 'tag_count'], ['User', 'user_count'], ['Gruppen', 'group_count']];
      $('#ov-counts').innerHTML = counts.map(([label, key]) => `
        <div class="stat" title="${esc(er[key] || '')}"><div class="label">${esc(label)}</div>
        <div class="value ${isEmoji(v[key]) ? 'emoji' : ''}">${fmt(v[key])}</div></div>`).join('');
      const sizes = [['Data', 'data_size', 'data_length'], ['Meta', 'meta_size', 'meta_length']];
      $('#ov-sizes').innerHTML = sizes.map(([label, a, b]) =>
        `<tr><td>${esc(label)}</td><td title="${esc(er[a] || '')}">${fmt(v[a])}</td>
         <td title="${esc(er[b] || '')}">${fmt(v[b])}</td></tr>`).join('');
      const msgs = Object.values(er);
      $('#ov-errors').innerHTML = msgs.length
        ? `<h2 class="mt">Fehlermeldungen</h2><pre class="raw error">${esc(msgs.join('\n'))}</pre>` : '';
    } catch (e) { $('#ov-counts').innerHTML = offline; }
  }

  /* ---------------------------------------------- Browser */
  async function browse() {
    const pattern = encodeURIComponent($('#pattern').value || '%');
    const limit = Math.min(500, Math.max(1, parseInt($('#limit').value, 10) || 20));
    const msg = $('#browse-msg'), table = $('#browse-table');
    const clear = () => { table.querySelector('thead').innerHTML = ''; table.querySelector('tbody').innerHTML = ''; };
    try {
      const d = await api(`/api/browse?pattern=${pattern}&limit=${limit}`);
      if (d.error) { msg.innerHTML = `<span class="error">Query-Fehler: ${esc(d.error)}</span>`; clear(); return; }
      msg.textContent = `${d.rows.length} Datensätze gefunden.`;
      if (!d.columns.length) { clear(); return; }
      table.querySelector('thead').innerHTML =
        '<tr>' + d.columns.map(c => `<th>${esc(c)}</th>`).join('') + '</tr>';
      table.querySelector('tbody').innerHTML = d.rows.map(row =>
        '<tr>' + row.map((cell, i) => d.columns[i].toLowerCase() === 'digest'
          ? `<td><a href="#" data-digest="${esc(cell)}">${esc(cell)}</a></td>`
          : `<td>${esc(cell)}</td>`).join('') + '</tr>').join('');
    } catch (e) { msg.innerHTML = offline; clear(); }
  }

  /* ---------------------------------------------- Galerie */
  let galleryFolder = '';
  async function loadGallery() {
    const raw = $('#gal-pattern').value || '%';
    const pattern = encodeURIComponent(raw);
    const limit = Math.min(500, Math.max(1, parseInt($('#gal-limit').value, 10) || 60));
    const msg = $('#gal-msg'), grid = $('#gal-grid');
    try {
      const d = await api(`/api/gallery?pattern=${pattern}&limit=${limit}`);
      if (d.error) { msg.innerHTML = `<span class="error">Query-Fehler: ${esc(d.error)}</span>`; grid.innerHTML = ''; return; }
      const items = d.items || [];
      msg.textContent = items.length ? `${items.length} Bilder.` : 'Keine Bilder gefunden. Hast du schon Bilder importiert?';
      const folders = [...new Set(items.map(it => it.folder))].sort();
      $('#gal-folders').innerHTML = folders.length > 1
        ? ['', ...folders].map(f => `<button class="chip ${f === galleryFolder ? 'active' : ''}" data-folder="${esc(f)}">${f ? '📁 ' + esc(f) : 'Alle'}</button>`).join('')
        : '';
      grid.innerHTML = items.filter(it => !galleryFolder || it.folder === galleryFolder).map(it => `
        <figure class="gallery-item" data-digest="${esc(it.digest)}" tabindex="0">
          <div class="thumb"><img loading="lazy" src="/api/raw/${encodeURIComponent(it.digest)}" alt="${esc(it.name)}"></div>
          <figcaption><div class="name">${esc(it.name)}</div><div class="folder">${esc(it.folder)}</div></figcaption>
        </figure>`).join('');
    } catch (e) { msg.innerHTML = offline; grid.innerHTML = ''; }
  }

  /* ---------------------------------------------- Datensatz-Dialog */
  async function showData(digest) {
    $('#overlay').classList.add('open');
    $('#dialog').innerHTML = '<h2>Lade…</h2>';
    try {
      const d = await api(`/api/data/${encodeURIComponent(digest)}`);
      const tagsHtml = d.tags.length
        ? d.tags.map(t => `<a class="chip" href="#" data-tag="${esc(t)}">${esc(t)}</a>`).join(' ')
        : "<span class='msg'>Keine Tags gesetzt</span>";
      const rawUrl = `/api/raw/${encodeURIComponent(d.digest)}`;
      const isImg = d.paths.some(p => /\.(png|jpe?g|webp|gif|svg|bmp|avif)$/i.test(p));
      $('#dialog').innerHTML = `
        <button class="closex" id="btn-close" aria-label="Schliessen">✕</button>
        <h3>Datensatz <span style="color:var(--accent2)">${esc(d.digest)}</span></h3>
        ${d.error ? `<div class="msg error">Query-Fehler: ${esc(d.error)}</div>` : ''}
        ${isImg ? `<img class="preview-img" src="${rawUrl}" alt="Vorschau">` : ''}
        <p><a href="${rawUrl}" target="_blank" rel="noopener noreferrer">Inhalt entpacken und anzeigen ↗</a></p>
        <h2 class="mt" style="margin-top:18px">Dateipfade</h2>
        <pre class="raw">${esc(d.paths.join('\n'))}</pre>
        <h2 style="margin-top:18px">Tags</h2>
        <div class="chips" style="margin-bottom:10px">${tagsHtml}</div>
        <div class="toolbar">
          <input type="text" id="newtag" placeholder="Neuer Tag" maxlength="100" aria-label="Neuer Tag">
          <button class="btn" id="btn-settag">Tag setzen</button>
        </div>
        <h2 style="margin-top:18px">Gepackte Daten (Base64)</h2>
        <pre class="raw">${esc(d.packed)}</pre>`;
      $('#btn-close').onclick = closeOverlay;
      $('#btn-settag').onclick = () => setTag(d.digest);
      $('#newtag').addEventListener('keydown', e => { if (e.key === 'Enter') setTag(d.digest); });
    } catch (e) { $('#dialog').innerHTML = offline; }
  }

  async function setTag(digest) {
    const tag = $('#newtag').value.trim();
    if (!tag) return;
    try {
      const d = await api('/api/settag', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ digest, tag })
      });
      if (d.ok) showData(digest);
      else alert('Tag konnte nicht gesetzt werden:\n' + (d.error || 'unbekannter Fehler'));
    } catch (e) { alert('Der Webserver antwortet nicht.'); }
  }

  /* ---------------------------------------------- Tags */
  async function loadTags() {
    try {
      const d = await api('/api/tags');
      if (d.error) {
        $('#tags-msg').innerHTML = `<span class="error">Query-Fehler: ${esc(d.error)}</span>`;
        $('#tags-chips').innerHTML = ''; return;
      }
      $('#tags-msg').textContent = d.tags.length ? `${d.tags.length} Tags vorhanden.` : 'Noch keine Tags.';
      $('#tags-chips').innerHTML = d.tags.map(t =>
        `<a class="chip" href="#" data-tag="${esc(t)}">${esc(t)}</a>`).join('');
    } catch (e) { $('#tags-msg').innerHTML = offline; }
  }

  async function showTag(tag) {
    try {
      const d = await api(`/api/tag/${encodeURIComponent(tag)}`);
      $('#tag-detail').innerHTML = `<h2>Pfade für Tag «${esc(tag)}»</h2>` + (d.error
        ? `<div class="msg error">Query-Fehler: ${esc(d.error)}</div>`
        : `<pre class="raw">${esc(d.paths.join('\n')) || 'Keine Pfade gefunden.'}</pre>`);
    } catch (e) { $('#tag-detail').innerHTML = offline; }
  }

  function closeOverlay() { $('#overlay').classList.remove('open'); }

  /* ---------------------------------------------- Design */
  const THEMES = [
    { id: 'standard', name: 'Standard', colors: ['#0f1220', '#171a2b', '#6d4aff', '#e8eaf2'] },
    { id: 'hell', name: 'Hell', colors: ['#f5f6fa', '#ffffff', '#4f46e5', '#1f2330'] },
    { id: 'arcade', name: 'Arcade', colors: ['#12002b', '#24004f', '#ff2bd6', '#2bf7ff'] },
    { id: 'terminal', name: 'Terminal', colors: ['#050805', '#0b120b', '#39ff6a', '#b6ffbf'] },
    { id: 'alpen', name: 'Alpen', colors: ['#ffffff', '#f3f4f6', '#d52b1e', '#1a1a1a'] }
  ];
  const CSS_VARS = [
    ['--bg', 'Hintergrund der Seite'], ['--bg-image', 'Hintergrundbild, z.B. url(/theme/bg.webp)'],
    ['--panel', 'Flächen (Karten, Tabellen)'], ['--panel2', 'Zweite Fläche (Hover, Felder)'],
    ['--border', 'Rahmenfarbe'], ['--text', 'Textfarbe'], ['--muted', 'Gedämpfter Text'],
    ['--accent', 'Akzentfarbe (Buttons, aktive Reiter)'], ['--accent2', 'Zweite Akzentfarbe (Links)'],
    ['--accent-text', 'Text auf Akzentfarbe'], ['--ok', 'Erfolg'], ['--warn', 'Warnung'], ['--err', 'Fehler'],
    ['--header-bg', 'Hintergrund des Kopfbereichs'], ['--radius', 'Eckenradius'],
    ['--font', 'Schriftart'], ['--font-heading', 'Schrift für Titel'], ['--font-size', 'Grundschriftgrösse'],
    ['--gallery-size', 'Breite der Galeriebilder']
  ];
  const EXAMPLE_CSS = `/* Beispiel: eigenes Farbschema und runde Galerie */
:root {
  --accent: #ff7a00;
  --accent2: #ffb347;
  --radius: 22px;
  --gallery-size: 150px;
  --header-bg: linear-gradient(120deg, #ff7a00, #c2005a);
}

.site-title { text-transform: uppercase; letter-spacing: 2px; }

/* Auf farbigem Kopf: heller Text für guten Kontrast */
.site-header, .site-subtitle, .appver { color: #fff; }

.gallery-item .thumb img {
  transition: transform .3s;
}
.gallery-item:hover .thumb img {
  transform: scale(1.12) rotate(-3deg);
}
`;

  function setTheme(id, remember) {
    $('#theme-preset').href = '/static/themes/' + id + '.css';
    document.querySelectorAll('.theme-btn').forEach(b => b.classList.toggle('active', b.dataset.theme === id));
    if (remember) store.set('preview-theme', id === configTheme ? '' : id);
    $('#theme-hint').innerHTML = id === configTheme
      ? `Aktiv ist die Vorlage aus der Config: <b>${esc(id)}</b>.`
      : `Vorschau: <b>${esc(id)}</b>. Damit es für alle gilt, in der Config eintragen: <code>ui:</code> → <code>theme: ${esc(id)}</code>`;
  }

  function initDesign() {
    $('#theme-grid').innerHTML = THEMES.map(t => `
      <button class="theme-btn" data-theme="${t.id}">
        <div class="swatch">${t.colors.map(c => `<i style="background:${c}"></i>`).join('')}</div>
        <span>${esc(t.name)}</span>
      </button>`).join('');
    $('#theme-grid').addEventListener('click', e => {
      const b = e.target.closest('.theme-btn');
      if (b) setTheme(b.dataset.theme, true);
    });
    const preview = store.get('preview-theme');
    setTheme(preview || configTheme, false);

    const cs = getComputedStyle(document.documentElement);
    $('#var-table').innerHTML = CSS_VARS.map(([v, d]) => {
      const val = cs.getPropertyValue(v).trim();
      const isColor = /^#|^rgb|^hsl/.test(val);
      return `<tr><td>${isColor ? `<span class="sw" style="background:${esc(val)}"></span>` : ''}${esc(v)}</td><td>${esc(d)}</td></tr>`;
    }).join('');

    const editor = $('#css-editor'), live = $('#live-css');
    editor.value = store.get('live-css') || '';
    live.textContent = editor.value;
    editor.placeholder = '/* Hier CSS eintippen, die Seite ändert sich sofort */\n:root {\n  --accent: hotpink;\n}';
    let t;
    editor.addEventListener('input', () => {
      clearTimeout(t);
      t = setTimeout(() => { live.textContent = editor.value; store.set('live-css', editor.value); }, 150);
    });
    editor.addEventListener('keydown', e => {
      if (e.key === 'Tab') {
        e.preventDefault();
        const s = editor.selectionStart;
        editor.setRangeText('  ', s, editor.selectionEnd, 'end');
      }
    });
    $('#css-example').onclick = () => { editor.value = EXAMPLE_CSS; editor.dispatchEvent(new Event('input')); };
    $('#css-reset').onclick = () => { editor.value = ''; editor.dispatchEvent(new Event('input')); };
    $('#css-download').onclick = () => {
      const blob = new Blob(['/* eigenes.css - erstellt im Reiter Design */\n' + editor.value + '\n'], { type: 'text/css' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = 'eigenes.css';
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 5000);
    };
  }

  /* ---------------------------------------------- Ereignisse */
  document.addEventListener('click', e => {
    const tab = e.target.closest('.tabbtn');
    if (tab) return switchTab(tab.dataset.tab);
    const go = e.target.closest('[data-goto]');
    if (go) { const [id, sub] = go.dataset.goto.split(':'); return switchTab(id, sub); }
    if (e.target.id === 'overlay') return closeOverlay();
    const folder = e.target.closest('[data-folder]');
    if (folder) { galleryFolder = folder.dataset.folder; return loadGallery(); }
    const el = e.target.closest('[data-digest],[data-tag]');
    if (!el) return;
    e.preventDefault();
    if (el.dataset.digest !== undefined) showData(el.dataset.digest);
    else { closeOverlay(); switchTab('tags'); showTag(el.dataset.tag); }
  });
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') closeOverlay();
    if (e.key === 'Enter' && e.target.classList && e.target.classList.contains('gallery-item')) showData(e.target.dataset.digest);
  });
  $('#btn-search').onclick = browse;
  $('#btn-all').onclick = () => { $('#pattern').value = '%'; browse(); };
  $('#pattern').addEventListener('keydown', e => { if (e.key === 'Enter') browse(); });
  $('#gal-search').onclick = () => { galleryFolder = ''; loadGallery(); };
  $('#gal-pattern').addEventListener('keydown', e => { if (e.key === 'Enter') { galleryFolder = ''; loadGallery(); } });
  window.addEventListener('hashchange', fromHash);

  initDesign();
  if (location.hash) fromHash();
  loadStatus();
})();
