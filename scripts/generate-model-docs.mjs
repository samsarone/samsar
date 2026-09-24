import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import catalog from '../docs/model-catalog.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const check = process.argv.includes('--check');
const docsFlag = process.argv.indexOf('--docs-site');
const docsRoot = docsFlag >= 0 ? path.resolve(process.argv[docsFlag + 1]) : null;
const link = (label, url) => `[${label}](${url})`;
const adapterLinks = row => row.adapters.map(key => link(catalog.providers[key].label, catalog.providers[key].url)).join(' · ') || 'Check the target Studio';
const escape = text => String(text).replaceAll('|', '\\|').replaceAll('\n', ' ');
const lines = [
  '# Model matrix', '',
  'Start with [hosted Samsar Studio](https://app.samsar.one) or [samsar-js](https://www.npmjs.com/package/samsar-js). The tables below cover every model in the standalone setup registry, then identify additional Studio catalog entries and service-specific models separately.', '',
  '**Read across a row:** choose the Samsar request key, open its API reference, then expand into a supported deployment adapter. Samsar.js appears first for media; native inference adapters may lead the inference rows. This is documentation order, not an override of your saved runtime priority.', '',
  '**Availability is scoped.** “Samsar” means a managed route is documented or registered, not a live health check. “Deployment only” requires a local adapter. “Studio catalog” entries are not a claim of current endpoint availability. Express and branching are separate allowlists, and their runtime responses can narrow the lists further.', '',
  '[Hosted API overview](https://docs.samsar.one/) · [Pricing](https://docs.samsar.one/pricing) · [Provider setup and routing](providers-and-models.md) · [Setup wizard](setup-wizard.md)', '',
  '## Choose a modality', '',
  ...catalog.modalities.map(m => `- [${m.label}](#${m.id}) — ${m.description}`), '',
];
for (const modality of catalog.modalities) {
  const rows = catalog.models.filter(row => row.modality === modality.id && row.scope !== 'studio');
  const studio = catalog.models.filter(row => row.modality === modality.id && row.scope === 'studio');
  lines.push(`<a id="${modality.id}"></a>`, '', `## ${modality.label}`, '', modality.description, '', `**Request field:** ${modality.field}. ${link('Samsar API reference', 'https://docs.samsar.one' + modality.docs)}.`, '',
    '| Model / request key | Hosted path | Supported deployment adapters | Workflow scope | Notes |', '| --- | --- | --- | --- | --- |');
  for (const row of rows) {
    const scope = [row.express ? 'Express' : null, row.branching ? 'Branching' : null, row.scope === 'custom' ? 'Custom endpoint' : null].filter(Boolean).join(' · ') || 'Modality API / Studio';
    const alias = row.setupKey && row.setupKey !== row.requestKey ? ` (setup: \`${row.setupKey}\`)` : '';
    lines.push(`| ${escape(row.label)} · \`${escape(row.requestKey)}\`${alias} | ${row.hosted ? link('Samsar.js', 'https://docs.samsar.one' + (row.docs || modality.docs)) : 'Deployment only'} | ${adapterLinks(row)} | ${scope} | ${escape(row.note)} |`);
  }
  if (studio.length) {
    lines.push('', '<details>', `<summary>Additional ${modality.label.toLowerCase()} entries in the Studio source catalog (${studio.length})</summary>`, '',
      'These entries are outside the standalone setup registry. Check the target Studio and its configured provider before using them. They are not added to the Express or branching allowlist by appearing here.', '', '| Model | Catalog key |', '| --- | --- |',
      ...studio.map(row => `| ${escape(row.label)} | \`${row.key}\` |`), '', '</details>');
  }
  lines.push('');
}
lines.push('## Check your deployment', '',
  'For hosted Express workflows, inspect `await samsar.getSupportedTextToVideoModels()`. For a standalone installation, query the same route on your processor:', '',
  '```bash', 'curl http://localhost:3002/v1/video/supported_models', '```', '',
  'This endpoint describes Express workflows; it is not the complete Studio or audio catalog. Review `runtime/config/available-models.json` and **Settings → Model Adapters** for your local installation. GenBlaze routes additionally depend on the exact validated credential catalog.', '',
  'The stable setup key `KIMIK3` is submitted as `kimi-k3` in inference requests. Older setup records may use `gpt-5.6-sol`; the processor normalizes that selection to `gpt-6-astra`. Stable media keys can retain their spelling when the underlying provider model is upgraded.', '',
  '## Catalog maintenance', '',
  'This page is generated from the setup registry, processor model catalogs, Express allowlist and branching allowlist, with explanations in `docs/model-catalog.mjs`. It does not query providers or submit paid jobs.', '',
  '```bash', 'node scripts/generate-model-docs.mjs', 'node scripts/generate-model-docs.mjs --check', '```', '',
  'Maintainers working in the parent workspace can also refresh the docs website snapshot with `node scripts/generate-model-docs.mjs --docs-site ../samsar-docs`. The docs website builds from that committed snapshot and does not require a sibling checkout.', '');

const outputs = [[path.join(root, 'pages/model-matrix.md'), lines.join('\n')]];
if (docsRoot) outputs.push([path.join(docsRoot, 'src/constants/modelCatalog.json'), JSON.stringify(catalog, null, 2) + '\n']);
let stale = false;
for (const [file, content] of outputs) {
  if (check) {
    if (await fs.readFile(file, 'utf8').catch(() => '') !== content) { console.error(`Out of date: ${file}`); stale = true; }
  } else { await fs.mkdir(path.dirname(file), { recursive: true }); await fs.writeFile(file, content); console.log(`Updated ${path.relative(root, file)}`); }
}
if (stale) process.exitCode = 1;
