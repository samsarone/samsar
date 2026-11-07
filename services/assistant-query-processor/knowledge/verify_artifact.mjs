import { loadRelease } from './index.mjs';
try {
  const release = loadRelease(process.argv[2]);
  console.log(JSON.stringify({ status: 'ready', vectors: release.index.rows.length, corpusVersion: release.manifest.corpus_version }));
} catch (error) { console.error(error.message); process.exitCode = 1; }
