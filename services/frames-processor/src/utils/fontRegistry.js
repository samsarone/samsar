import fs from 'fs';
import path from 'path';
import { registerFont } from 'canvas';

const FONT_DIRS = [
  '/usr/local/share/fonts',
  '/usr/share/fonts',
  '/usr/share/fonts/truetype',
  '/Library/Fonts',
  '/System/Library/Fonts',
  path.join(process.cwd(), 'fonts'),
];

// Map desired family name to possible file names on disk.
const FONT_CANDIDATES = [
  { family: 'Sarabun', files: ['Sarabun.ttf', 'Sarabun[wght].ttf'] },
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

function findFontFile(possibleFiles) {
  for (const dir of FONT_DIRS) {
    for (const filename of possibleFiles) {
      const fontPath = path.join(dir, filename);
      if (fs.existsSync(fontPath)) {
        return fontPath;
      }
    }
  }
  return null;
}

export function ensureFontsRegistered() {
  FONT_CANDIDATES.forEach(({ family, files }) => {
    const fontPath = findFontFile(files);
    if (fontPath) {
      try {
        registerFont(fontPath, { family });
        console.info(`[FontRegistry] Registered ${family} from ${fontPath}`);
      } catch (err) {
        console.warn(`[FontRegistry] Failed to register ${family} from ${fontPath}: ${err.message}`);
      }
    } else {
      console.warn(`[FontRegistry] Font file not found for ${family}; tried ${files.join(', ')}`);
    }
  });
}
