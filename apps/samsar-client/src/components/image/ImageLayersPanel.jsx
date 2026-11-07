import { useUiLanguage } from '../../hooks/useUiLanguage.js';
import { translateText as uiText } from '../../utils/localization.js';
import { useMemo, useState } from 'react';
import {
  FaChevronDown,
  FaChevronUp,
  FaEye,
  FaEyeSlash,
  FaGripLines,
  FaLayerGroup,
  FaTrash,
} from 'react-icons/fa';
import { DragDropContext, Droppable, Draggable } from 'react-beautiful-dnd';
import { useColorMode } from '../../contexts/ColorMode.jsx';

const reorder = (list, startIndex, endIndex) => {
  const result = Array.from(list);
  const [removed] = result.splice(startIndex, 1);
  result.splice(endIndex, 0, removed);
  return result;
};

const normalizeItemsAndSelection = (items, selectedId) => {
  const idMap = new Map();
  const normalizedItems = items.map((item, index) => {
    const previousId = item?.id ?? `item_${index}`;
    const nextId = `item_${index}`;
    idMap.set(previousId, nextId);
    return {
      ...item,
      id: nextId,
    };
  });

  if (!selectedId) {
    return { normalizedItems, nextSelectedId: null };
  }

  return {
    normalizedItems,
    nextSelectedId: idMap.get(selectedId) || null,
  };
};

const getLayerLabel = (item, index) => {
  if (item?.type === 'shape' && (item?.config?.fixed || item?.subType === 'background')) {
    return uiText("Background");
  }

  if (item?.type === 'text') {
    const text = typeof item?.text === 'string' ? item.text.trim() : '';
    if (text) {
      return uiText("Text: {value0}{value1}", { value0: text.slice(0, 26), value1: text.length > 26 ? '...' : '' });
    }
    return uiText("Text {value0}", { value0: index + 1 });
  }

  if (item?.type === 'image') {
    return uiText("Image {value0}", { value0: index + 1 });
  }

  if (item?.type === 'shape') {
    const shapeType = item?.shape || uiText('Shape');
    return `${shapeType.charAt(0).toUpperCase()}${shapeType.slice(1)} ${index + 1}`;
  }

  return uiText("Layer {value0}", { value0: index + 1 });
};

export default function ImageLayersPanel(props) {
  useUiLanguage();
  const {
    activeItemList,
    setActiveItemList,
    updateSessionLayerActiveItemList,
    selectedId,
    setSelectedId,
    onToggleItemVisibility,
    sizeVariant = 'default',
  } = props;

  const { colorMode } = useColorMode();
  const isImageStudio = sizeVariant === 'imageStudio';
  const [isCollapsed, setIsCollapsed] = useState(false);

  const items = useMemo(
    () => (Array.isArray(activeItemList) ? activeItemList : []),
    [activeItemList]
  );
  const displayItems = useMemo(
    () => [...items].reverse(),
    [items]
  );

  const cardSurface =
    'bg-surface border border-line text-fg';
  const listBackground =
    colorMode === 'dark'
      ? 'bg-[#151720]'
      : 'bg-slate-50';
  const rowBase =
    'bg-surface-raised border border-line hover:bg-surface-hover';
  const rowSelected =
    colorMode === 'dark'
      ? '!border-[#f6c453]/70 bg-[#f6c453]/10'
      : 'border-rose-300 bg-rose-50';
  const iconButton =
    colorMode === 'dark'
      ? 'text-slate-300 hover:text-[#ffe0a3]'
      : 'text-slate-500 hover:text-rose-600';
  const emptyState =
    'text-fg-muted';
  const subtleText =
    "text-fg-tertiary";
  const panelPaddingClass = isImageStudio ? 'mt-5 rounded-[22px] p-4' : 'mt-4 rounded-xl p-3';
  const headerLabelClass = isImageStudio ? 'text-base font-semibold' : 'text-sm font-semibold';
  const countBadgeClass = isImageStudio
    ? `text-sm px-2.5 py-1 rounded-full ${listBackground} ${subtleText}`
    : `text-xs px-2 py-0.5 rounded-full ${listBackground} ${subtleText}`;
  const emptyStateClass = isImageStudio ? `text-sm text-center py-4 ${emptyState}` : `text-xs text-center py-3 ${emptyState}`;
  const rowClassName = isImageStudio ? 'rounded-xl px-3 py-3 transition' : 'rounded-lg px-2 py-2 transition';
  const itemTitleClass = isImageStudio ? 'text-sm font-medium truncate' : 'text-xs font-medium truncate';
  const itemTypeClass = isImageStudio ? `text-xs uppercase tracking-[0.18em] ${subtleText}` : `text-caption uppercase tracking-wide ${subtleText}`;

  const applyUpdatedItems = (nextItems, nextSelectedId = null) => {
    setActiveItemList(nextItems);
    if (typeof setSelectedId === 'function') {
      setSelectedId(nextSelectedId);
    }
    updateSessionLayerActiveItemList(nextItems);
  };

  const handleDragEnd = (result) => {
    if (!result.destination) return;
    if (result.destination.index === result.source.index) return;

    const actualSourceIndex = items.length - 1 - result.source.index;
    const actualDestinationIndex = items.length - 1 - result.destination.index;
    const reorderedActual = reorder(items, actualSourceIndex, actualDestinationIndex);
    const { normalizedItems, nextSelectedId } = normalizeItemsAndSelection(reorderedActual, selectedId);
    applyUpdatedItems(normalizedItems, nextSelectedId);
  };

  const handleDelete = (itemId) => {
    const filteredItems = items.filter((item) => item?.id !== itemId);
    const { normalizedItems, nextSelectedId } = normalizeItemsAndSelection(filteredItems, selectedId);
    applyUpdatedItems(normalizedItems, selectedId === itemId ? null : nextSelectedId);
  };

  return (
    <div className={`${panelPaddingClass} ${cardSurface}`}>
      <button
        type="button"
        className="w-full flex items-center justify-between"
        onClick={() => setIsCollapsed((prev) => !prev)}
      >
        <div className="flex items-center gap-2">
          <FaLayerGroup className={isImageStudio ? 'text-base' : 'text-sm'} />
          <div className={headerLabelClass}>{uiText("Layers")}</div>
          <div className={countBadgeClass}>
            {items.length}
          </div>
        </div>
        <div className={iconButton}>
          {isCollapsed ? <FaChevronDown /> : <FaChevronUp />}
        </div>
      </button>

      {!isCollapsed && (
        <div className={`mt-3 rounded-2xl p-3 ${listBackground}`}>
          {items.length === 0 ? (
            <div className={emptyStateClass}>{uiText("No layers yet.")}</div>
          ) : (
            <DragDropContext onDragEnd={handleDragEnd}>
              <Droppable droppableId="image-editor-layers-panel">
                {(provided) => (
                  <div
                    ref={provided.innerRef}
                    {...provided.droppableProps}
                    className={`${isImageStudio ? 'space-y-2.5 max-h-[280px]' : 'space-y-2 max-h-[220px]'} overflow-y-auto pr-1`}
                  >
                    {displayItems.map((item, index) => {
                      const currentItemId = item?.id ?? `item_${index}`;
                      const actualIndex = items.length - 1 - index;
                      const isSelected = selectedId === currentItemId;
                      const isHidden = Boolean(item?.isHidden);
                      return (
                        <Draggable
                          key={currentItemId}
                          draggableId={currentItemId.toString()}
                          index={index}
                        >
                          {(dragProvided, dragSnapshot) => (
                            <div
                              ref={dragProvided.innerRef}
                              {...dragProvided.draggableProps}
                              className={`${rowClassName} ${rowBase} ${
                                isSelected ? rowSelected : ''
                              } ${dragSnapshot.isDragging ? 'shadow-lg' : ''}`}
                              onClick={() => setSelectedId(currentItemId)}
                              style={dragProvided.draggableProps.style}
                            >
                              <div className="flex items-center gap-2">
                                <div
                                  className={`cursor-grab active:cursor-grabbing ${iconButton}`}
                                  {...dragProvided.dragHandleProps}
                                  aria-label={uiText("Reorder layer")}
                                >
                                  <FaGripLines />
                                </div>

                                <div className="flex-1 min-w-0">
                                  <div className={itemTitleClass}>
                                    {getLayerLabel(item, actualIndex)}
                                  </div>
                                  <div className={itemTypeClass}>
                                    {item?.type || uiText("item")}
                                  </div>
                                </div>

                                <button
                                  type="button"
                                  onClick={(event) => {
                                    event.stopPropagation();
                                    onToggleItemVisibility(currentItemId);
                                  }}
                                  className={iconButton}
                                  aria-label={isHidden ? uiText("Show layer") : uiText("Hide layer")}
                                  title={isHidden ? uiText("Show layer") : uiText("Hide layer")}
                                >
                                  {isHidden ? <FaEyeSlash /> : <FaEye />}
                                </button>

                                <button
                                  type="button"
                                  onClick={(event) => {
                                    event.stopPropagation();
                                    handleDelete(currentItemId);
                                  }}
                                  className={iconButton}
                                  aria-label={uiText("Delete layer")}
                                  title={uiText("Delete layer")}
                                >
                                  <FaTrash />
                                </button>
                              </div>
                            </div>
                          )}
                        </Draggable>
                      );
                    })}
                    {provided.placeholder}
                  </div>
                )}
              </Droppable>
            </DragDropContext>
          )}
        </div>
      )}
    </div>
  );
}
