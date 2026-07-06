export const getFontFamilyForLanguage = (language) => {
  switch (language) {
    case 'eng': // English
      return 'Times New Roman';
    case 'spa': // Spanish
    case 'fre': // French
    case 'deu': // German
    case 'ita': // Italian
    case 'por': // Portuguese
      return 'Arial'; // Arial is widely supported and good for Latin-based scripts
    case 'rus': // Russian
      return 'Arial'; // Arial supports Cyrillic script natively
    case 'zho': // Chinese
      return 'SimHei'; // A common sans-serif font for Simplified Chinese
    case 'jpn': // Japanese
      return 'MS Gothic'; // A common monospaced font for Japanese
    case 'kor': // Korean
      return 'Malgun Gothic'; // A widely used sans-serif font for Korean
    default:
      return 'Arial'; // Default to Arial for unsupported or unexpected languages
  }
};
