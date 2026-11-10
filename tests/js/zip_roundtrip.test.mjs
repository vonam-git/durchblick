// Test: ZIP-Schreiber (zipwriter.js) mit dem ZIP-Leser des Generators (generator.js).
// Ausführen: node tests/js/zip_roundtrip.test.mjs [ausgabe.zip]
import { readFileSync, writeFileSync } from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';

const root = new URL('../../web/js/', import.meta.url);
const ctx = vm.createContext({
  document: { addEventListener() {} }, window: {}, console, performance,
  TextEncoder, TextDecoder, Blob, File, Response, CompressionStream, DecompressionStream,
  btoa, atob, BigInt, setTimeout
});
for (const f of ['generator.js', 'zipwriter.js']) {
  vm.runInContext(readFileSync(new URL(f, root), 'utf8'), ctx, { filename: f });
}
const run = code => vm.runInContext(code, ctx);

const result = await run(`(async () => {
  const enc = new TextEncoder();
  const text = enc.encode('Hallo Durchblick! '.repeat(200));
  const bin = new Uint8Array(5000).map((_, i) => (i * 7919) % 256);
  const z = new ZipWriter();
  await z.add('projekt/Files/gamer/spiel/info.txt', text);
  await z.add('projekt/Files/gamer/spiel/bild.webp', bin, { deflate: false });
  await z.add('projekt/Files/gamer/spiel/ümlaut ä.json', enc.encode('{"ok":true}'));
  let dup = false;
  try { await z.add('projekt/Files/gamer/spiel/info.txt', text); } catch (e) { dup = true; }
  let trav = false;
  try { await z.add('../boese.txt', text); } catch (e) { trav = true; }
  const first = new File([z.finish()], 'a.zip');

  // Einträge aus dem ersten ZIP roh in ein zweites übernehmen
  const entries = await parseZip(first);
  const z2 = new ZipWriter();
  for (const e of entries) z2.addRaw('basis/' + e.name, await zipEntryRawBlob(first, e), e);
  await z2.add('basis/neu.txt', enc.encode('neu'));
  const second = new File([z2.finish()], 'b.zip');
  const e2 = await parseZip(second);
  const out = {};
  for (const e of e2) out[e.name] = new TextDecoder().decode((await readEntryData(second, e)).slice(0, 20));
  const bytes = new Uint8Array(await second.arrayBuffer());
  return { dup, trav, methods: entries.map(e => e.method), names: Object.keys(out), out,
           textOk: (await readEntryData(first, entries[0])).length === text.length,
           binOk: (await readEntryData(first, entries[1])).every((b, i) => b === bin[i]),
           bytes: Array.from(bytes) };
})()`);

assert.equal(result.dup, true, 'doppelte Pfade werden abgelehnt');
assert.equal(result.trav, true, '../ wird abgelehnt');
assert.equal(JSON.stringify(result.methods), '[8,0,0]', 'deflate für Text, gespeichert für Bild/kleine Datei');
assert.equal(result.names.length, 4);
assert.ok(result.names.includes('basis/projekt/Files/gamer/spiel/ümlaut ä.json'));
assert.ok(result.textOk && result.binOk);
assert.equal(result.out['basis/neu.txt'], 'neu');
if (process.argv[2]) writeFileSync(process.argv[2], Buffer.from(result.bytes));
console.log('zip_roundtrip: OK', result.names);
