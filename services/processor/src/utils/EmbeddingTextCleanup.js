const ZERO_WIDTH_CHARS_REGEX = /[\u200B-\u200D\uFEFF]/g;
const MARKDOWN_IMAGE_REGEX = /!\[[^\]]*]\((?:[^()\\]|\\.)*\)/g;
const MARKDOWN_LINK_REGEX = /\[([^\]]+)\]\((?:[^()\\]|\\.)*\)/g;
const MARKDOWN_REFERENCE_LINK_REGEX = /\[([^\]]+)\]\[[^\]]*\]/g;
const HTML_TAG_REGEX = /<[^>]+>/g;
const MULTI_SPACE_REGEX = /[ \t]+/g;
const MULTI_BLANK_LINE_REGEX = /\n{3,}/g;

const BOILERPLATE_LINE_PATTERNS = [
  /^skip to (?:main )?content$/i,
  /^table of contents$/i,
  /^menu$/i,
  /^navigation$/i,
  /^search$/i,
];

const HTML_ENTITY_MAP = {
  '&nbsp;': ' ',
  '&amp;': '&',
  '&lt;': '<',
  '&gt;': '>',
  '&quot;': '"',
  '&#39;': '\'',
};

function decodeHtmlEntities(value) {
  if (!value || typeof value !== 'string') {
    return '';
  }

  return value.replace(
    /&(nbsp|amp|lt|gt|quot|#39);/g,
    (match) => HTML_ENTITY_MAP[match] || match,
  );
}

function normalizeLine(line) {
  if (typeof line !== 'string') {
    return '';
  }

  return line
    .replace(/\*\*(.*?)\*\*/g, '$1')
    .replace(/\*(.*?)\*/g, '$1')
    .replace(/__(.*?)__/g, '$1')
    .replace(/_(.*?)_/g, '$1')
    .replace(/^#{1,6}\s+/g, '')
    .replace(/^\s*[-*+]\s+/g, '')
    .replace(/^\s*\d+\.\s+/g, '')
    .replace(/^\s*>+\s?/g, '')
    .replace(/`{1,3}/g, '')
    .replace(MULTI_SPACE_REGEX, ' ')
    .trim();
}

export function stripHtmlToText(value) {
  if (!value || typeof value !== 'string') {
    return '';
  }

  return decodeHtmlEntities(
    value
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/(p|div|section|article|li|h[1-6])>/gi, '\n')
      .replace(HTML_TAG_REGEX, ' ')
      .replace(/\r\n?/g, '\n')
      .replace(MULTI_SPACE_REGEX, ' '),
  ).trim();
}

export function cleanEmbeddingSourceText(value) {
  if (!value || typeof value !== 'string') {
    return '';
  }

  const cleaned = decodeHtmlEntities(
    value
      .replace(/\r\n?/g, '\n')
      .replace(ZERO_WIDTH_CHARS_REGEX, '')
      .replace(MARKDOWN_IMAGE_REGEX, ' ')
      .replace(MARKDOWN_LINK_REGEX, '$1')
      .replace(MARKDOWN_REFERENCE_LINK_REGEX, '$1')
      .replace(/\[([^\]]+)\]:\s+\S+/g, ' ')
      .replace(/^\s*[-*_]{3,}\s*$/gm, ' ')
      .replace(MULTI_SPACE_REGEX, ' '),
  );

  const lines = cleaned
    .split('\n')
    .map((line) => normalizeLine(line))
    .filter((line) => line && !BOILERPLATE_LINE_PATTERNS.some((pattern) => pattern.test(line)));

  const deduped = [];
  let previousLine = '';
  lines.forEach((line) => {
    const normalized = line.toLowerCase();
    if (normalized === previousLine) {
      return;
    }
    previousLine = normalized;
    deduped.push(line);
  });

  return deduped.join('\n').replace(MULTI_BLANK_LINE_REGEX, '\n\n').trim();
}
