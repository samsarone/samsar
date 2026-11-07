import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadRelease, search } from '../knowledge/index.mjs';
const defaultDirectory = fileURLToPath(new URL('../knowledge/release/', import.meta.url));
let cached;
let lastFailure = 0;

export function retrieveAssistantKnowledge(query, context, { directory = process.env.ASSISTANT_KNOWLEDGE_DIR || defaultDirectory } = {}) {
  if (process.env.ASSISTANT_RAG_ENABLED === 'false') return { status: 'disabled', references: [] };
  try {
    const key = path.resolve(directory);
    if (!cached || cached.key !== key) {
      if (lastFailure && Date.now() - lastFailure < 30000) return { status: 'unavailable', references: [] };
      cached = { key, release: loadRelease(key) };
    }
    const seen = new Set();
    const references = search(cached.release, query, { page: context.page, limit: 8 }).filter(row => {
      if (seen.has(row.document_id)) return false;
      seen.add(row.document_id); return true;
    }).slice(0, 6).map(row => ({
      id: row.id, title: row.title,
      text: (() => { const parent = cached.release.documents.find(doc => doc.id === row.document_id);
        return parent?.text?.length <= 2200 ? parent.text : row.text; })(), authority: row.authority, freshness: row.freshness,
      urls: row.sources.map(source => source.uri).filter(uri => /^https:\/\/(docs\.samsar\.one|samsar\.one)\//.test(uri)),
    }));
    return { status: references.length ? 'ready' : 'no_match', corpusVersion: cached.release.manifest.corpus_version, references };
  } catch {
    lastFailure = Date.now();
    // No queries, drafts, credentials or source paths in logs. No remote fallback.
    console.warn('[assistant-knowledge] Local index unavailable; continuing without retrieved evidence.');
    return { status: 'unavailable', references: [] };
  }
}
