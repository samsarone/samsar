import { useEffect, useMemo, useState } from 'react';
import { FaCheck, FaImage, FaRedo, FaSpinner } from 'react-icons/fa';

function normalizeString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function getItemId(item = {}, fallback = '') {
  return normalizeString(item.id) || normalizeString(item.itemId) || normalizeString(item.item_id) || fallback;
}

function getItemPrompt(item = {}, fallbackPrompt = '') {
  return (
    normalizeString(item.prompt) ||
    normalizeString(item.generationPrompt) ||
    normalizeString(item.sourcePrompt) ||
    fallbackPrompt
  );
}

function getItemRawUrl(item = {}) {
  return (
    normalizeString(item.src) ||
    normalizeString(item.rawUrl) ||
    normalizeString(item.raw_url) ||
    normalizeString(item.image) ||
    normalizeString(item.remoteURL) ||
    normalizeString(item.url)
  );
}

function compactItem(item = {}) {
  return Object.entries(item).reduce((result, [key, value]) => {
    if (value === undefined || value === null || value === '') return result;
    if (Array.isArray(value) && value.length === 0) return result;
    result[key] = value;
    return result;
  }, {});
}

function normalizeImageItemForPersistence(item = {}, {
  id,
  isPrimary = false,
  fallbackDimensions = {},
  fallbackAnimations = null,
} = {}) {
  const rawUrl = getItemRawUrl(item);
  const prompt = getItemPrompt(item);
  return compactItem({
    type: 'image',
    id,
    src: rawUrl,
    image: normalizeString(item.image) || rawUrl,
    x: item.x ?? fallbackDimensions.x,
    y: item.y ?? fallbackDimensions.y,
    width: item.width ?? fallbackDimensions.width,
    height: item.height ?? fallbackDimensions.height,
    is_base_image: isPrimary,
    prompt,
    generationPrompt: normalizeString(item.generationPrompt) || prompt,
    description: normalizeString(item.description),
    config: item.config,
    animations: Array.isArray(item.animations) && item.animations.length
      ? item.animations
      : fallbackAnimations,
  });
}

function buildReviewScenes(sessionPreview) {
  const layers = Array.isArray(sessionPreview?.layers) ? sessionPreview.layers : [];
  return layers
    .map((layer, sceneIndex) => {
      const fallbackPrompt = normalizeString(layer.image?.prompt) || normalizeString(layer.prompt);
      const imageItems = Array.isArray(layer.image?.items) ? layer.image.items : [];
      const editedImageUrl = normalizeString(
        layer.image?.editedImage ||
        layer.editedImage?.url ||
        (typeof layer.editedImage === 'string' ? layer.editedImage : ''),
      );
      const editedImageRawUrl = normalizeString(
        layer.image?.editedImageRawUrl ||
        layer.editedImage?.rawUrl,
      );
      const fallbackImageUrl = editedImageUrl || layer.image?.url;
      const items = imageItems.length
        ? imageItems.map((item) => (
          editedImageUrl && (item.isPrimary === true || item.is_base_image === true || item.role === 'primary')
            ? {
              ...item,
              url: editedImageUrl,
              rawUrl: editedImageRawUrl || item.rawUrl || editedImageUrl,
              src: editedImageRawUrl || item.src || editedImageUrl,
              image: editedImageRawUrl || item.image || editedImageUrl,
            }
            : item
        ))
        : fallbackImageUrl
          ? [{
            id: 'item_0',
            itemId: 'item_0',
            type: 'image',
            role: 'primary',
            isPrimary: true,
            is_base_image: true,
            url: fallbackImageUrl,
            rawUrl: editedImageRawUrl || layer.image?.rawUrl || fallbackImageUrl,
            src: editedImageRawUrl || layer.image?.rawUrl || fallbackImageUrl,
            image: editedImageRawUrl || layer.image?.rawUrl || fallbackImageUrl,
            prompt: fallbackPrompt,
          }]
          : [];

      const normalizedItems = items
        .map((item, itemIndex) => ({
          ...item,
          id: getItemId(item, `item_${itemIndex}`),
          itemId: getItemId(item, `item_${itemIndex}`),
          prompt: getItemPrompt(item, fallbackPrompt),
          url: normalizeString(item.url),
          isPrimary: item.isPrimary === true || item.is_base_image === true || item.role === 'primary',
        }))
        .filter((item) => item.url || getItemRawUrl(item));

      if (!normalizedItems.length) return null;
      if (!normalizedItems.some((item) => item.isPrimary)) {
        normalizedItems[0] = { ...normalizedItems[0], isPrimary: true, is_base_image: true, role: 'primary' };
      }

      return {
        index: sceneIndex,
        id: normalizeString(layer.id) || normalizeString(layer.layer_id),
        title: `Scene ${sceneIndex + 1}`,
        prompt: fallbackPrompt,
        status: normalizeString(layer.image?.status),
        items: normalizedItems,
      };
    })
    .filter(Boolean);
}

function buildPrimarySelectionItems(scene, selectedItem) {
  const selectedId = getItemId(selectedItem);
  const currentPrimary = scene.items.find((item) => item.isPrimary) || scene.items[0] || {};
  const primaryDimensions = {
    x: currentPrimary.x ?? 0,
    y: currentPrimary.y ?? 0,
    width: currentPrimary.width,
    height: currentPrimary.height,
  };
  const primaryAnimations = Array.isArray(currentPrimary.animations) ? currentPrimary.animations : null;
  const orderedItems = [
    selectedItem,
    ...scene.items.filter((item) => getItemId(item) !== selectedId),
  ];

  return orderedItems.map((item, index) => normalizeImageItemForPersistence(item, {
    id: `item_${index}`,
    isPrimary: index === 0,
    fallbackDimensions: primaryDimensions,
    fallbackAnimations: index === 0 ? primaryAnimations : null,
  }));
}

function getPromptStateKey(scene, item) {
  return `${scene.id || scene.index}:${getItemId(item)}`;
}

export default function StepImageReviewPanel({
  sessionPreview,
  colorMode,
  onSelectImage,
  onRegenerateImage,
}) {
  const scenes = useMemo(() => buildReviewScenes(sessionPreview), [sessionPreview]);
  const [selectedSceneIndex, setSelectedSceneIndex] = useState(0);
  const [promptDrafts, setPromptDrafts] = useState({});
  const [busyKey, setBusyKey] = useState('');

  useEffect(() => {
    if (selectedSceneIndex >= scenes.length) {
      setSelectedSceneIndex(0);
    }
  }, [scenes.length, selectedSceneIndex]);

  if (!scenes.length) return null;

  const selectedScene = scenes[selectedSceneIndex] || scenes[0];
  const primaryItem = selectedScene.items.find((item) => item.isPrimary) || selectedScene.items[0];
  const secondaryItems = selectedScene.items.filter((item) => getItemId(item) !== getItemId(primaryItem));
  const isDark = colorMode === 'dark';
  const shellClass = isDark
    ? 'border-white/10 bg-white/[0.04] text-slate-100'
    : 'border-slate-200 bg-slate-50 text-slate-900';
  const tileClass = isDark
    ? 'border-white/10 bg-[#101827]'
    : 'border-slate-200 bg-white';
  const mutedText = isDark ? 'text-slate-400' : 'text-slate-500';
  const inputClass = isDark
    ? 'border-white/10 bg-black/20 text-slate-100 focus:border-indigo-400'
    : 'border-slate-200 bg-white text-slate-900 focus:border-indigo-500';
  const quietButton = isDark
    ? 'border-white/10 bg-white/5 text-slate-100 hover:bg-white/10'
    : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50';

  const getDraftPrompt = (item) => {
    const key = getPromptStateKey(selectedScene, item);
    return promptDrafts[key] ?? getItemPrompt(item, selectedScene.prompt);
  };

  const updateDraftPrompt = (item, value) => {
    const key = getPromptStateKey(selectedScene, item);
    setPromptDrafts((prev) => ({ ...prev, [key]: value }));
  };

  const handleSelect = async (item) => {
    const key = `select:${selectedScene.id}:${getItemId(item)}`;
    setBusyKey(key);
    try {
      await onSelectImage?.({
        scene: selectedScene,
        item,
        activeItemList: buildPrimarySelectionItems(selectedScene, item),
      });
    } finally {
      setBusyKey('');
    }
  };

  const handleRegenerate = async (item) => {
    const key = `generate:${selectedScene.id}:${getItemId(item)}`;
    setBusyKey(key);
    try {
      await onRegenerateImage?.({
        scene: selectedScene,
        item,
        prompt: getDraftPrompt(item),
        isPrimary: getItemId(item) === getItemId(primaryItem),
      });
    } finally {
      setBusyKey('');
    }
  };

  const renderImageTile = (item, { primary = false } = {}) => {
    const itemId = getItemId(item);
    const selectKey = `select:${selectedScene.id}:${itemId}`;
    const generateKey = `generate:${selectedScene.id}:${itemId}`;
    const prompt = getDraftPrompt(item);

    return (
      <div className={`rounded-xl border ${tileClass} overflow-hidden`}>
        <div className="relative aspect-video w-full overflow-hidden bg-black/10">
          <img
            src={item.url}
            alt={`${selectedScene.title} ${primary ? 'primary' : 'alternate'}`}
            className="h-full w-full object-contain"
          />
          <div className={`absolute left-2 top-2 rounded-full px-2 py-1 text-[11px] font-semibold ${primary ? 'bg-indigo-600 text-white' : 'bg-amber-500 text-white'}`}>
            {primary ? 'Primary' : 'Alternate'}
          </div>
        </div>
        <div className="space-y-2 p-3">
          <textarea
            value={prompt}
            onChange={(event) => updateDraftPrompt(item, event.target.value)}
            rows={primary ? 4 : 3}
            className={`w-full resize-y rounded-lg border px-3 py-2 text-xs outline-none transition ${inputClass}`}
          />
          <div className="flex flex-wrap items-center gap-2">
            {!primary && (
              <button
                type="button"
                onClick={() => handleSelect(item)}
                disabled={Boolean(busyKey)}
                className="inline-flex items-center gap-2 rounded-lg bg-indigo-600 px-3 py-2 text-xs font-semibold text-white transition hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {busyKey === selectKey ? <FaSpinner className="animate-spin" /> : <FaCheck />}
                Use as primary
              </button>
            )}
            <button
              type="button"
              onClick={() => handleRegenerate(item)}
              disabled={Boolean(busyKey) || !prompt.trim()}
              className={`inline-flex items-center gap-2 rounded-lg border px-3 py-2 text-xs font-semibold transition disabled:cursor-not-allowed disabled:opacity-60 ${quietButton}`}
            >
              {busyKey === generateKey ? <FaSpinner className="animate-spin" /> : <FaRedo />}
              Generate
            </button>
          </div>
        </div>
      </div>
    );
  };

  return (
    <div className={`mt-4 rounded-xl border p-3 ${shellClass}`}>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2 text-sm font-semibold">
          <FaImage className={isDark ? 'text-indigo-300' : 'text-indigo-600'} />
          Image review
        </div>
        <div className={`text-xs ${mutedText}`}>
          {selectedScene.items.length} image{selectedScene.items.length === 1 ? '' : 's'}
        </div>
      </div>

      <div className="mb-3 flex gap-2 overflow-x-auto pb-1">
        {scenes.map((scene, index) => {
          const active = index === selectedSceneIndex;
          return (
            <button
              key={scene.id || scene.index}
              type="button"
              onClick={() => setSelectedSceneIndex(index)}
              className={`shrink-0 rounded-lg border px-3 py-2 text-xs font-semibold transition ${
                active
                  ? 'border-indigo-500 bg-indigo-600 text-white'
                  : quietButton
              }`}
            >
              {scene.title}
            </button>
          );
        })}
      </div>

      <div className="grid gap-3 lg:grid-cols-[minmax(0,1.1fr)_minmax(280px,0.9fr)]">
        {renderImageTile(primaryItem, { primary: true })}
        <div className="space-y-3">
          <div className={`text-xs font-semibold uppercase tracking-wide ${mutedText}`}>Alternates</div>
          {secondaryItems.length ? (
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-1">
              {secondaryItems.map((item) => (
                <div key={getItemId(item)}>
                  {renderImageTile(item)}
                </div>
              ))}
            </div>
          ) : (
            <div className={`rounded-xl border border-dashed p-4 text-sm ${mutedText} ${isDark ? 'border-white/10' : 'border-slate-300'}`}>
              No alternate images yet.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
