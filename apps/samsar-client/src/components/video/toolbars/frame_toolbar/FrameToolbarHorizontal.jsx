import { useRef, useEffect, useState, useMemo } from "react";
import { DragDropContext, Droppable, Draggable } from "react-beautiful-dnd";
import ReactSlider from "react-slider";
import { FaChevronLeft, FaChevronRight } from "react-icons/fa";
import { useColorMode } from "../../../../contexts/ColorMode.jsx";

const SCENE_TILE_GAP = 0;

export default function FrameToolbarHorizontal({
  layers,
  selectedLayerIndex,
  setSelectedLayerIndex,
  setSelectedLayer,
  totalDuration,
  currentLayerSeek,
  setCurrentLayerSeek,
  onLayersOrderChange,
  isRenderPending,
}) {
  const fps = 30;
  const totalFrames = Math.max(1, Math.floor(totalDuration * fps));
  const safeTotalDuration = Math.max(totalDuration || 0, 0.001);

  // Scroll container
  const railRef = useRef(null);
  const layerRefs = useRef({}); // NEW: hold refs to each layer tile
  const [canScrollLeft, setCanScrollLeft] = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(false);
  const [viewportWidth, setViewportWidth] = useState(0);
  const { colorMode } = useColorMode();

  // --- helpers ----------------------------------------------------
  const measureScrollability = () => {
    const el = railRef.current;
    if (!el) return;
    const left = el.scrollLeft;
    const right = el.scrollLeft + el.clientWidth < el.scrollWidth - 1;
    setCanScrollLeft(left > 0);
    setCanScrollRight(right);
  };

  const updateViewportWidth = () => {
    const width = railRef.current?.clientWidth || 0;
    setViewportWidth((prev) => (prev === width ? prev : width));
  };

  useEffect(() => {
    // measure on mount & whenever content could change
    measureScrollability();
    updateViewportWidth();
  }, [layers, safeTotalDuration]);

  useEffect(() => {
    const el = railRef.current;
    if (!el) return;
    const onScroll = () => measureScrollability();
    const onResize = () => {
      updateViewportWidth();
      measureScrollability();
    };
    el.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onResize, { passive: true });
    let observer;
    if (typeof ResizeObserver !== "undefined") {
      observer = new ResizeObserver(onResize);
      observer.observe(el);
    }

    onResize();

    return () => {
      el.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onResize);
      if (observer) observer.disconnect();
    };
  }, []);

  const scrollByAmount = (direction) => {
    const el = railRef.current;
    if (!el) return;
    const viewport = el.clientWidth || 0;
    const step = viewport ? viewport * 0.7 : 320;
    const amount = Math.sign(direction || 1) * step;
    el.scrollBy({ left: amount, behavior: "smooth" });
  };

  // NEW: ensure a given layer index is visible inside the rail
  const ensureLayerIndexVisible = (index) => {
    const scroller = railRef.current;
    if (!scroller || !layers || !layers[index]) return;

    const key = layers[index]._id;
    const tile = layerRefs.current[key];
    if (!tile) return;

    const scRect = scroller.getBoundingClientRect();
    const elRect = tile.getBoundingClientRect();

    // A bit of padding so it doesn't hug the edge
    const PAD = 16;

    // If tile is to the right of the visible area
    if (elRect.right > scRect.right - PAD) {
      const dx = elRect.right - scRect.right + PAD;
      scroller.scrollBy({ left: dx, behavior: "smooth" });
      return;
    }
    // If tile is to the left of the visible area
    if (elRect.left < scRect.left + PAD) {
      const dx = elRect.left - scRect.left - PAD;
      scroller.scrollBy({ left: dx, behavior: "smooth" });
    }
  };

  // Keep selected tile visible whenever selectedLayerIndex changes externally
  useEffect(() => {
    ensureLayerIndexVisible(selectedLayerIndex);
  }, [selectedLayerIndex, layers]);

  // --- seek -------------------------------------------------------
  const handleSeek = (frame) => {
    const clamped = Math.max(0, Math.min(frame, totalFrames));
    setCurrentLayerSeek(clamped);
  };

  // --- dnd --------------------------------------------------------
  const onDragEnd = (result) => {
    if (isRenderPending) return;
    if (!result.destination) return;
    const sourceIndex = result.source.index;
    const destIndex = result.destination.index;
    if (sourceIndex === destIndex) return;

    const newOrder = Array.from(layers);
    const [removed] = newOrder.splice(sourceIndex, 1);
    newOrder.splice(destIndex, 0, removed);
    onLayersOrderChange && onLayersOrderChange(newOrder, removed._id);

    // After reorder, make sure the moved tile is visible
    ensureLayerIndexVisible(destIndex); // NEW
  };

  // Optional: as you drag, nudge the rail when the destination index is off-screen
  const onDragUpdate = (update) => {
    if (update?.destination) {
      ensureLayerIndexVisible(update.destination.index); // NEW (safety net)
    }
  };

  const sceneDurationSum = useMemo(() => {
    if (!layers?.length) return 0;
    return layers.reduce((sum, layer) => {
      return sum + Math.max(Number(layer?.duration) || 0, 0);
    }, 0);
  }, [layers]);

  const trackWidth = useMemo(() => {
    return Math.max(1, Math.floor(viewportWidth || 0));
  }, [viewportWidth]);

  const tileWidths = useMemo(() => {
    if (!layers?.length) return [];
    const totalGapWidth = Math.max(layers.length - 1, 0) * SCENE_TILE_GAP;
    const availableSceneWidth = Math.max(1, trackWidth - totalGapWidth);

    return layers.map((layer) => {
      const duration = Math.max(Number(layer?.duration) || 0, 0);
      const durationRatio = sceneDurationSum > 0
        ? duration / sceneDurationSum
        : 1 / layers.length;
      return Math.max(0, availableSceneWidth * durationRatio);
    });
  }, [layers, sceneDurationSum, trackWidth]);



  return (
    <div
      className={`${
        colorMode === "dark"
          ? "bg-[#0f1629] text-slate-100 border border-[#1f2a3d] shadow-[0_14px_36px_rgba(0,0,0,0.32)]"
          : "bg-white/90 text-slate-800 border border-slate-200 backdrop-blur-sm"
      } w-full overflow-hidden`}
      aria-disabled={isRenderPending}
    >
      <div>
        {/* Seek */}
        <div className="px-3 pt-2 pb-1.5 space-y-1.5">
          <ReactSlider
            key="horizontal-seek-slider"
            className="modern-horizontal-slider flex h-6 w-full items-center"
            min={0}
            max={totalFrames}
            value={currentLayerSeek}
            onChange={handleSeek}
            renderTrack={(props, state) => {
              const { key, className, style, ...trackProps } = props;
              return (
                <div
                  key={key}
                  {...trackProps}
                  className={`h-[4px] rounded-full ${
                    state.index === 0
                      ? colorMode === "dark"
                        ? "bg-rose-400/70"
                        : "bg-amber-400/70"
                      : colorMode === "dark"
                        ? "bg-[#16213a]"
                        : "bg-slate-200"
                  } ${className ?? ""}`}
                  style={style}
                />
              );
            }}
            renderThumb={(props) => {
              const { key, className, style, ...thumbProps } = props;
              const baseClass =
                colorMode === "dark"
                  ? "bg-white border border-white/40 shadow-[0_4px_14px_rgba(148,163,184,0.35)]"
                  : "bg-amber-400 border border-amber-200";
              return (
                <div
                  key={key}
                  {...thumbProps}
                  className={`${className ?? ""} h-4 w-4 rounded-full ${baseClass}`}
                  style={style}
                />
              );
            }}
          />
          <div className={`text-[10px] font-medium ${colorMode === "dark" ? "text-slate-400" : "text-slate-500"}`}>
            {(currentLayerSeek / fps).toFixed(2)}s / {totalDuration.toFixed(2)}s
          </div>
        </div>

        <div className="px-3 pb-2">
          <div className="relative flex-1 min-w-0">
            {canScrollLeft && (
              <button
                className={`absolute left-1 top-1/2 z-10 -translate-y-1/2 rounded-full p-2 transition-colors duration-150 ${
                  colorMode === "dark"
                    ? "bg-[#111a2f] text-slate-100 border border-[#1f2a3d] hover:bg-[#16213a]"
                    : "bg-white text-slate-600 border border-slate-200 hover:bg-slate-50"
                } ${colorMode === "dark" ? "shadow-sm" : ""}`}
                onClick={() => scrollByAmount(-1)}
                aria-label="Scroll left"
              >
                <FaChevronLeft />
              </button>
            )}

            {canScrollRight && (
              <button
                className={`absolute right-1 top-1/2 z-10 -translate-y-1/2 rounded-full p-2 transition-colors duration-150 ${
                  colorMode === "dark"
                    ? "bg-[#111a2f] text-slate-100 border border-[#1f2a3d] hover:bg-[#16213a]"
                    : "bg-white text-slate-600 border border-slate-200 hover:bg-slate-50"
                } ${colorMode === "dark" ? "shadow-sm" : ""}`}
                onClick={() => scrollByAmount(1)}
                aria-label="Scroll right"
              >
                <FaChevronRight />
              </button>
            )}

            {/* IMPORTANT: Make the Droppable be the scroll container so RBD can auto-scroll it */}
            <DragDropContext onDragEnd={onDragEnd} onDragUpdate={onDragUpdate}>
              <Droppable droppableId="rail" direction="horizontal">
                {(provided) => (
                  <div
                    className="flex-1 overflow-hidden no-scrollbar min-w-0"
                    ref={(node) => {
                      // attach both droppable ref and our local railRef
                      provided.innerRef(node);
                      railRef.current = node;
                    }}
                    {...provided.droppableProps}
                  >
                    {/* the wide track inside the scroll container */}
                    <div className="relative h-8" style={{ width: trackWidth }}>
                      <div
                        className="absolute inset-0 flex items-stretch"
                        style={{ gap: `${SCENE_TILE_GAP}px` }}
                      >
                        {layers.map((layer, i) => {
                          const widthPx = tileWidths[i] ?? 0;
                          const isSelected = i === selectedLayerIndex;
                          const showDurationLabel = widthPx >= 40;
                          return (
                            <Draggable
                              draggableId={layer._id.toString()}
                              index={i}
                              key={layer._id}
                              isDragDisabled={isRenderPending}
                            >
                              {(drag) => (
                                <div
                                  ref={(el) => {
                                    // IMPORTANT: set both the draggable ref and our own ref for visibility checks
                                    drag.innerRef(el);
                                    layerRefs.current[layer._id] = el; // NEW
                                  }}
                                  {...drag.draggableProps}
                                  {...drag.dragHandleProps}
                                  className={`rounded-md border transition-colors duration-150 ${
                                    isSelected
                                      ? colorMode === "dark"
                                        ? "border-rose-400/60 bg-rose-500/20 shadow-[0_6px_18px_rgba(248,113,113,0.18)]"
                                        : "border-amber-300 bg-amber-50"
                                      : colorMode === "dark"
                                        ? "border-[#1f2a3d] bg-[#111a2f] hover:border-rose-400/30"
                                        : "border-slate-200 bg-slate-100 hover:border-slate-300"
                                  } cursor-pointer flex items-center justify-center select-none overflow-hidden box-border`}
                                  style={{
                                    width: widthPx,
                                    flex: `0 0 ${widthPx}px`,
                                    minWidth: 0,
                                    // RBD requires applying its style for animations / transforms
                                    ...drag.draggableProps.style,
                                  }}
                                  onClick={() => {
                                    setSelectedLayerIndex(i);
                                    setSelectedLayer(layer);
                                    ensureLayerIndexVisible(i); // NEW: clicking also ensures visibility
                                  }}
                                  data-layer-id={layer._id} // helpful for debugging
                                >
                                  <div className="min-w-0 overflow-hidden px-1 text-center text-[10px] leading-tight">
                                    <div className="truncate font-semibold">{i + 1}</div>
                                    {showDurationLabel && (
                                      <div className={`truncate ${colorMode === "dark" ? "text-slate-200/90" : "text-slate-600"}`}>
                                        {layer.duration?.toFixed(1)}s
                                      </div>
                                    )}
                                  </div>
                                </div>
                              )}
                            </Draggable>
                          );
                        })}
                        {provided.placeholder}
                      </div>

                      <Playhead
                        fps={fps}
                        currentFrame={currentLayerSeek}
                        layers={layers}
                        tileWidths={tileWidths}
                        gap={SCENE_TILE_GAP}
                      />
                    </div>
                  </div>
                )}
              </Droppable>
            </DragDropContext>
          </div>
        </div>
      </div>
    </div>
  );
}

function Playhead({ fps, currentFrame, layers, tileWidths, gap }) {
  const safeLayers = layers || [];
  const seconds = currentFrame / fps;
  let cursor = 0;
  let accumulated = 0;
  const totalTrackWidth = tileWidths.reduce((sum, width, index) => {
    return sum + width + (index < safeLayers.length - 1 ? gap : 0);
  }, 0);

  for (let i = 0; i < safeLayers.length; i++) {
    const duration = Math.max(safeLayers[i]?.duration || 0, 0.001);
    const nextAccumulated = accumulated + duration;
    const width = tileWidths[i] ?? 0;

    if (seconds >= nextAccumulated) {
      cursor += width + (i < safeLayers.length - 1 ? gap : 0);
      accumulated = nextAccumulated;
      continue;
    }

    const ratio = duration > 0 ? (seconds - accumulated) / duration : 0;
    cursor += width * Math.max(0, Math.min(1, ratio));
    break;
  }

  return (
    <div
      className="absolute top-0 h-full w-px bg-emerald-400 pointer-events-none shadow-[0_0_0_1px_rgba(16,185,129,0.35)]"
      style={{ transform: `translateX(${Math.min(cursor, Math.max(0, totalTrackWidth - 1))}px)` }}
    />
  );
}
