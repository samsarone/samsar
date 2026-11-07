import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { buildRelease, loadRelease, search, tokenize } from './index.mjs';

const snapshot = fileURLToPath(new URL('./snapshot/', import.meta.url));
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'assistant-rag-'));
const output = path.join(temporary, 'release');
buildRelease(snapshot, output);
const release = loadRelease(output);
test.after(() => { fs.chmodSync(output, 0o755); fs.rmSync(temporary, { recursive: true, force: true }); });

test('builds real local lexical vectors offline with complete provenance and no database', () => {
  const source = JSON.parse(fs.readFileSync(path.join(snapshot, "manifest.json")));
  assert.equal(release.index.rows.length, source.chunks);
  assert.equal(release.manifest.sources, source.sources);
  assert.equal(release.manifest.model.model, 'tfidf-bm25');
  assert.equal(release.manifest.model.network_at_runtime, false);
  assert.equal(fs.statSync(path.join(output, 'index.json')).mode & 0o222, 0);
  assert.equal(buildRelease(snapshot, output).corpus_version, release.manifest.corpus_version);
  assert.deepEqual(fs.readdirSync(output).sort(), ['chunks.jsonl', 'documents.jsonl', 'index.json', 'knowledge-base.md', 'manifest.json', 'sources.json']);
});

for (const [query, page, expected] of [
  ['How do I join audio clips?', 'audio', /Joining audio items/],
  ['รวมเสียงหลายคลิปใน Audio Studio ได้อย่างไร', 'audio', /Joining audio items/],
  ['画像の一部を編集するにはどうすればいいですか', 'image', /Image Studio edit request/],
  ['What durations does Kling 4 accept?', 'vidgenie', /Kling|Direct video model billing/],
  ['Why is GPTIMAGE2.5 still the API key when the label is GPT Image 2.6?', 'image', /GPT Image stable/],
  ['What happens when I clear assistant history?', 'video', /Clearing assistant history/],
]) test(`retrieves current evidence: ${query}`, () => {
  const hits = search(release, query, { page });
  assert.match(hits[0].title, expected);
  assert.ok(hits.every(row => row.audience === 'public' && row.freshness !== 'historical' && row.sources.length));
});

test('excludes historical/operator references even when clients request privileged scope', () => {
  const hits = search(release, 'production keys old blog Veo credits', { includeOperator: true, includeHistorical: true });
  assert.ok(hits.every(row => row.audience === 'public' && row.freshness !== 'historical'));
  assert.deepEqual(search(release, 'What is the weather in Bangkok today?'), []);
  assert.deepEqual(search(release, 'zxqv99999'), []);
});

test('rejects corrupt releases instead of querying inconsistent embeddings', () => {
  const copied = path.join(temporary, 'corrupt');
  fs.cpSync(output, copied, { recursive: true }); fs.chmodSync(copied, 0o755);
  const index = path.join(copied, 'index.json'); fs.chmodSync(index, 0o644);
  fs.appendFileSync(index, 'corrupt');
  assert.throws(() => loadRelease(copied), /checksum/);
});

test('shared query tokenization preserves model keys and handles supported multilingual terms', () => {
  assert.ok(tokenize('GPTIMAGE2.5 Kling').includes('gptimage2.5'));
  assert.ok(tokenize('画像を編集').includes('image'));
  assert.ok(tokenize('รวมเสียง').includes('join'));
});
