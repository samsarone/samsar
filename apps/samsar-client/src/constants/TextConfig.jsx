
const HEX_COLOR_PATTERN = /^#(?:[0-9a-f]{3}){1,2}$/i;
const VALID_TEXT_ALIGN_VALUES = new Set(['left', 'center', 'right']);

function normalizeFiniteNumber(value, fallback, { min = null } = {}) {
  const parsedValue = Number(value);
  let nextValue = Number.isFinite(parsedValue) ? parsedValue : fallback;

  if (typeof min === 'number') {
    nextValue = Math.max(min, nextValue);
  }

  return nextValue;
}

function normalizeHexColor(value, fallback) {
  return HEX_COLOR_PATTERN.test(`${value || ''}`.trim()) ? value : fallback;
}

export function getTextConfigForCanvas(textConfig, canvasDimensions = { width: 1024, height: 1024 }) {
  const { width, height } = canvasDimensions;


  const textBoxWidth = Math.min(600, Math.max(240, width * 0.72));
  const textBoxHeight = Math.min(220, Math.max(120, height * 0.22));

  const defaultX = width / 2;
  const defaultY = height / 2;

  let defaultTextConfig = {

    x: defaultX,
    y: defaultY,
    width: textBoxWidth,
    height: textBoxHeight,
    fontFamily: 'Arial',
    fontSize: 32,
    fillColor: '#ffffff',
    textDecoration: '',
    fontStyle: 'normal',
    bold: false,
    italic: false,
    underline: false,
    textAlign: 'center',
    strokeColor: '#ffffff',
    strokeWidth: 0,
    shadowColor: 'rgba(15,23,42,0.92)',
    shadowBlur: 8,
    shadowOffsetX: 0,
    shadowOffsetY: 2,
    rotationAngle: 0,
    autoWrap: true,
    capitalizeLetters: false,
    lineHeight: 1.2,
    letterSpacing: 0,

    textBaseline: 'alphabetic', // for backend parity
    verticalAlign: 'middle', // conceptually, if you implement it

    
 
  };

  const mergedTextConfig = { ...defaultTextConfig, ...textConfig };

  return {
    ...mergedTextConfig,
    x: normalizeFiniteNumber(mergedTextConfig.x, defaultTextConfig.x),
    y: normalizeFiniteNumber(mergedTextConfig.y, defaultTextConfig.y),
    width: normalizeFiniteNumber(mergedTextConfig.width, defaultTextConfig.width, { min: 1 }),
    height: normalizeFiniteNumber(mergedTextConfig.height, defaultTextConfig.height, { min: 1 }),
    fontFamily:
      typeof mergedTextConfig.fontFamily === 'string' && mergedTextConfig.fontFamily.trim()
        ? mergedTextConfig.fontFamily
        : defaultTextConfig.fontFamily,
    fontSize: normalizeFiniteNumber(mergedTextConfig.fontSize, defaultTextConfig.fontSize, { min: 1 }),
    fillColor: normalizeHexColor(mergedTextConfig.fillColor, defaultTextConfig.fillColor),
    strokeColor: normalizeHexColor(mergedTextConfig.strokeColor, defaultTextConfig.strokeColor),
    strokeWidth: normalizeFiniteNumber(mergedTextConfig.strokeWidth, defaultTextConfig.strokeWidth, { min: 0 }),
    textAlign: VALID_TEXT_ALIGN_VALUES.has(mergedTextConfig.textAlign)
      ? mergedTextConfig.textAlign
      : defaultTextConfig.textAlign,
    lineHeight: normalizeFiniteNumber(mergedTextConfig.lineHeight, defaultTextConfig.lineHeight, { min: 0.1 }),
    letterSpacing: normalizeFiniteNumber(
      mergedTextConfig.letterSpacing,
      defaultTextConfig.letterSpacing
    ),
    shadowBlur: normalizeFiniteNumber(mergedTextConfig.shadowBlur, defaultTextConfig.shadowBlur, { min: 0 }),
    shadowOffsetX: normalizeFiniteNumber(mergedTextConfig.shadowOffsetX, defaultTextConfig.shadowOffsetX),
    shadowOffsetY: normalizeFiniteNumber(mergedTextConfig.shadowOffsetY, defaultTextConfig.shadowOffsetY),
    rotationAngle: normalizeFiniteNumber(mergedTextConfig.rotationAngle, defaultTextConfig.rotationAngle),
    autoWrap: mergedTextConfig.autoWrap !== false,
    capitalizeLetters: Boolean(mergedTextConfig.capitalizeLetters),
  };
}

export function normalizeActiveTextItemListForCanvas(
  itemList,
  canvasDimensions = { width: 1024, height: 1024 },
  fallbackItems = [],
  options = {}
) {
  const items = Array.isArray(itemList) ? itemList : [];
  const fallbackMap = new Map(
    (Array.isArray(fallbackItems) ? fallbackItems : []).map((item) => [item?.id, item])
  );
  const preferFallbackTextConfig = options?.preferFallbackTextConfig === true;

  return items.map((item) => {
    if (!item || item.type !== 'text') {
      return item;
    }

    const fallbackConfig = fallbackMap.get(item.id)?.config || {};
    const mergedConfig = preferFallbackTextConfig
      ? { ...(item.config || {}), ...fallbackConfig }
      : { ...fallbackConfig, ...(item.config || {}) };

    return {
      ...item,
      config: getTextConfigForCanvas(mergedConfig, canvasDimensions),
    };
  });
}
