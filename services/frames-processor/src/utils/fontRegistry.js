import fs from 'fs';
import path from 'path';
import { registerFont } from 'canvas';

const FONT_DIRS = [
  '/usr/local/share/fonts',
  '/usr/share/fonts',
  '/usr/share/fonts/truetype',
  '/usr/share/fonts/truetype/noto',
  '/usr/share/fonts/opentype/noto',
  '/Library/Fonts',
  '/System/Library/Fonts',
  path.join(process.cwd(), 'fonts'),
];

// Map desired family name to possible file names on disk.
const FONT_CANDIDATES = [
  { family: 'Sarabun', files: ['Sarabun.ttf', 'Sarabun-Regular.ttf', 'Sarabun[wght].ttf'] },
  { family: 'Noto Sans JP', files: ['NotoSansJP.ttf', 'NotoSansJP[wght].ttf', 'NotoSansJP%5Bwght%5D.ttf'] },
  { family: 'Noto Sans KR', files: ['NotoSansKR.ttf', 'NotoSansKR[wght].ttf', 'NotoSansKR%5Bwght%5D.ttf'] },
  { family: 'Noto Sans SC', files: ['NotoSansSC.ttf', 'NotoSansSC[wght].ttf', 'NotoSansSC%5Bwght%5D.ttf'] },
  { family: 'Noto Sans TC', files: ['NotoSansTC.ttf', 'NotoSansTC[wght].ttf', 'NotoSansTC%5Bwght%5D.ttf'] },
  { family: 'Noto Sans Arabic', files: ['NotoSansArabic.ttf', 'NotoSansArabic[wdth,wght].ttf', 'NotoSansArabic%5Bwdth,wght%5D.ttf'] },
  { family: 'Noto Sans Hebrew', files: ['NotoSansHebrew.ttf', 'NotoSansHebrew[wdth,wght].ttf', 'NotoSansHebrew%5Bwdth,wght%5D.ttf'] },
  { family: 'Noto Sans Devanagari', files: ['NotoSansDevanagari.ttf', 'NotoSansDevanagari[wdth,wght].ttf', 'NotoSansDevanagari%5Bwdth,wght%5D.ttf'] },
  { family: 'Noto Serif Devanagari', files: ['NotoSerifDevanagari.ttf', 'NotoSerifDevanagari[wdth,wght].ttf', 'NotoSerifDevanagari%5Bwdth,wght%5D.ttf'] },
  { family: 'Noto Sans Bengali', files: ['NotoSansBengali.ttf', 'NotoSansBengali[wdth,wght].ttf', 'NotoSansBengali%5Bwdth,wght%5D.ttf'] },
  { family: 'Noto Serif Bengali', files: ['NotoSerifBengali.ttf', 'NotoSerifBengali[wdth,wght].ttf', 'NotoSerifBengali%5Bwdth,wght%5D.ttf'] },
  { family: 'Hind Siliguri', files: ['HindSiliguri-Regular.ttf', 'HindSiliguri.ttf'] },
  { family: 'Mukta', files: ['Mukta-Regular.ttf', 'Mukta.ttf'] },
  { family: 'M PLUS Rounded 1c', files: ['MPLUSRounded1c.ttf', 'MPLUSRounded1c-Regular.ttf'] },
  { family: 'Montserrat', files: ['Montserrat.ttf', 'Montserrat[wght].ttf', 'Montserrat%5Bwght%5D.ttf'] },
  { family: 'Poppins', files: ['Poppins-Regular.ttf', 'Poppins.ttf'] },
];

function* findFontFiles(possibleFiles, fontDirs) {
  const visited = new Set();
  for (const dir of fontDirs) {
    for (const filename of possibleFiles) {
      const fontPath = path.join(dir, filename);
      if (!visited.has(fontPath) && fs.existsSync(fontPath)) {
        visited.add(fontPath);
        yield fontPath;
      }
    }
  }
}

export function ensureFontsRegistered({
  fontDirs = FONT_DIRS,
  registerFont: registerFontImpl = registerFont,
  logger = console,
} = {}) {
  FONT_CANDIDATES.forEach(({ family, files }) => {
    // Distro packages use static Regular filenames in nested Noto directories.
    const possibleFiles = [...files, `${family.replace(/ /g, '')}-Regular.ttf`];
    let foundFont = false;
    for (const fontPath of findFontFiles(possibleFiles, fontDirs)) {
      foundFont = true;
      try {
        registerFontImpl(fontPath, { family });
        logger.info(`[FontRegistry] Registered ${family} from ${fontPath}`);
        return;
      } catch (err) {
        // Old images can contain HTML downloads saved as .ttf files. Keep
        // looking so a bad legacy file cannot hide a valid installed copy.
        logger.warn(`[FontRegistry] Failed to register ${family} from ${fontPath}: ${err?.message || String(err)}`);
      }
    }
    if (!foundFont) {
      logger.warn(`[FontRegistry] Font file not found for ${family}; tried ${possibleFiles.join(', ')}`);
    }
  });
}
