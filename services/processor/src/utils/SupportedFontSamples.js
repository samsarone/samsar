import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import sharp from 'sharp';
import { fileURLToPath } from 'url';

import { SUPPORTED_SUBTITLE_FONTS_BY_LANGUAGE } from '../consts/SubtitleFonts.js';

const SAMPLE_TEXT_BY_LANGUAGE = {
  default: 'The quick brown fox jumps over the lazy dog.',
  en: 'The quick brown fox jumps over the lazy dog.',
  fr: 'Portez ce vieux whisky au juge blond qui fume.',
  es: 'El veloz murcielago hindu comia feliz cardillo y kiwi.',
  de: 'Falsches uben von Xylophonmusik qualt jeden grossen Zwerg.',
  pt: 'Um pequeno jabuti xereta viu dez cegonhas felizes.',
  it: 'Quel vituperabile xenofobo zelante assaggia il whisky ed e pronto.',
  nl: "Pa's wijze lynx bezag vroom het fikse aquaduct.",
  sv: 'Yxskaftbud, ge vaarlig zoon!',
  ru: 'Быстрая бурая лиса перепрыгивает через ленивую собаку.',
  ja: '素早い茶色の狐がのろまな犬を飛び越える。',
  ko: '빠른 갈색 여우가 게으른 개를 뛰어넘는다.',
  th: 'สวัสดีชาวโลก',
  ar: 'مرحبا بالعالم',
  bn: 'হ্যালো বিশ্ব',
  hi: 'नमस्ते दुनिया',
  he: 'שלום עולם',
  la: 'Lorem ipsum dolor sit amet.',
  sa: 'धर्मक्षेत्रे कुरुक्षेत्रे',
  zh: '快速的棕色狐狸跳过懒狗。',
  'zh-cn': '快速的棕色狐狸跳过懒狗。',
  'zh-tw': '快速的棕色狐狸跳過懶狗。',
};

const GENERATOR_VERSION = '2';
const MANIFEST_FILENAME = '.font_samples_manifest.json';
const LOCK_FILENAME = '.font_samples_manifest.lock';
const RTL_LANGUAGES = new Set(['ar', 'he']);
const OUTPUT_WIDTH = 1200;
const OUTPUT_HEIGHT = 360;
const OUTPUT_PADDING = 48;
const LEGACY_OUTPUT_THEME = 'light';
const INCLUDE_LEGACY_OUTPUT = true;
const THEMES = {
  light: {
    background: '#ffffff',
    sampleColor: '#0f172a',
    metaColor: '#334155',
    keyColor: '#475569',
  },
  dark: {
    background: '#0b101a',
    sampleColor: '#f8fafc',
    metaColor: '#cbd5e1',
    keyColor: '#94a3b8',
  },
};

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = path.resolve(__dirname, '../..');
const FALLBACK_OUTPUT_DIR = path.join(PROJECT_ROOT, 'assets', 'supported_fonts');

const slugifyFontName = (fontName) =>
  fontName
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');

const escapeXml = (value) =>
  value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\"/g, '&quot;')
    .replace(/'/g, '&#39;');

const stableStringify = (value) => {
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(',')}]`;
  }
  if (value && typeof value === 'object') {
    const keys = Object.keys(value).sort();
    return `{${keys
      .map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
};

const computeFingerprint = () => {
  const payload = {
    version: GENERATOR_VERSION,
    fontsByLanguage: SUPPORTED_SUBTITLE_FONTS_BY_LANGUAGE,
    samples: SAMPLE_TEXT_BY_LANGUAGE,
    themes: THEMES,
    layout: {
      width: OUTPUT_WIDTH,
      height: OUTPUT_HEIGHT,
      padding: OUTPUT_PADDING,
      legacyOutput: INCLUDE_LEGACY_OUTPUT,
      legacyTheme: LEGACY_OUTPUT_THEME,
    },
  };
  const hash = crypto.createHash('sha256');
  hash.update(stableStringify(payload));
  return hash.digest('hex');
};

const resolveOutputDir = () => {
  const override = process.env.FONT_SAMPLE_OUTPUT_DIR;
  if (override) {
    return path.resolve(override);
  }

  const assetsRoot = '/assets';
  try {
    if (fs.existsSync(assetsRoot)) {
      fs.accessSync(assetsRoot, fs.constants.W_OK);
      return path.join(assetsRoot, 'supported_fonts');
    }
  } catch (_) {
  }

  return FALLBACK_OUTPUT_DIR;
};

const pickSampleFontSize = (sampleText) => {
  const length = sampleText.length;
  if (length > 60) return 38;
  if (length > 50) return 42;
  if (length > 40) return 46;
  return 54;
};

const buildSvg = ({ sampleText, fontName, fontKey, languageCode, theme }) => {
  const fontFamily = fontName.replace(/\"/g, '\\"');
  const textSize = pickSampleFontSize(sampleText);
  const nameSize = Math.max(26, Math.round(textSize * 0.6));
  const keySize = Math.max(22, Math.round(textSize * 0.5));
  const isRtl = RTL_LANGUAGES.has(languageCode);
  const direction = isRtl ? 'rtl' : 'ltr';
  const bidi = isRtl ? 'plaintext' : 'normal';
  const contentHeight = OUTPUT_HEIGHT - OUTPUT_PADDING * 2;
  const sampleY = OUTPUT_PADDING + Math.round(contentHeight * 0.36);
  const nameY = OUTPUT_PADDING + Math.round(contentHeight * 0.68);
  const keyY = OUTPUT_PADDING + Math.round(contentHeight * 0.86);
  const fontLabel = `Font: ${fontName}`;
  const keyLabel = `Key: ${fontKey}`;

  return `
<svg width="${OUTPUT_WIDTH}" height="${OUTPUT_HEIGHT}" viewBox="0 0 ${OUTPUT_WIDTH} ${OUTPUT_HEIGHT}" xmlns="http://www.w3.org/2000/svg" xml:lang="${languageCode}">
  <rect width="${OUTPUT_WIDTH}" height="${OUTPUT_HEIGHT}" fill="${theme.background}"/>
  <style>
    .sample {
      font-family: "${fontFamily}", sans-serif;
      font-size: ${textSize}px;
      fill: ${theme.sampleColor};
    }
    .meta {
      font-family: "${fontFamily}", sans-serif;
      font-size: ${nameSize}px;
      fill: ${theme.metaColor};
    }
    .key {
      font-family: "${fontFamily}", sans-serif;
      font-size: ${keySize}px;
      fill: ${theme.keyColor};
    }
  </style>
  <text x="50%" y="${sampleY}" text-anchor="middle" dominant-baseline="middle" class="sample" direction="${direction}" unicode-bidi="${bidi}">
    ${escapeXml(sampleText)}
  </text>
  <text x="50%" y="${nameY}" text-anchor="middle" dominant-baseline="middle" class="meta" direction="ltr" unicode-bidi="normal">
    ${escapeXml(fontLabel)}
  </text>
  <text x="50%" y="${keyY}" text-anchor="middle" dominant-baseline="middle" class="key" direction="ltr" unicode-bidi="normal">
    ${escapeXml(keyLabel)}
  </text>
</svg>
`.trim();
};

const getOutputTargets = (outputDir) => {
  const targets = Object.keys(THEMES).map((themeName) => ({
    themeName,
    outputDir: path.join(outputDir, themeName),
  }));

  if (INCLUDE_LEGACY_OUTPUT) {
    targets.push({ themeName: LEGACY_OUTPUT_THEME, outputDir });
  }

  return targets;
};

const listExpectedFiles = (outputDir) => {
  const files = [];
  const targets = getOutputTargets(outputDir);
  for (const target of targets) {
    for (const [languageCode, fonts] of Object.entries(SUPPORTED_SUBTITLE_FONTS_BY_LANGUAGE)) {
      if (!Array.isArray(fonts)) continue;
      for (const fontName of fonts) {
        if (typeof fontName !== 'string') continue;
        const slug = slugifyFontName(fontName);
        files.push(path.join(target.outputDir, languageCode, `${slug}.png`));
      }
    }
  }
  return files;
};

const needsRegeneration = (outputDir, fingerprint) => {
  const manifestPath = path.join(outputDir, MANIFEST_FILENAME);
  try {
    if (!fs.existsSync(manifestPath)) {
      return true;
    }
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    if (manifest?.fingerprint !== fingerprint) {
      return true;
    }

    const expectedFiles = listExpectedFiles(outputDir);
    return expectedFiles.some((filePath) => !fs.existsSync(filePath));
  } catch (_) {
    return true;
  }
};

const writeManifest = async (outputDir, fingerprint) => {
  const manifestPath = path.join(outputDir, MANIFEST_FILENAME);
  const payload = {
    fingerprint,
    generatedAt: new Date().toISOString(),
    version: GENERATOR_VERSION,
  };
  await fs.promises.writeFile(manifestPath, JSON.stringify(payload, null, 2));
};

const generateSamples = async (outputDir) => {
  const sampleEntries = Object.entries(SUPPORTED_SUBTITLE_FONTS_BY_LANGUAGE).sort(([a], [b]) =>
    a.localeCompare(b)
  );
  const targets = getOutputTargets(outputDir);

  for (const target of targets) {
    const theme = THEMES[target.themeName];
    if (!theme) continue;

    for (const [languageCode, fonts] of sampleEntries) {
      if (!Array.isArray(fonts)) continue;
      const sampleText = SAMPLE_TEXT_BY_LANGUAGE[languageCode] || SAMPLE_TEXT_BY_LANGUAGE.default;
      const languageDir = path.join(target.outputDir, languageCode);
      await fs.promises.mkdir(languageDir, { recursive: true });

      for (const fontName of fonts) {
        if (typeof fontName !== 'string') continue;
        const slug = slugifyFontName(fontName);
        const outputPath = path.join(languageDir, `${slug}.png`);
        const svg = buildSvg({ sampleText, fontName, fontKey: slug, languageCode, theme });
        await sharp(Buffer.from(svg)).png().toFile(outputPath);
      }
    }
  }
};

export async function ensureSupportedFontSamples() {
  if (process.env.DISABLE_FONT_SAMPLE_GENERATION === 'true') {
    return { skipped: true, reason: 'disabled' };
  }

  const outputDir = resolveOutputDir();
  await fs.promises.mkdir(outputDir, { recursive: true });

  const lockPath = path.join(outputDir, LOCK_FILENAME);
  let lockFd = null;
  try {
    lockFd = await fs.promises.open(lockPath, 'wx');
  } catch (error) {
    if (error?.code === 'EEXIST') {
      return { skipped: true, reason: 'locked' };
    }
    throw error;
  }

  try {
    const fingerprint = computeFingerprint();
    if (!needsRegeneration(outputDir, fingerprint)) {
      return { skipped: true, reason: 'up_to_date' };
    }

    await generateSamples(outputDir);
    await writeManifest(outputDir, fingerprint);
    return { generated: true, outputDir };
  } finally {
    try {
      if (lockFd) {
        await lockFd.close();
      }
      await fs.promises.unlink(lockPath);
    } catch (_) {
    }
  }
}

if (process.argv.includes('--generate')) {
  ensureSupportedFontSamples()
    .then((result) => {
      if (result?.generated) {
      } else {
      }
    })
    .catch((error) => {
      console.error('Failed to generate supported font samples:', error?.message || error);
      process.exitCode = 1;
    });
}
