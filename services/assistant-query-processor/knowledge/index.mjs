// Local lexical embeddings and retrieval. Uses only Node built-ins, never a provider API.
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

export const FORMAT = 'samsar-assistant-tfidf-bm25-v1';
const here = path.dirname(fileURLToPath(import.meta.url));
const dataFiles = ['chunks.jsonl', 'documents.jsonl', 'knowledge-base.md', 'sources.json'];
const hash = value => createHash('sha256').update(value).digest('hex');
const sorted = value => Array.isArray(value) ? value.map(sorted) : value && typeof value === 'object'
  ? Object.fromEntries(Object.keys(value).sort().map(key => [key, sorted(value[key])])) : value;
const canonical = value => JSON.stringify(sorted(value));
const jsonl = value => value.toString('utf8').split('\n').filter(Boolean).map(JSON.parse);
const stop = new Set('a an the is are was were be been to of for in on at by from with and or it its this that these those i me my we you your how what why can could should do does did please help use using about would some want make give suggest suggestions'.split(' '));
const aliases = [
  [/รวมเสียง|ต่อเสียง|音声.*(?:結合|つな)|結合|連結/gu, ' audio join combine '],
  [/画像|รูปภาพ|ภาพ/gu, ' image '], [/編集|แก้ไข/gu, ' edit '],
  [/マスク|หน้ากาก/gu, ' mask '], [/音楽|เพลง|ดนตรี/gu, ' music '],
  [/音声|เสียง/gu, ' audio speech '], [/字幕|คำบรรยาย/gu, ' subtitle '],
  [/動画|วิดีโอ/gu, ' video '], [/料金|ราคา|クレジット|เครดิต/gu, ' price credits '],
  [/履歴|ประวัติ/gu, ' history '], [/削除|ล้าง/gu, ' clear delete '],
];
export function tokenize(text) {
  let input = String(text || '').normalize('NFKC').toLowerCase().slice(0, 24000);
  for (const [pattern, replacement] of aliases) input = input.replace(pattern, replacement);
  return (input.match(/[\p{L}\p{N}]+(?:[._-][\p{L}\p{N}]+)*/gu) || [])
    .filter(token => token.length > 1 && !stop.has(token))
    .map(token => /^[a-z]{5,}s$/.test(token) && !token.endsWith('ss') ? token.slice(0, -1) : token);
}
const counts = text => {
  const result = new Map();
  for (const token of tokenize(text)) result.set(token, (result.get(token) || 0) + 1);
  return result;
};
function read(root, name) {
  const target = path.join(root, name);
  if (!fs.lstatSync(target).isFile()) throw new Error('Non-regular knowledge file');
  if (fs.statSync(target).size > 32 * 1024 * 1024) throw new Error('Oversized knowledge file');
  return fs.readFileSync(target);
}
export function readCorpus(root) {
  const manifest = JSON.parse(read(root, 'manifest.json'));
  const chunks = jsonl(read(root, 'chunks.jsonl'));
  const documents = jsonl(read(root, 'documents.jsonl'));
  const sources = JSON.parse(read(root, 'sources.json'));
  for (const [name, rows] of Object.entries({ chunks, documents, sources })) {
    if (!rows.length || rows.length !== manifest[name] || new Set(rows.map(row => row.id)).size !== rows.length) throw new Error('Invalid corpus identities');
  }
  const sourceIds = new Set(sources.map(row => row.id)), documentIds = new Set(documents.map(row => row.id));
  for (const row of [...documents, ...chunks]) {
    if (!row.source_ids?.length || !row.source_ids.every(id => sourceIds.has(id)) ||
        !['public', 'operator'].includes(row.audience) || !['current', 'editorial', 'historical'].includes(row.freshness)) throw new Error('Invalid corpus scope/citations');
  }
  for (const row of chunks) {
    if (!documentIds.has(row.document_id) || hash(row.embedding_text) !== row.input_sha256) throw new Error('Invalid corpus input');
  }
  const byId = rows => [...rows].sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  if (hash(canonical({ chunks: byId(chunks), sources: byId(sources) })) !== manifest.corpus_version) throw new Error('Corpus checksum mismatch');
  return { manifest, chunks, documents, sources };
}
export function createIndex(chunks) {
  const documents = chunks.map(row => counts(`${row.title}\n${row.text}`));
  const frequencies = new Map();
  for (const terms of documents) for (const token of terms.keys()) frequencies.set(token, (frequencies.get(token) || 0) + 1);
  const vocabulary = [...frequencies.keys()].sort();
  const indices = new Map(vocabulary.map((token, index) => [token, index]));
  const idf = vocabulary.map(token => Math.log(1 + (chunks.length - frequencies.get(token) + 0.5) / (frequencies.get(token) + 0.5)));
  const rows = documents.map((terms, row) => {
    let squared = 0;
    const values = [...terms].map(([token, count]) => {
      const id = indices.get(token), weight = (1 + Math.log(count)) * idf[id];
      squared += weight * weight;
      return [id, count, weight];
    }).sort((a, b) => a[0] - b[0]);
    const norm = Math.sqrt(squared) || 1;
    return { id: chunks[row].id, length: [...terms.values()].reduce((a, b) => a + b, 0),
      values: values.map(([id, count, weight]) => [id, count, weight / norm]) };
  });
  return { format: FORMAT, vocabulary, idf, rows, averageLength: rows.reduce((n, row) => n + row.length, 0) / rows.length };
}
export function buildRelease(snapshot = path.join(here, 'snapshot'), output = path.join(here, 'release')) {
  const corpus = readCorpus(snapshot);
  if (fs.existsSync(output)) {
    const existing = loadRelease(output);
    if (existing.manifest.corpus_version === corpus.manifest.corpus_version) return existing.manifest;
    throw new Error('Build a new candidate directory; published releases are immutable');
  }
  fs.mkdirSync(path.dirname(output), { recursive: true });
  const stage = fs.mkdtempSync(path.join(path.dirname(output), '.release-'));
  try {
    for (const name of dataFiles) fs.copyFileSync(path.join(snapshot, name), path.join(stage, name));
    const index = createIndex(corpus.chunks);
    fs.writeFileSync(path.join(stage, 'index.json'), JSON.stringify(index));
    const manifest = { ...corpus.manifest, embedding_status: 'ready', index_format: FORMAT,
      model: { provider: 'local', model: 'tfidf-bm25', revision: FORMAT, dimensions: index.vocabulary.length, normalize: true, network_at_runtime: false },
      embedding_count: index.rows.length, files: Object.fromEntries([...dataFiles, 'index.json'].map(name => [name, hash(read(stage, name))])) };
    fs.writeFileSync(path.join(stage, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
    loadRelease(stage);
    for (const name of [...dataFiles, 'index.json', 'manifest.json']) fs.chmodSync(path.join(stage, name), 0o444);
    fs.renameSync(stage, output);
    fs.chmodSync(output, 0o555);
    return manifest;
  } finally { if (fs.existsSync(stage)) fs.rmSync(stage, { recursive: true, force: true }); }
}
export function loadRelease(root = path.join(here, 'release')) {
  const corpus = readCorpus(root), { manifest } = corpus;
  if (manifest.embedding_status !== 'ready' || manifest.index_format !== FORMAT || manifest.model?.revision !== FORMAT) throw new Error('Unsupported or incomplete local index');
  if (canonical(Object.keys(manifest.files || {}).sort()) !== canonical([...dataFiles, 'index.json'].sort())) throw new Error('Invalid release file manifest');
  for (const [name, expected] of Object.entries(manifest.files)) if (hash(read(root, name)) !== expected) throw new Error('Knowledge checksum mismatch');
  const index = JSON.parse(read(root, 'index.json'));
  if (index.format !== FORMAT || index.rows.length !== corpus.chunks.length || manifest.embedding_count !== index.rows.length ||
      index.vocabulary.length !== index.idf.length || manifest.model.dimensions !== index.vocabulary.length ||
      new Set(index.vocabulary).size !== index.vocabulary.length || !index.idf.every(value => Number.isFinite(value) && value > 0) ||
      !Number.isFinite(index.averageLength) || index.averageLength <= 0) throw new Error('Invalid index dimensions');
  for (const [i, row] of index.rows.entries()) {
    let squared = 0, previous = -1;
    if (row.id !== corpus.chunks[i].id || !Number.isSafeInteger(row.length) || row.length < 1) throw new Error('Invalid vector order');
    for (const [id, count, value] of row.values) {
      if (!Number.isSafeInteger(id) || id <= previous || id >= index.vocabulary.length || !Number.isSafeInteger(count) || count < 1 || !Number.isFinite(value) || value <= 0) throw new Error('Invalid sparse vector');
      previous = id; squared += value * value;
    }
    if (Math.abs(squared - 1) > 0.00001) throw new Error('Unnormalized vector');
  }
  return { ...corpus, index };
}

export function search(release, question, { page = '', limit = 6 } = {}) {
  const { index, chunks, sources } = release;
  const lookup = new Map(index.vocabulary.map((token, id) => [token, id]));
  const terms = counts(question), weights = new Map();
  let squared = 0;
  for (const [token, count] of terms) {
    const id = lookup.get(token);
    if (id === undefined) continue;
    const weight = (1 + Math.log(count)) * index.idf[id];
    squared += weight * weight; weights.set(id, weight);
  }
  if (!weights.size) return [];
  const norm = Math.sqrt(squared);
  for (const [id, value] of weights) weights.set(id, value / norm);
  const pageTerms = page === 'vidgenie' ? ['vidgenie', 'agent'] : page === 'audio' ? ['audio'] : page === 'image' ? ['image'] : ['studio', 'video'];
  const ranked = [];
  for (const [i, row] of index.rows.entries()) {
    const chunk = chunks[i];
    // UI/client fields cannot opt into operator or historical references.
    if (chunk.audience !== 'public' || chunk.freshness === 'historical') continue;
    let cosine = 0, bm25 = 0, matched = 0;
    for (const [id, count, value] of row.values) {
      if (!weights.has(id)) continue;
      matched++; cosine += weights.get(id) * value;
      bm25 += index.idf[id] * count * 2.2 / (count + 1.2 * (0.25 + 0.75 * row.length / index.averageLength));
    }
    if (!matched || cosine < 0.035 || (terms.size >= 3 && matched < 2)) continue;
    const title = chunk.title.toLowerCase();
    const score = cosine * 0.5 + (bm25 / (bm25 + 6)) * 0.3 + Math.min(100, chunk.authority || 0) / 1000
      + (pageTerms.some(term => title.includes(term)) ? 0.06 : 0) + 0.04 * matched / weights.size;
    ranked.push({ ...chunk, score });
  }
  ranked.sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));
  const selected = [], perDocument = new Map();
  for (const chunk of ranked) {
    if ((perDocument.get(chunk.document_id) || 0) >= 2) continue;
    selected.push({ ...chunk, sources: chunk.source_ids.map(id => sources.find(source => source.id === id)).filter(Boolean) });
    perDocument.set(chunk.document_id, (perDocument.get(chunk.document_id) || 0) + 1);
    if (selected.length >= Math.min(8, Math.max(1, limit))) break;
  }
  return selected;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const [command = 'check', directory, output] = process.argv.slice(2);
    if (command === 'build') {
      const manifest = buildRelease(directory, output);
      console.log(JSON.stringify({ status: 'ready', corpusVersion: manifest.corpus_version, vectors: manifest.embedding_count, dimensions: manifest.model.dimensions }));
    } else if (command === 'query') {
      console.log(JSON.stringify(search(loadRelease(directory), output || '').map(({ title, text, score }) => ({ title, text, score })), null, 2));
    } else if (command === 'check') {
      const release = loadRelease(directory);
      console.log(JSON.stringify({ status: 'ready', vectors: release.index.rows.length, corpusVersion: release.manifest.corpus_version }));
    } else throw new Error('Expected build, check or query');
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
