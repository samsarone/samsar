import React from 'react';
import TextareaAutosize from 'react-textarea-autosize';
import {
  FaAlignCenter,
  FaAlignLeft,
  FaAlignRight,
  FaBold,
  FaChevronCircleDown,
  FaChevronCircleUp,
  FaItalic,
  FaTrash,
  FaUnderline,
} from 'react-icons/fa';

import { useColorMode } from '../../contexts/ColorMode.jsx';
import CommonButton from './CommonButton.tsx';
import SingleSelect from './SingleSelect.jsx';

const TEXT_FONT_OPTIONS = [
  { value: 'Arial', label: 'Arial' },
  { value: 'Verdana', label: 'Verdana' },
  { value: 'Helvetica', label: 'Helvetica' },
  { value: 'Times New Roman', label: 'Times New Roman' },
  { value: 'Georgia', label: 'Georgia' },
  { value: 'Courier New', label: 'Courier New' },
  { value: 'Comic Sans MS', label: 'Comic Sans MS' },
  { value: 'Impact', label: 'Impact' },
  { value: 'Tahoma', label: 'Tahoma' },
  { value: 'Trebuchet MS', label: 'Trebuchet MS' },
  { value: 'Lucida Console', label: 'Lucida Console' },
  { value: 'Gill Sans', label: 'Gill Sans' },
  { value: 'Palatino', label: 'Palatino' },
  { value: 'Garamond', label: 'Garamond' },
  { value: 'Arial Black', label: 'Arial Black' },
  { value: 'Sans-Serif', label: 'Sans-Serif' },
  { value: 'Serif', label: 'Serif' },
];

const TEXT_STYLE_STORAGE_KEYS = {
  fontSize: 'selected_text_config_fontSize',
  fontFamily: 'selected_text_config_fontFamily',
  fillColor: 'selected_text_config_fillColor',
  strokeColor: 'selected_text_config_strokeColor',
  strokeWidth: 'selected_text_config_strokeWidth',
  bold: 'selected_text_config_bold',
  italic: 'selected_text_config_italic',
  underline: 'selected_text_config_underline',
  textAlign: 'selected_text_config_textAlign',
  lineHeight: 'selected_text_config_lineHeight',
  width: 'selected_text_config_width',
  height: 'selected_text_config_height',
  autoWrap: 'selected_text_config_autoWrap',
  letterSpacing: 'selected_text_config_letterSpacing',
  shadowBlur: 'selected_text_config_shadowBlur',
  shadowOffsetX: 'selected_text_config_shadowOffsetX',
  shadowOffsetY: 'selected_text_config_shadowOffsetY',
  rotationAngle: 'selected_text_config_rotationAngle',
  capitalizeLetters: 'selected_text_config_capitalizeLetters',
};

const DEFAULT_TEXT_STYLE_DRAFT = {
  text: '',
  width: 600,
  height: 200,
  fontSize: 32,
  fontFamily: 'Arial',
  fillColor: '#ffffff',
  strokeColor: '#ffffff',
  strokeWidth: 0,
  bold: false,
  italic: false,
  underline: false,
  textAlign: 'center',
  lineHeight: 1.2,
  autoWrap: true,
  letterSpacing: 0,
  shadowBlur: 8,
  shadowOffsetX: 0,
  shadowOffsetY: 2,
  rotationAngle: 0,
  capitalizeLetters: false,
};

const SHARED_TEXT_STYLE_FIELDS = [
  'width',
  'height',
  'fontSize',
  'fontFamily',
  'fillColor',
  'strokeColor',
  'strokeWidth',
  'bold',
  'italic',
  'underline',
  'textAlign',
  'lineHeight',
  'autoWrap',
  'letterSpacing',
  'shadowBlur',
  'shadowOffsetX',
  'shadowOffsetY',
  'rotationAngle',
  'capitalizeLetters',
];

const HEX_COLOR_PATTERN = /^#(?:[0-9a-f]{3}){1,2}$/i;
const VALID_TEXT_ALIGN_VALUES = new Set(['left', 'center', 'right']);

function isValidHexColor(value) {
  return HEX_COLOR_PATTERN.test(`${value || ''}`.trim());
}

function getSafeColorValue(value, fallback) {
  return isValidHexColor(value) ? value : fallback;
}

function normalizeNumericField(value, fallback, { min = null, max = null, integer = false } = {}) {
  const parsedValue = integer ? parseInt(value, 10) : parseFloat(value);
  let nextValue = Number.isFinite(parsedValue) ? parsedValue : fallback;

  if (typeof min === 'number') {
    nextValue = Math.max(min, nextValue);
  }
  if (typeof max === 'number') {
    nextValue = Math.min(max, nextValue);
  }

  return nextValue;
}

export function buildTextStyleDraft(value = {}) {
  const nextDraft = {
    ...DEFAULT_TEXT_STYLE_DRAFT,
    ...value,
    text: `${value?.text ?? DEFAULT_TEXT_STYLE_DRAFT.text}`,
  };

  return {
    ...nextDraft,
    fontFamily:
      typeof nextDraft.fontFamily === 'string' && nextDraft.fontFamily.trim()
        ? nextDraft.fontFamily
        : DEFAULT_TEXT_STYLE_DRAFT.fontFamily,
    fontSize: normalizeNumericField(nextDraft.fontSize, DEFAULT_TEXT_STYLE_DRAFT.fontSize, {
      min: 1,
      max: 240,
      integer: true,
    }),
    width: normalizeNumericField(nextDraft.width, DEFAULT_TEXT_STYLE_DRAFT.width, {
      min: 24,
      max: 4096,
      integer: true,
    }),
    height: normalizeNumericField(nextDraft.height, DEFAULT_TEXT_STYLE_DRAFT.height, {
      min: 24,
      max: 4096,
      integer: true,
    }),
    fillColor: getSafeColorValue(nextDraft.fillColor, DEFAULT_TEXT_STYLE_DRAFT.fillColor),
    strokeColor: getSafeColorValue(nextDraft.strokeColor, DEFAULT_TEXT_STYLE_DRAFT.strokeColor),
    strokeWidth: normalizeNumericField(nextDraft.strokeWidth, DEFAULT_TEXT_STYLE_DRAFT.strokeWidth, {
      min: 0,
      max: 40,
      integer: true,
    }),
    bold: Boolean(nextDraft.bold),
    italic: Boolean(nextDraft.italic),
    underline: Boolean(nextDraft.underline),
    textAlign: VALID_TEXT_ALIGN_VALUES.has(nextDraft.textAlign)
      ? nextDraft.textAlign
      : DEFAULT_TEXT_STYLE_DRAFT.textAlign,
    lineHeight: normalizeNumericField(nextDraft.lineHeight, DEFAULT_TEXT_STYLE_DRAFT.lineHeight, {
      min: 0.6,
      max: 3,
    }),
    autoWrap: nextDraft.autoWrap !== false,
    letterSpacing: normalizeNumericField(
      nextDraft.letterSpacing,
      DEFAULT_TEXT_STYLE_DRAFT.letterSpacing,
      {
        min: -20,
        max: 100,
      }
    ),
    shadowBlur: normalizeNumericField(nextDraft.shadowBlur, DEFAULT_TEXT_STYLE_DRAFT.shadowBlur, {
      min: 0,
      max: 100,
    }),
    shadowOffsetX: normalizeNumericField(
      nextDraft.shadowOffsetX,
      DEFAULT_TEXT_STYLE_DRAFT.shadowOffsetX,
      {
        min: -200,
        max: 200,
      }
    ),
    shadowOffsetY: normalizeNumericField(
      nextDraft.shadowOffsetY,
      DEFAULT_TEXT_STYLE_DRAFT.shadowOffsetY,
      {
        min: -200,
        max: 200,
      }
    ),
    rotationAngle: normalizeNumericField(
      nextDraft.rotationAngle,
      DEFAULT_TEXT_STYLE_DRAFT.rotationAngle,
      {
        min: -360,
        max: 360,
      }
    ),
    capitalizeLetters: Boolean(nextDraft.capitalizeLetters),
  };
}

export function mapTextDraftToConfig(value = {}) {
  const draft = buildTextStyleDraft(value);
  const { ...config } = draft;
  return config;
}

export function mapTextDraftToStyleConfig(value = {}) {
  const draft = buildTextStyleDraft(value);
  return SHARED_TEXT_STYLE_FIELDS.reduce((styleConfig, field) => {
    styleConfig[field] = draft[field];
    return styleConfig;
  }, {});
}

export function mapTextItemToDraft(item) {
  return buildTextStyleDraft({
    text: item?.text || '',
    ...(item?.config || {}),
  });
}

export function loadStoredTextStyleConfig(storage) {
  const resolvedStorage =
    storage || (typeof window !== 'undefined' ? window.localStorage : null);
  if (!resolvedStorage) {
    return {};
  }

  const storedFontSize = resolvedStorage.getItem(TEXT_STYLE_STORAGE_KEYS.fontSize);
  const storedFontFamily = resolvedStorage.getItem(TEXT_STYLE_STORAGE_KEYS.fontFamily);
  const storedFillColor = resolvedStorage.getItem(TEXT_STYLE_STORAGE_KEYS.fillColor);
  const storedStrokeColor = resolvedStorage.getItem(TEXT_STYLE_STORAGE_KEYS.strokeColor);
  const storedStrokeWidth = resolvedStorage.getItem(TEXT_STYLE_STORAGE_KEYS.strokeWidth);
  const storedBold = resolvedStorage.getItem(TEXT_STYLE_STORAGE_KEYS.bold);
  const storedItalic = resolvedStorage.getItem(TEXT_STYLE_STORAGE_KEYS.italic);
  const storedUnderline = resolvedStorage.getItem(TEXT_STYLE_STORAGE_KEYS.underline);
  const storedTextAlign = resolvedStorage.getItem(TEXT_STYLE_STORAGE_KEYS.textAlign);
  const storedLineHeight = resolvedStorage.getItem(TEXT_STYLE_STORAGE_KEYS.lineHeight);
  const storedWidth = resolvedStorage.getItem(TEXT_STYLE_STORAGE_KEYS.width);
  const storedHeight = resolvedStorage.getItem(TEXT_STYLE_STORAGE_KEYS.height);
  const storedAutoWrap = resolvedStorage.getItem(TEXT_STYLE_STORAGE_KEYS.autoWrap);
  const storedLetterSpacing = resolvedStorage.getItem(TEXT_STYLE_STORAGE_KEYS.letterSpacing);
  const storedShadowBlur = resolvedStorage.getItem(TEXT_STYLE_STORAGE_KEYS.shadowBlur);
  const storedShadowOffsetX = resolvedStorage.getItem(TEXT_STYLE_STORAGE_KEYS.shadowOffsetX);
  const storedShadowOffsetY = resolvedStorage.getItem(TEXT_STYLE_STORAGE_KEYS.shadowOffsetY);
  const storedRotationAngle = resolvedStorage.getItem(TEXT_STYLE_STORAGE_KEYS.rotationAngle);
  const storedCapitalizeLetters = resolvedStorage.getItem(TEXT_STYLE_STORAGE_KEYS.capitalizeLetters);

  return Object.fromEntries(
    Object.entries({
      width: storedWidth
        ? normalizeNumericField(storedWidth, DEFAULT_TEXT_STYLE_DRAFT.width, {
            min: 24,
            max: 4096,
            integer: true,
          })
        : undefined,
      height: storedHeight
        ? normalizeNumericField(storedHeight, DEFAULT_TEXT_STYLE_DRAFT.height, {
            min: 24,
            max: 4096,
            integer: true,
          })
        : undefined,
      fontSize: storedFontSize
        ? normalizeNumericField(storedFontSize, DEFAULT_TEXT_STYLE_DRAFT.fontSize, {
            min: 1,
            max: 240,
            integer: true,
          })
        : undefined,
      fontFamily: storedFontFamily || undefined,
      fillColor: storedFillColor
        ? getSafeColorValue(storedFillColor, DEFAULT_TEXT_STYLE_DRAFT.fillColor)
        : undefined,
      strokeColor: storedStrokeColor
        ? getSafeColorValue(storedStrokeColor, DEFAULT_TEXT_STYLE_DRAFT.strokeColor)
        : undefined,
      strokeWidth: storedStrokeWidth
        ? normalizeNumericField(storedStrokeWidth, DEFAULT_TEXT_STYLE_DRAFT.strokeWidth, {
            min: 0,
            max: 40,
            integer: true,
          })
        : undefined,
      bold: storedBold === 'true' ? true : storedBold === 'false' ? false : undefined,
      italic: storedItalic === 'true' ? true : storedItalic === 'false' ? false : undefined,
      underline: storedUnderline === 'true' ? true : storedUnderline === 'false' ? false : undefined,
      textAlign: VALID_TEXT_ALIGN_VALUES.has(storedTextAlign) ? storedTextAlign : undefined,
      lineHeight: storedLineHeight
        ? normalizeNumericField(storedLineHeight, DEFAULT_TEXT_STYLE_DRAFT.lineHeight, {
            min: 0.6,
            max: 3,
          })
        : undefined,
      autoWrap:
        storedAutoWrap === 'true' ? true : storedAutoWrap === 'false' ? false : undefined,
      letterSpacing: storedLetterSpacing
        ? normalizeNumericField(storedLetterSpacing, DEFAULT_TEXT_STYLE_DRAFT.letterSpacing, {
            min: -20,
            max: 100,
          })
        : undefined,
      shadowBlur: storedShadowBlur
        ? normalizeNumericField(storedShadowBlur, DEFAULT_TEXT_STYLE_DRAFT.shadowBlur, {
            min: 0,
            max: 100,
          })
        : undefined,
      shadowOffsetX: storedShadowOffsetX
        ? normalizeNumericField(storedShadowOffsetX, DEFAULT_TEXT_STYLE_DRAFT.shadowOffsetX, {
            min: -200,
            max: 200,
          })
        : undefined,
      shadowOffsetY: storedShadowOffsetY
        ? normalizeNumericField(storedShadowOffsetY, DEFAULT_TEXT_STYLE_DRAFT.shadowOffsetY, {
            min: -200,
            max: 200,
          })
        : undefined,
      rotationAngle: storedRotationAngle
        ? normalizeNumericField(storedRotationAngle, DEFAULT_TEXT_STYLE_DRAFT.rotationAngle, {
            min: -360,
            max: 360,
          })
        : undefined,
      capitalizeLetters:
        storedCapitalizeLetters === 'true'
          ? true
          : storedCapitalizeLetters === 'false'
            ? false
            : undefined,
    }).filter(([, value]) => value !== undefined)
  );
}

export function persistTextStyleConfig(value, storage) {
  const resolvedStorage =
    storage || (typeof window !== 'undefined' ? window.localStorage : null);
  if (!resolvedStorage) {
    return;
  }

  const draft = buildTextStyleDraft(value);
  const sharedStyle = mapTextDraftToStyleConfig(draft);

  resolvedStorage.setItem(TEXT_STYLE_STORAGE_KEYS.width, `${sharedStyle.width}`);
  resolvedStorage.setItem(TEXT_STYLE_STORAGE_KEYS.height, `${sharedStyle.height}`);
  resolvedStorage.setItem(TEXT_STYLE_STORAGE_KEYS.fontSize, `${sharedStyle.fontSize}`);
  resolvedStorage.setItem(TEXT_STYLE_STORAGE_KEYS.fontFamily, sharedStyle.fontFamily);
  resolvedStorage.setItem(TEXT_STYLE_STORAGE_KEYS.fillColor, sharedStyle.fillColor);
  resolvedStorage.setItem(TEXT_STYLE_STORAGE_KEYS.strokeColor, sharedStyle.strokeColor);
  resolvedStorage.setItem(TEXT_STYLE_STORAGE_KEYS.strokeWidth, `${sharedStyle.strokeWidth}`);
  resolvedStorage.setItem(TEXT_STYLE_STORAGE_KEYS.bold, `${sharedStyle.bold}`);
  resolvedStorage.setItem(TEXT_STYLE_STORAGE_KEYS.italic, `${sharedStyle.italic}`);
  resolvedStorage.setItem(TEXT_STYLE_STORAGE_KEYS.underline, `${sharedStyle.underline}`);
  resolvedStorage.setItem(TEXT_STYLE_STORAGE_KEYS.textAlign, sharedStyle.textAlign);
  resolvedStorage.setItem(TEXT_STYLE_STORAGE_KEYS.lineHeight, `${sharedStyle.lineHeight}`);
  resolvedStorage.setItem(TEXT_STYLE_STORAGE_KEYS.autoWrap, `${sharedStyle.autoWrap}`);
  resolvedStorage.setItem(TEXT_STYLE_STORAGE_KEYS.letterSpacing, `${sharedStyle.letterSpacing}`);
  resolvedStorage.setItem(TEXT_STYLE_STORAGE_KEYS.shadowBlur, `${sharedStyle.shadowBlur}`);
  resolvedStorage.setItem(TEXT_STYLE_STORAGE_KEYS.shadowOffsetX, `${sharedStyle.shadowOffsetX}`);
  resolvedStorage.setItem(TEXT_STYLE_STORAGE_KEYS.shadowOffsetY, `${sharedStyle.shadowOffsetY}`);
  resolvedStorage.setItem(TEXT_STYLE_STORAGE_KEYS.rotationAngle, `${sharedStyle.rotationAngle}`);
  resolvedStorage.setItem(
    TEXT_STYLE_STORAGE_KEYS.capitalizeLetters,
    `${sharedStyle.capitalizeLetters}`
  );
}

function IconToggleButton({ active, onClick, children, title, className = '' }) {
  return (
    <button
      type="button"
      title={title}
      onClick={onClick}
      className={`inline-flex items-center justify-center rounded-xl border px-3 py-2 text-sm font-medium transition ${className} ${active ? 'border-transparent' : ''}`}
    >
      {children}
    </button>
  );
}

function ActionButton({ onClick, icon, label, className = '' }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`inline-flex items-center justify-center gap-2 rounded-xl border px-3 py-2 text-sm font-medium transition ${className}`}
    >
      {icon}
      <span>{label}</span>
    </button>
  );
}

export default function TextStylePanel(props) {
  const {
    value,
    onChange,
    onSubmit,
    submitLabel = 'Add text',
    submitDisabled = false,
    showSubmitButton = true,
    editorVariant = 'videoStudio',
    header = 'Text',
    helperText = null,
    layerActions = [],
    density = 'comfortable',
    advancedInitiallyOpen = false,
  } = props;

  const { colorMode } = useColorMode();
  const isImageStudio = editorVariant === 'imageStudio';
  const isCompact = density === 'compact';
  const draft = buildTextStyleDraft(value);
  const [isAdvancedOpen, setIsAdvancedOpen] = React.useState(Boolean(advancedInitiallyOpen));

  React.useEffect(() => {
    setIsAdvancedOpen(Boolean(advancedInitiallyOpen));
  }, [advancedInitiallyOpen]);

  const fieldSurface =
    colorMode === 'dark'
      ? 'bg-[#111a2f] border border-[#1f2a3d] text-slate-100'
      : 'bg-white border border-slate-200 text-slate-900';
  const cardSurface =
    colorMode === 'dark'
      ? 'bg-[#0f1629] border border-[#1f2a3d] text-slate-100'
      : 'bg-slate-50 border border-slate-200 text-slate-900';
  const mutedText = colorMode === 'dark' ? 'text-slate-400' : 'text-slate-500';
  const activeToggle =
    colorMode === 'dark'
      ? 'bg-rose-500 text-white shadow-[0_10px_22px_rgba(244,63,94,0.24)]'
      : 'bg-rose-500 text-white shadow-sm';
  const inactiveToggle =
    colorMode === 'dark'
      ? 'bg-[#111a2f] border-[#1f2a3d] text-slate-200 hover:bg-[#17233d]'
      : 'bg-white border-slate-200 text-slate-700 hover:bg-slate-100';
  const destructiveAction =
    colorMode === 'dark'
      ? 'bg-rose-500/12 border-rose-400/35 text-rose-100 hover:bg-rose-500/18'
      : 'bg-rose-50 border-rose-200 text-rose-700 hover:bg-rose-100';
  const neutralAction =
    colorMode === 'dark'
      ? 'bg-[#111a2f] border-[#1f2a3d] text-slate-200 hover:bg-[#17233d]'
      : 'bg-white border-slate-200 text-slate-700 hover:bg-slate-100';
  const inputClassName = `w-full rounded-xl px-3 ${isCompact ? 'py-2' : 'py-2.5'} text-sm shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-400/20 ${fieldSurface}`;
  const sectionTitleClass = `${isCompact ? 'mb-1' : 'mb-2'} text-[11px] font-semibold uppercase tracking-[0.18em] ${mutedText}`;

  const updateDraft = (changes) => {
    if (typeof onChange !== 'function') return;
    onChange(buildTextStyleDraft({ ...draft, ...changes }));
  };

  const updateNumericField = (field, rawValue, fallback, { min = null, max = null, step = null } = {}) => {
    const parsedValue = step ? parseFloat(rawValue) : parseInt(rawValue, 10);
    let nextValue = Number.isFinite(parsedValue) ? parsedValue : fallback;
    if (typeof min === 'number') {
      nextValue = Math.max(min, nextValue);
    }
    if (typeof max === 'number') {
      nextValue = Math.min(max, nextValue);
    }
    updateDraft({ [field]: nextValue });
  };

  const styleButtons = [
    {
      key: 'bold',
      active: draft.bold,
      title: 'Bold',
      icon: <FaBold />,
    },
    {
      key: 'italic',
      active: draft.italic,
      title: 'Italic',
      icon: <FaItalic />,
    },
    {
      key: 'underline',
      active: draft.underline,
      title: 'Underline',
      icon: <FaUnderline />,
    },
  ];

  const alignmentButtons = [
    { key: 'left', icon: <FaAlignLeft />, title: 'Align left' },
    { key: 'center', icon: <FaAlignCenter />, title: 'Align center' },
    { key: 'right', icon: <FaAlignRight />, title: 'Align right' },
  ];

  const safeFillColor = getSafeColorValue(draft.fillColor, '#ffffff');
  const safeStrokeColor = getSafeColorValue(draft.strokeColor, '#ffffff');
  const advancedNumberFields = [
    {
      field: 'width',
      label: 'Box Width',
      min: 24,
      max: 4096,
      fallback: DEFAULT_TEXT_STYLE_DRAFT.width,
    },
    {
      field: 'height',
      label: 'Box Height',
      min: 24,
      max: 4096,
      fallback: DEFAULT_TEXT_STYLE_DRAFT.height,
    },
    {
      field: 'letterSpacing',
      label: 'Letter Space',
      min: -20,
      max: 100,
      fallback: DEFAULT_TEXT_STYLE_DRAFT.letterSpacing,
      step: 0.5,
    },
    {
      field: 'rotationAngle',
      label: 'Rotation',
      min: -360,
      max: 360,
      fallback: DEFAULT_TEXT_STYLE_DRAFT.rotationAngle,
      step: 1,
    },
    {
      field: 'shadowBlur',
      label: 'Shadow Blur',
      min: 0,
      max: 100,
      fallback: DEFAULT_TEXT_STYLE_DRAFT.shadowBlur,
      step: 0.5,
    },
    {
      field: 'shadowOffsetX',
      label: 'Shadow X',
      min: -200,
      max: 200,
      fallback: DEFAULT_TEXT_STYLE_DRAFT.shadowOffsetX,
      step: 1,
    },
    {
      field: 'shadowOffsetY',
      label: 'Shadow Y',
      min: -200,
      max: 200,
      fallback: DEFAULT_TEXT_STYLE_DRAFT.shadowOffsetY,
      step: 1,
    },
  ];

  return (
    <div className={`flex flex-col ${isCompact ? 'gap-2.5' : isImageStudio ? 'gap-4' : 'gap-3'}`}>
      <div>
        <div className={`${isImageStudio ? 'text-base' : 'text-sm'} font-semibold`}>{header}</div>
        {helperText ? <div className={`mt-1 text-xs ${mutedText}`}>{helperText}</div> : null}
      </div>

      <div>
        <div className={sectionTitleClass}>Content</div>
        <TextareaAutosize
          minRows={isCompact ? 2 : isImageStudio ? 4 : 3}
          value={draft.text}
          onChange={(event) => updateDraft({ text: event.target.value })}
          placeholder="Enter text"
          className={`${inputClassName} ${isCompact ? 'min-h-[72px]' : 'min-h-[96px]'} resize-none`}
        />
      </div>

      <div className={`grid grid-cols-[minmax(0,1fr)_110px] ${isCompact ? 'gap-2' : 'gap-3'}`}>
        <div>
          <div className={sectionTitleClass}>Font</div>
          <SingleSelect
            value={TEXT_FONT_OPTIONS.find((option) => option.value === draft.fontFamily) || TEXT_FONT_OPTIONS[0]}
            onChange={(option) => updateDraft({ fontFamily: option?.value || DEFAULT_TEXT_STYLE_DRAFT.fontFamily })}
            options={TEXT_FONT_OPTIONS}
          />
        </div>
        <div>
          <div className={sectionTitleClass}>Size</div>
          <input
            type="number"
            min="1"
            max="240"
            value={draft.fontSize}
            onChange={(event) => updateNumericField('fontSize', event.target.value, DEFAULT_TEXT_STYLE_DRAFT.fontSize, { min: 1, max: 240 })}
            className={inputClassName}
          />
        </div>
      </div>

      <div className={`grid grid-cols-2 ${isCompact ? 'gap-2' : 'gap-3'}`}>
        <div className={`${cardSurface} rounded-2xl ${isCompact ? 'p-2.5' : 'p-3'}`}>
          <div className={sectionTitleClass}>Text Color</div>
          <div className="flex items-center gap-3">
            <input
              type="color"
              value={safeFillColor}
              onChange={(event) => updateDraft({ fillColor: event.target.value })}
              className="h-11 w-14 cursor-pointer rounded-xl border border-slate-300 bg-transparent p-1"
            />
            <div className={`rounded-xl px-3 py-2 text-sm font-medium ${fieldSurface}`}>
              {safeFillColor.toUpperCase()}
            </div>
          </div>
        </div>

        <div className={`${cardSurface} rounded-2xl ${isCompact ? 'p-2.5' : 'p-3'}`}>
          <div className={sectionTitleClass}>Outline</div>
          <div className="flex items-center gap-3">
            <input
              type="color"
              value={safeStrokeColor}
              onChange={(event) =>
                updateDraft({
                  strokeColor: event.target.value,
                  strokeWidth: draft.strokeWidth > 0 ? draft.strokeWidth : 1,
                })
              }
              className="h-11 w-14 cursor-pointer rounded-xl border border-slate-300 bg-transparent p-1"
            />
            <div className="flex min-w-0 flex-1 items-center gap-2">
              <div className={`min-w-0 flex-1 rounded-xl px-3 py-2 text-sm font-medium ${fieldSurface}`}>
                {draft.strokeWidth > 0 ? safeStrokeColor.toUpperCase() : 'Off'}
              </div>
              <input
                type="number"
                min="0"
                max="40"
                value={draft.strokeWidth}
                onChange={(event) => updateNumericField('strokeWidth', event.target.value, 0, { min: 0, max: 40 })}
                className={`${inputClassName} w-[84px] text-center`}
              />
            </div>
          </div>
        </div>
      </div>

      <div className={`grid grid-cols-2 ${isCompact ? 'gap-2' : 'gap-3'}`}>
        <div>
          <div className={sectionTitleClass}>Style</div>
          <div className="grid grid-cols-3 gap-2">
            {styleButtons.map((button) => (
              <IconToggleButton
                key={button.key}
                title={button.title}
                active={button.active}
                onClick={() => updateDraft({ [button.key]: !draft[button.key] })}
                className={button.active ? activeToggle : inactiveToggle}
              >
                {button.icon}
              </IconToggleButton>
            ))}
          </div>
        </div>

        <div>
          <div className={sectionTitleClass}>Align</div>
          <div className="grid grid-cols-3 gap-2">
            {alignmentButtons.map((button) => (
              <IconToggleButton
                key={button.key}
                title={button.title}
                active={draft.textAlign === button.key}
                onClick={() => updateDraft({ textAlign: button.key })}
                className={draft.textAlign === button.key ? activeToggle : inactiveToggle}
              >
                {button.icon}
              </IconToggleButton>
            ))}
          </div>
        </div>
      </div>

      <div className={`grid ${isCompact ? 'grid-cols-1' : 'grid-cols-2'} ${isCompact ? 'gap-2' : 'gap-3'}`}>
        <div>
          <div className={sectionTitleClass}>Line Height</div>
          <input
            type="number"
            min="0.6"
            max="3"
            step="0.1"
            value={draft.lineHeight}
            onChange={(event) => updateNumericField('lineHeight', event.target.value, 1.2, { min: 0.6, max: 3, step: 0.1 })}
            className={inputClassName}
          />
        </div>

        <div>
          <div className={sectionTitleClass}>Wrap</div>
          <button
            type="button"
            onClick={() => updateDraft({ autoWrap: !draft.autoWrap })}
            className={`flex min-h-[42px] w-full items-center justify-between gap-3 rounded-xl border px-3 py-2 text-sm font-semibold transition ${draft.autoWrap ? activeToggle : inactiveToggle}`}
          >
            <span>Word Wrap</span>
            <span className="text-xs">{draft.autoWrap ? 'On' : 'Off'}</span>
          </button>
        </div>
      </div>

      <details
        open={isAdvancedOpen}
        onToggle={(event) => setIsAdvancedOpen(event.currentTarget.open)}
        className={`${cardSurface} rounded-2xl ${isCompact ? 'p-2.5' : 'p-3'}`}
      >
        <summary className={`cursor-pointer list-none text-[11px] font-semibold uppercase tracking-[0.18em] ${mutedText}`}>
          Advanced Layout
        </summary>
        <div className={`mt-3 grid max-h-[min(38vh,360px)] overflow-y-auto pr-1 ${isCompact ? 'grid-cols-2' : 'grid-cols-3'} ${isCompact ? 'gap-2' : 'gap-3'}`}>
          {advancedNumberFields.map((fieldConfig) => (
            <div key={fieldConfig.field}>
              <div className={sectionTitleClass}>{fieldConfig.label}</div>
              <input
                type="number"
                min={fieldConfig.min}
                max={fieldConfig.max}
                step={fieldConfig.step || 1}
                value={draft[fieldConfig.field]}
                onChange={(event) =>
                  updateNumericField(
                    fieldConfig.field,
                    event.target.value,
                    fieldConfig.fallback,
                    {
                      min: fieldConfig.min,
                      max: fieldConfig.max,
                      step: fieldConfig.step || 1,
                    }
                  )
                }
                className={inputClassName}
              />
            </div>
          ))}

          <div>
            <div className={sectionTitleClass}>Uppercase</div>
            <button
              type="button"
              onClick={() => updateDraft({ capitalizeLetters: !draft.capitalizeLetters })}
              className={`flex min-h-[42px] w-full items-center justify-between gap-3 rounded-xl border px-3 py-2 text-sm font-semibold transition ${draft.capitalizeLetters ? activeToggle : inactiveToggle}`}
            >
              <span>Caps</span>
              <span className="text-xs">{draft.capitalizeLetters ? 'On' : 'Off'}</span>
            </button>
          </div>
        </div>
      </details>

      {!isCompact ? (
        <div className={`${cardSurface} rounded-2xl ${isCompact ? 'p-2.5' : 'p-3'}`}>
          <div className={sectionTitleClass}>Preview</div>
          <div
            className={`rounded-xl px-3 py-3 text-sm ${fieldSurface}`}
            style={{
              fontFamily: draft.fontFamily,
              fontSize: `${Math.max(14, Math.min(draft.fontSize, 28))}px`,
              color: safeFillColor,
              WebkitTextStroke:
                draft.strokeWidth > 0
                  ? `${Math.max(0.4, Math.min(draft.strokeWidth, 3))}px ${safeStrokeColor}`
                  : '0 transparent',
              fontWeight: draft.bold ? 700 : 400,
              fontStyle: draft.italic ? 'italic' : 'normal',
              textDecoration: draft.underline ? 'underline' : 'none',
              textAlign: draft.textAlign,
              lineHeight: draft.lineHeight,
              letterSpacing: `${draft.letterSpacing}px`,
              textTransform: draft.capitalizeLetters ? 'uppercase' : 'none',
              whiteSpace: draft.autoWrap ? 'normal' : 'pre',
              overflowWrap: draft.autoWrap ? 'break-word' : 'normal',
              overflowX: draft.autoWrap ? 'hidden' : 'auto',
            }}
          >
            {draft.text || 'Sample text'}
          </div>
        </div>
      ) : null}

      {layerActions.length > 0 ? (
        <div>
          <div className={sectionTitleClass}>Layer Actions</div>
          <div className={`grid gap-2 ${layerActions.length >= 3 ? 'grid-cols-3' : 'grid-cols-2'}`}>
            {layerActions.map((action) => (
              <ActionButton
                key={action.label}
                onClick={action.onClick}
                icon={
                  action.icon === 'backward' ? (
                    <FaChevronCircleDown className="text-base" />
                  ) : action.icon === 'forward' ? (
                    <FaChevronCircleUp className="text-base" />
                  ) : (
                    <FaTrash className="text-base" />
                  )
                }
                label={action.label}
                className={action.intent === 'danger' ? destructiveAction : neutralAction}
              />
            ))}
          </div>
        </div>
      ) : null}

      {showSubmitButton ? (
        <div className="pt-1">
          <CommonButton onClick={onSubmit} isDisabled={submitDisabled}>
            {submitLabel}
          </CommonButton>
        </div>
      ) : null}
    </div>
  );
}
