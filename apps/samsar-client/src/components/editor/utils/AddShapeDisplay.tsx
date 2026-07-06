import { useMemo, useState } from 'react';
import { FaRegCircle, FaSlidersH } from "react-icons/fa";
import { MdOutlineRectangle } from "react-icons/md";
import { IoTriangleOutline } from "react-icons/io5";
import SingleSelect from '../../common/SingleSelect.jsx';
import CanvasActionOptionsDialog from './CanvasActionOptionsDialog.jsx';
import { useAlertDialog } from '../../../contexts/AlertDialogContext.jsx';
import { useColorMode } from '../../../contexts/ColorMode.jsx';
import { getCanvasDimensionsForAspectRatio } from '../../../utils/canvas.jsx';

const SHAPE_PREFERENCES_STORAGE_KEY = 'samsarStudioShapePreferences';

const SHAPE_DEFINITIONS = [
  { key: 'rectangle', label: 'Rectangle' },
  { key: 'circle', label: 'Circle' },
  { key: 'polygon', label: 'Polygon' },
  { key: 'dialog', label: 'Dialog' },
];

const SHAPE_FIELD_KEYS = {
  rectangle: ['x', 'y', 'width', 'height', 'strokeWidth'],
  circle: ['x', 'y', 'radius', 'strokeWidth'],
  polygon: ['x', 'y', 'radius', 'sides', 'strokeWidth'],
  dialog: ['x', 'y', 'width', 'height', 'pointerX', 'pointerY', 'strokeWidth'],
};

function readStoredShapePreferences() {
  if (typeof window === 'undefined') {
    return {};
  }

  try {
    const storedPreferences = window.localStorage.getItem(SHAPE_PREFERENCES_STORAGE_KEY);
    return storedPreferences ? JSON.parse(storedPreferences) : {};
  } catch  {
    return {};
  }
}

function persistShapePreferences(preferences) {
  if (typeof window === 'undefined') {
    return;
  }

  try {
    window.localStorage.setItem(SHAPE_PREFERENCES_STORAGE_KEY, JSON.stringify(preferences));
  } catch  {
    // Ignore storage failures so shape creation still works.
  }
}

function toFiniteNumber(value, fallback) {
  const numericValue = Number(value);
  return Number.isFinite(numericValue) ? numericValue : fallback;
}

function rounded(value) {
  return Math.round(value);
}

function buildCenteredShapeDefaults(shapeKey, canvasDimensions, colorDefaults) {
  const canvasWidth = canvasDimensions.width;
  const canvasHeight = canvasDimensions.height;
  const canvasCenterX = canvasWidth / 2;
  const canvasCenterY = canvasHeight / 2;
  const shortSide = Math.min(canvasWidth, canvasHeight);
  const commonDefaults = {
    fillColor: colorDefaults.fillColor,
    strokeColor: colorDefaults.strokeColor,
    strokeWidth: colorDefaults.strokeWidth,
    fillCanvas: false,
  };

  if (shapeKey === 'circle') {
    const radius = rounded(shortSide * 0.18);
    return {
      ...commonDefaults,
      x: rounded(canvasCenterX),
      y: rounded(canvasCenterY),
      radius,
    };
  }

  if (shapeKey === 'polygon') {
    const radius = rounded(shortSide * 0.2);
    return {
      ...commonDefaults,
      x: rounded(canvasCenterX),
      y: rounded(canvasCenterY),
      radius,
      sides: 6,
    };
  }

  if (shapeKey === 'dialog') {
    const width = rounded(Math.min(canvasWidth * 0.5, 420));
    const height = rounded(Math.min(canvasHeight * 0.22, 180));
    const x = rounded(canvasCenterX);
    const y = rounded(canvasCenterY);

    return {
      ...commonDefaults,
      x,
      y,
      width,
      height,
      pointerX: x,
      pointerY: rounded(y + height / 2),
    };
  }

  const width = rounded(Math.min(canvasWidth * 0.42, 420));
  const height = rounded(Math.min(canvasHeight * 0.28, 280));

  return {
    ...commonDefaults,
    x: rounded((canvasWidth - width) / 2),
    y: rounded((canvasHeight - height) / 2),
    width,
    height,
  };
}

function buildFillCanvasShapeDefaults(shapeKey, canvasDimensions, preferences) {
  const canvasWidth = canvasDimensions.width;
  const canvasHeight = canvasDimensions.height;
  const canvasCenterX = canvasWidth / 2;
  const canvasCenterY = canvasHeight / 2;
  const shortSide = Math.min(canvasWidth, canvasHeight);

  if (shapeKey === 'circle') {
    return {
      x: rounded(canvasCenterX),
      y: rounded(canvasCenterY),
      radius: rounded(shortSide / 2),
    };
  }

  if (shapeKey === 'polygon') {
    return {
      x: rounded(canvasCenterX),
      y: rounded(canvasCenterY),
      radius: rounded(shortSide / 2),
      sides: toFiniteNumber(preferences.sides, 6),
    };
  }

  if (shapeKey === 'dialog') {
    const width = rounded(canvasWidth * 0.82);
    const height = rounded(canvasHeight * 0.38);
    const x = rounded(canvasCenterX);
    const y = rounded(canvasCenterY);

    return {
      x,
      y,
      width,
      height,
      pointerX: x,
      pointerY: rounded(Math.min(canvasHeight, y + height / 2 + Math.max(24, height * 0.2))),
    };
  }

  return {
    x: 0,
    y: 0,
    width: canvasWidth,
    height: canvasHeight,
  };
}

function normalizeShapePreferences(shapeKey, preferences, canvasDimensions, colorDefaults) {
  const fallback = buildCenteredShapeDefaults(shapeKey, canvasDimensions, colorDefaults);
  const mergedPreferences = {
    ...fallback,
    ...(preferences || {}),
  };
  const normalizedPreferences = {
    ...mergedPreferences,
    fillColor: mergedPreferences.fillColor || mergedPreferences.fill || fallback.fillColor,
    strokeColor: mergedPreferences.strokeColor || mergedPreferences.stroke || fallback.strokeColor,
    fillCanvas: Boolean(mergedPreferences.fillCanvas),
  };

  SHAPE_FIELD_KEYS[shapeKey].forEach((fieldKey) => {
    normalizedPreferences[fieldKey] = toFiniteNumber(
      normalizedPreferences[fieldKey],
      fallback[fieldKey]
    );
  });

  if (shapeKey === 'polygon') {
    normalizedPreferences.sides = Math.max(3, Math.round(normalizedPreferences.sides));
  }

  return normalizedPreferences;
}

function buildShapeConfig(shapeKey, rawPreferences, canvasDimensions, colorDefaults) {
  const normalizedPreferences = normalizeShapePreferences(
    shapeKey,
    rawPreferences,
    canvasDimensions,
    colorDefaults
  );
  const preferences = normalizedPreferences.fillCanvas
    ? {
      ...normalizedPreferences,
      ...buildFillCanvasShapeDefaults(shapeKey, canvasDimensions, normalizedPreferences),
    }
    : normalizedPreferences;

  const sharedConfig = {
    fillColor: preferences.fillColor,
    strokeColor: preferences.strokeColor,
    strokeWidth: preferences.strokeWidth,
  };

  if (shapeKey === 'circle') {
    const radius = Math.max(1, preferences.radius);
    return {
      ...sharedConfig,
      x: preferences.x,
      y: preferences.y,
      radius,
      width: radius * 2,
      height: radius * 2,
    };
  }

  if (shapeKey === 'polygon') {
    const radius = Math.max(1, preferences.radius);
    return {
      ...sharedConfig,
      x: preferences.x,
      y: preferences.y,
      radius,
      sides: Math.max(3, Math.round(preferences.sides)),
      width: radius * 2,
      height: radius * 2,
    };
  }

  if (shapeKey === 'dialog') {
    return {
      ...sharedConfig,
      x: preferences.x,
      y: preferences.y,
      width: Math.max(1, preferences.width),
      height: Math.max(1, preferences.height),
      pointerX: preferences.pointerX,
      pointerY: preferences.pointerY,
      xRadius: Math.max(1, preferences.width) / 2,
      yRadius: Math.max(1, preferences.height) / 2,
    };
  }

  return {
    ...sharedConfig,
    x: preferences.x,
    y: preferences.y,
    width: Math.max(1, preferences.width),
    height: Math.max(1, preferences.height),
  };
}

function ShapePreferencesFields({
  selectedShapeKey,
  preferences,
  updatePreferences,
  isExpandedView,
  colorMode,
}) {
  const subtleTextColor = colorMode === 'dark' ? 'text-slate-300' : 'text-slate-600';
  const inputSurface = colorMode === 'dark'
    ? 'bg-[#111a2f] border border-[#24314d] text-slate-100'
    : 'bg-slate-50 border border-slate-200 text-slate-900';
  const gridClass = isExpandedView
    ? 'grid grid-cols-2 gap-3'
    : 'grid grid-cols-1 gap-3 md:grid-cols-2';

  const renderNumberField = ({ label, fieldKey, min, max, step = 1 }) => (
    <label className={`block text-xs font-semibold ${subtleTextColor}`}>
      <span className="mb-1 block">{label}</span>
      <input
        type="number"
        min={min}
        max={max}
        step={step}
        value={preferences[fieldKey]}
        onChange={(event) => updatePreferences(
          { [fieldKey]: toFiniteNumber(event.target.value, 0) },
          { disableFillCanvas: fieldKey !== 'sides' }
        )}
        className={`h-10 w-full rounded-lg px-3 text-sm outline-none transition focus:border-blue-400 focus:ring-2 focus:ring-blue-400/20 ${inputSurface}`}
      />
    </label>
  );

  const renderColorField = ({ label, fieldKey }) => (
    <label className={`block text-xs font-semibold ${subtleTextColor}`}>
      <span className="mb-1 block">{label}</span>
      <input
        type="color"
        value={preferences[fieldKey]}
        onChange={(event) => updatePreferences({ [fieldKey]: event.target.value })}
        className={`h-10 w-full cursor-pointer rounded-lg p-1 ${inputSurface}`}
      />
    </label>
  );

  const shapeSpecificFields = {
    rectangle: (
      <>
        {renderNumberField({ label: 'X', fieldKey: 'x' })}
        {renderNumberField({ label: 'Y', fieldKey: 'y' })}
        {renderNumberField({ label: 'Width', fieldKey: 'width', min: 1 })}
        {renderNumberField({ label: 'Height', fieldKey: 'height', min: 1 })}
      </>
    ),
    circle: (
      <>
        {renderNumberField({ label: 'Center X', fieldKey: 'x' })}
        {renderNumberField({ label: 'Center Y', fieldKey: 'y' })}
        {renderNumberField({ label: 'Radius', fieldKey: 'radius', min: 1 })}
      </>
    ),
    polygon: (
      <>
        {renderNumberField({ label: 'Center X', fieldKey: 'x' })}
        {renderNumberField({ label: 'Center Y', fieldKey: 'y' })}
        {renderNumberField({ label: 'Radius', fieldKey: 'radius', min: 1 })}
        {renderNumberField({ label: 'Sides', fieldKey: 'sides', min: 3, max: 12 })}
      </>
    ),
    dialog: (
      <>
        {renderNumberField({ label: 'Center X', fieldKey: 'x' })}
        {renderNumberField({ label: 'Center Y', fieldKey: 'y' })}
        {renderNumberField({ label: 'Width', fieldKey: 'width', min: 1 })}
        {renderNumberField({ label: 'Height', fieldKey: 'height', min: 1 })}
        {renderNumberField({ label: 'Pointer X', fieldKey: 'pointerX' })}
        {renderNumberField({ label: 'Pointer Y', fieldKey: 'pointerY' })}
      </>
    ),
  };

  return (
    <>
      <div className={gridClass}>
        {renderColorField({ label: 'Fill', fieldKey: 'fillColor' })}
        {renderColorField({ label: 'Stroke', fieldKey: 'strokeColor' })}
        {renderNumberField({ label: 'Stroke Width', fieldKey: 'strokeWidth', min: 0 })}
        {shapeSpecificFields[selectedShapeKey]}
      </div>

      <label className={`mt-4 flex items-center gap-2 text-xs font-semibold ${subtleTextColor}`}>
        <input
          type="checkbox"
          checked={preferences.fillCanvas}
          onChange={(event) => updatePreferences({ fillCanvas: event.target.checked })}
          className="h-4 w-4 rounded border-slate-400"
        />
        <span>Fill canvas</span>
      </label>
    </>
  );
}

function ShapeOptionsDialogContent({
  selectedShapeKey,
  selectedShapeLabel,
  initialPreferences,
  canvasDimensions,
  colorDefaults,
  colorMode,
  onClose,
  onPreferencesChange,
  onApply,
}) {
  const [draftPreferences, setDraftPreferences] = useState(initialPreferences);
  const mutedClass = colorMode === 'dark' ? 'text-slate-400' : 'text-slate-500';
  const secondaryButtonClass = colorMode === 'dark'
    ? 'border border-[#273956] bg-[#111a2f] text-slate-100 hover:bg-[#172642]'
    : 'border border-slate-200 bg-white text-slate-700 hover:bg-slate-50';

  const updateDraftPreferences = (preferenceChanges, options = {}) => {
    setDraftPreferences((previousPreferences) => {
      const nextPreferenceChanges = options.disableFillCanvas
        ? { fillCanvas: false, ...preferenceChanges }
        : preferenceChanges;
      const mergedPreferences = {
        ...previousPreferences,
        ...nextPreferenceChanges,
      };
      const normalizedPreferences = normalizeShapePreferences(
        selectedShapeKey,
        mergedPreferences.fillCanvas
          ? {
            ...mergedPreferences,
            ...buildFillCanvasShapeDefaults(selectedShapeKey, canvasDimensions, mergedPreferences),
          }
          : mergedPreferences,
        canvasDimensions,
        colorDefaults
      );

      onPreferencesChange(normalizedPreferences);
      return normalizedPreferences;
    });
  };

  return (
    <CanvasActionOptionsDialog
      title="Shape options"
      subtitle={`${selectedShapeLabel} on ${canvasDimensions.width} x ${canvasDimensions.height} canvas`}
      badge="Canvas action"
      onClose={onClose}
      footer={(
        <>
          <button
            type="button"
            onClick={onClose}
            className={`rounded-lg px-4 py-2 text-sm font-semibold transition ${secondaryButtonClass}`}
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => onApply(draftPreferences)}
            className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-blue-500"
          >
            Apply
          </button>
        </>
      )}
    >
      <div className={`mb-4 text-xs ${mutedClass}`}>
        Changes are saved for this shape and reused the next time it is selected.
      </div>
      <ShapePreferencesFields
        selectedShapeKey={selectedShapeKey}
        preferences={draftPreferences}
        updatePreferences={updateDraftPreferences}
        isExpandedView={false}
        colorMode={colorMode}
      />
    </CanvasActionOptionsDialog>
  );
}

export default function AddShapeDisplay(props: any) {
  const {
    setSelectedShape,
    setStrokeColor,
    setFillColor,
    fillColor,
    strokeColor,
    strokeWidthValue,
    setStrokeWidthValue,
    isExpandedView = false,
    aspectRatio = '1:1',
  } = props;

  const { colorMode } = useColorMode();
  const { openAlertDialog, closeAlertDialog } = useAlertDialog();
  const canvasDimensions = getCanvasDimensionsForAspectRatio(aspectRatio || '1:1');
  const colorDefaults = useMemo(() => ({
    fillColor: fillColor || '#030712',
    strokeColor: strokeColor || '#030712',
    strokeWidth: toFiniteNumber(strokeWidthValue, 2),
  }), [fillColor, strokeColor, strokeWidthValue]);

  const [selectedShapeKey, setSelectedShapeKey] = useState('rectangle');
  const [shapePreferences, setShapePreferences] = useState(() => {
    const storedPreferences = readStoredShapePreferences();
    return SHAPE_DEFINITIONS.reduce((nextPreferences, shapeDefinition) => {
      const shapeKey = shapeDefinition.key;
      nextPreferences[shapeKey] = normalizeShapePreferences(
        shapeKey,
        storedPreferences[shapeKey],
        canvasDimensions,
        colorDefaults
      );
      return nextPreferences;
    }, {});
  });

  const selectedPreferences = normalizeShapePreferences(
    selectedShapeKey,
    shapePreferences[selectedShapeKey],
    canvasDimensions,
    colorDefaults
  );
  const selectedShapeOption = SHAPE_DEFINITIONS.find(
    (shapeDefinition) => shapeDefinition.key === selectedShapeKey
  );

  const textColor = colorMode === 'dark' ? 'text-slate-100' : 'text-slate-900';
  const subtleTextColor = colorMode === 'dark' ? 'text-slate-300' : 'text-slate-600';
  const panelSurface = colorMode === 'dark'
    ? 'bg-[#0f1629] border border-[#1f2a3d]'
    : 'bg-white border border-slate-200';
  const compactSurface = colorMode === 'dark'
    ? 'bg-[#111a2f] border border-[#24314d]'
    : 'bg-slate-50 border border-slate-200';
  const activePillClass = colorMode === 'dark'
    ? 'bg-rose-500/20 border-rose-400/40 text-rose-100'
    : 'bg-rose-50 border-rose-200 text-rose-700';
  const inactivePillClass = colorMode === 'dark'
    ? 'bg-[#111a2f] border-[#24314d] text-slate-200 hover:bg-[#18243c]'
    : 'bg-slate-100 border-slate-200 text-slate-700 hover:bg-white';
  const secondaryButtonClass = colorMode === 'dark'
    ? 'border border-[#273956] bg-[#111a2f] text-slate-100 hover:bg-[#172642]'
    : 'border border-slate-200 bg-white text-slate-700 hover:bg-slate-50';

  const syncParentColorState = (preferences) => {
    if (typeof setFillColor === 'function') {
      setFillColor(preferences.fillColor);
    }
    if (typeof setStrokeColor === 'function') {
      setStrokeColor(preferences.strokeColor);
    }
    if (typeof setStrokeWidthValue === 'function') {
      setStrokeWidthValue(preferences.strokeWidth);
    }
  };

  const persistNextPreferences = (updater) => {
    setShapePreferences((previousPreferences) => {
      const nextPreferences = typeof updater === 'function'
        ? updater(previousPreferences)
        : updater;
      persistShapePreferences(nextPreferences);
      return nextPreferences;
    });
  };

  const replaceShapePreferences = (shapeKey, nextShapePreferences) => {
    const normalizedPreferences = normalizeShapePreferences(
      shapeKey,
      nextShapePreferences,
      canvasDimensions,
      colorDefaults
    );

    persistNextPreferences((previousPreferences) => ({
      ...previousPreferences,
      [shapeKey]: normalizedPreferences,
    }));

    if (shapeKey === selectedShapeKey) {
      syncParentColorState(normalizedPreferences);
    }

    return normalizedPreferences;
  };

  const updateSelectedPreferences = (preferenceChanges, options = {}) => {
    const currentPreferences = normalizeShapePreferences(
      selectedShapeKey,
      shapePreferences[selectedShapeKey],
      canvasDimensions,
      colorDefaults
    );
    const nextPreferenceChanges = options.disableFillCanvas
      ? { fillCanvas: false, ...preferenceChanges }
      : preferenceChanges;
    const mergedPreferences = {
      ...currentPreferences,
      ...nextPreferenceChanges,
    };

    replaceShapePreferences(
      selectedShapeKey,
      mergedPreferences.fillCanvas
        ? {
          ...mergedPreferences,
          ...buildFillCanvasShapeDefaults(selectedShapeKey, canvasDimensions, mergedPreferences),
        }
        : mergedPreferences
    );
  };

  const handleShapeChange = (nextShapeKey) => {
    const nextShapePreferences = normalizeShapePreferences(
      nextShapeKey,
      shapePreferences[nextShapeKey],
      canvasDimensions,
      colorDefaults
    );
    setSelectedShapeKey(nextShapeKey);
    syncParentColorState(nextShapePreferences);
  };

  const applyShapeWithPreferences = (shapeKey, preferences) => {
    const normalizedPreferences = replaceShapePreferences(shapeKey, preferences);
    const nextShapeConfig = buildShapeConfig(
      shapeKey,
      normalizedPreferences,
      canvasDimensions,
      colorDefaults
    );
    setSelectedShape(shapeKey, nextShapeConfig);
  };

  const handleApplyShape = () => {
    applyShapeWithPreferences(selectedShapeKey, selectedPreferences);
  };

  const showOptionsDialog = () => {
    const shapeKeyAtOpen = selectedShapeKey;
    const shapeOptionAtOpen = selectedShapeOption || SHAPE_DEFINITIONS[0];
    const preferencesAtOpen = selectedPreferences;

    openAlertDialog(
      <ShapeOptionsDialogContent
        selectedShapeKey={shapeKeyAtOpen}
        selectedShapeLabel={shapeOptionAtOpen.label}
        initialPreferences={preferencesAtOpen}
        canvasDimensions={canvasDimensions}
        colorDefaults={colorDefaults}
        colorMode={colorMode}
        onClose={closeAlertDialog}
        onPreferencesChange={(nextPreferences) => {
          replaceShapePreferences(shapeKeyAtOpen, nextPreferences);
        }}
        onApply={(nextPreferences) => {
          applyShapeWithPreferences(shapeKeyAtOpen, nextPreferences);
          closeAlertDialog();
        }}
      />,
      undefined,
      true,
      { hideCloseButton: true, hideBorder: true, fullBleed: true, centerContent: true }
    );
  };

  const renderShapeIcon = (shapeKey, iconClassName = 'text-xl') => {
    if (shapeKey === 'rectangle') {
      return <MdOutlineRectangle className={iconClassName} />;
    }
    if (shapeKey === 'circle') {
      return <FaRegCircle className={iconClassName} />;
    }
    if (shapeKey === 'polygon') {
      return <IoTriangleOutline className={iconClassName} />;
    }
    return (
      <span
        className={`relative inline-block h-5 w-6 shrink-0 rounded-md border-2 border-current ${iconClassName}`}
        aria-hidden="true"
      >
        <span className="absolute -bottom-[5px] left-2 h-2 w-2 rotate-45 border-b-2 border-r-2 border-current bg-inherit" />
      </span>
    );
  };

  return (
    <div className={`p-2 ${textColor}`}>
      {!isExpandedView ? (
        <>
          <div className="mb-3">
            <label className={`mb-1 block text-xs font-semibold uppercase tracking-[0.08em] ${subtleTextColor}`}>
              Shape
            </label>
            <SingleSelect
              name="shapeType"
              placeholder="Select shape..."
              options={SHAPE_DEFINITIONS.map((shapeDefinition) => ({
                value: shapeDefinition.key,
                label: shapeDefinition.label,
              }))}
              value={{
                value: selectedShapeOption?.key || 'rectangle',
                label: selectedShapeOption?.label || 'Rectangle',
              }}
              onChange={(selectedOption) => handleShapeChange(selectedOption?.value || 'rectangle')}
              isSearchable={false}
              truncateLabels
            />
          </div>

          <div className={`rounded-xl p-3 ${compactSurface}`}>
            <div className="mb-3 flex items-center gap-2">
              {renderShapeIcon(selectedShapeKey)}
              <div className="min-w-0">
                <div className="truncate text-sm font-semibold">
                  {selectedShapeOption?.label || 'Rectangle'}
                </div>
                <div className={`text-[11px] ${subtleTextColor}`}>
                  {canvasDimensions.width} x {canvasDimensions.height}
                </div>
              </div>
            </div>

            <button
              type="button"
              onClick={showOptionsDialog}
              className={`mb-2 flex w-full items-center justify-center gap-2 rounded-lg px-3 py-2 text-sm font-semibold transition ${secondaryButtonClass}`}
            >
              <FaSlidersH />
              Options
            </button>
            <button
              type="button"
              onClick={handleApplyShape}
              className="w-full rounded-lg bg-blue-600 px-3 py-2 text-sm font-semibold text-white transition hover:bg-blue-500"
            >
              Apply
            </button>
          </div>
        </>
      ) : (
        <>
          <div className="mb-4 grid grid-cols-4 gap-2">
            {SHAPE_DEFINITIONS.map((shapeDefinition) => {
              const isSelected = selectedShapeKey === shapeDefinition.key;
              return (
                <button
                  key={shapeDefinition.key}
                  type="button"
                  onClick={() => handleShapeChange(shapeDefinition.key)}
                  className={`flex min-h-[52px] items-center justify-center gap-2 rounded-full border px-3 py-2 text-xs font-semibold transition ${isSelected ? activePillClass : inactivePillClass}`}
                  aria-pressed={isSelected}
                >
                  {renderShapeIcon(shapeDefinition.key, 'text-lg')}
                  <span className="truncate">{shapeDefinition.label}</span>
                </button>
              );
            })}
          </div>

          <div className={`rounded-xl p-3 ${panelSurface}`}>
            <div className="mb-3 flex items-center gap-2">
              {renderShapeIcon(selectedShapeKey)}
              <div className="min-w-0">
                <div className="text-sm font-semibold">{selectedShapeOption?.label || 'Rectangle'}</div>
                <div className={`text-[11px] ${subtleTextColor}`}>
                  {canvasDimensions.width} x {canvasDimensions.height}
                </div>
              </div>
            </div>

            <ShapePreferencesFields
              selectedShapeKey={selectedShapeKey}
              preferences={selectedPreferences}
              updatePreferences={updateSelectedPreferences}
              isExpandedView={isExpandedView}
              colorMode={colorMode}
            />

            <button
              type="button"
              onClick={handleApplyShape}
              className="mt-4 w-full rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-blue-500"
            >
              Apply
            </button>
          </div>
        </>
      )}
    </div>
  );
}
