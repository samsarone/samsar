import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';

const root = process.cwd();
const readJson = (file) => JSON.parse(fs.readFileSync(path.join(root, file), 'utf8'));
const messages = readJson('src/locales/messages.json');
const invariants = new Set(readJson('src/locales/invariants.json'));
const tokens = (value) => JSON.stringify((value.match(/\{\w+\}/g) || []).sort());

export function checkLocalization() {
  const issues = [];
  for (const [source, localized] of Object.entries(messages)) {
    if (localized.en !== source) issues.push(`English source differs: ${source}`);
    for (const language of ['en', 'th', 'ja']) {
      const value = localized[language];
      if (typeof value !== 'string' || !value.trim()) issues.push(`Missing ${language}: ${source}`);
      else if (tokens(source) !== tokens(value)) issues.push(`Interpolation mismatch (${language}): ${source}`);
      else if (language !== 'en' && value === source && /[a-zA-Z]/.test(source) && !invariants.has(source)) issues.push(`Untranslated ${language}: ${source}`);
    }
    if (Object.keys(localized).some((key) => !['en', 'th', 'ja'].includes(key))) issues.push(`Unsupported locale: ${source}`);
  }
  const visibleProps = /^(title|subtitle|placeholder|alt|aria-label|label|description|helperText|emptyMessage|tooltip|text|buttonText|buttonLabel|submitLabel|header|badge)$/;
  const isCopy = (text) => /[a-zA-Z]{2}/.test(text) && !/^https?:|^\{request_id\}$/.test(text.trim());
  function visitFile(file) {
    const source = fs.readFileSync(file, 'utf8');
    const ast = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    const report = (node, message) => issues.push(`${path.relative(root, file)}:${ast.getLineAndCharacterOfPosition(node.getStart(ast)).line + 1}: ${message}`);
    function visit(node) {
      if (ts.isCallExpression(node) && ['uiText', 'tx', 'translateText'].includes(node.expression.getText(ast))) {
        const text = node.arguments[0];
        if (text && ts.isStringLiteralLike(text) && !messages[text.text]) report(node, `Missing message: ${text.text}`);
      }
      if (ts.isJsxText(node) && isCopy(node.text)) report(node, `Unlocalized JSX text: ${node.text.trim()}`);
      if (ts.isJsxAttribute(node) && visibleProps.test(node.name.getText(ast)) && node.initializer && ts.isStringLiteral(node.initializer) && isCopy(node.initializer.text)) report(node, `Unlocalized ${node.name.getText(ast)}: ${node.initializer.text}`);
      ts.forEachChild(node, visit);
    }
    visit(ast);
  }
  function walk(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const file = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(file);
      else if (/\.(?:jsx?|tsx?|mjs)$/.test(file) && !file.includes('.test.') && !file.endsWith('translations.js')) visitFile(file);
    }
  }
  walk(path.join(root, 'src'));
  return issues;
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.join(root, 'scripts/check-localization.mjs')) {
  const issues = checkLocalization();
  if (issues.length) { console.error(issues.join('\n')); process.exitCode = 1; }
  else console.log(`Localization check passed: ${Object.keys(messages).length} messages in English, Thai, and Japanese.`);
}
