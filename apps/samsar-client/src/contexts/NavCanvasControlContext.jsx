// NavCanvasControlContext.js
import { createContext, useEffect, useState } from 'react';

export const NavCanvasControlContext = createContext();

export const NavCanvasControlProvider = ({ children }) => {
  const [isExpressGeneration, setIsExpressGeneration] = useState(false);
  const [expressGenerativeVideoRequired] = useState(false);
  const [sessionId, setSessionId] = useState(null);
  const [displayZoomType, setDisplayZoomType] = useState('normal');
  const [stageZoomScale, setStageZoomScale] = useState(1);

  // Add state for functions with setters
  const [downloadCurrentFrame, setDownloadCurrentFrame] = useState(() => () => {});
  const [toggleStageZoom, setToggleStageZoom] = useState(() => () => {});
  const [zoomCanvasIn, setZoomCanvasIn] = useState(() => () => {});
  const [zoomCanvasOut, setZoomCanvasOut] = useState(() => () => {});
  const [resetCanvasZoom, setResetCanvasZoom] = useState(() => () => {});
  const [requestRegenerateSubtitles, setRequestRegenerateSubtitles] = useState(() => () => {});
  const [requestRegenerateAnimations, setRequestRegenerateAnimations] = useState(() => () => {});
  const [requestRealignLayers, setRequestRealignLayers] = useState(() => () => {});
  const [ requestRealignToAiVideoAndLayers, setRequestRealignToAiVideoAndLayers] = useState(() => () => {});

  const [showGridOverlay, setShowGridOverlay] = useState(false);
  const [showCanvasNavigationGrid, setShowCanvasNavigationGrid] = useState(false);
  const [canvasNavigationGridGranularity, setCanvasNavigationGridGranularity] = useState(3);
  const [snapEraserToGrid, setSnapEraserToGrid] = useState(false);
  const [canvasZoomPercent, setCanvasZoomPercent] = useState(100);
  const [canZoomInCanvas, setCanZoomInCanvas] = useState(false);
  const [canZoomOutCanvas, setCanZoomOutCanvas] = useState(false);

  const [ isVideoPreviewPlaying, setIsVideoPreviewPlaying ] = useState(false);


  const [canvasActualDimensions, setCanvasActualDimensions] = useState({ width: 1024, height: 1024 });

  const [totalEffectiveDuration, setTotalEffectiveDuration] = useState(0);


  const toggleShowGridOverlay = () => setShowGridOverlay(prev => !prev);
  const toggleShowCanvasNavigationGrid = () => setShowCanvasNavigationGrid(prev => !prev);

  const toggleIsVideoPreviewPlaying = () => setIsVideoPreviewPlaying(prev => !prev);

  useEffect(() => {
    if (!showCanvasNavigationGrid && snapEraserToGrid) {
      setSnapEraserToGrid(false);
    }
  }, [showCanvasNavigationGrid, snapEraserToGrid]);

  // isVideoPreviewPlaying, toggleIsVideoPreviewPlaying 


  return (
    <NavCanvasControlContext.Provider
      value={{
        isExpressGeneration,
        setIsExpressGeneration,
        sessionId,
        setSessionId,
        displayZoomType,
        setDisplayZoomType,
        stageZoomScale,
        setStageZoomScale,
        downloadCurrentFrame,
        setDownloadCurrentFrame,
        toggleStageZoom,
        setToggleStageZoom,
        zoomCanvasIn,
        setZoomCanvasIn,
        zoomCanvasOut,
        setZoomCanvasOut,
        resetCanvasZoom,
        setResetCanvasZoom,
        requestRegenerateSubtitles,
        setRequestRegenerateSubtitles,
        requestRegenerateAnimations,
        setRequestRegenerateAnimations,
        requestRealignLayers,
        setRequestRealignLayers,
        canvasActualDimensions,
        setCanvasActualDimensions,
        totalEffectiveDuration, 
        setTotalEffectiveDuration,
        requestRealignToAiVideoAndLayers,
        setRequestRealignToAiVideoAndLayers,
        expressGenerativeVideoRequired,
        showGridOverlay,
        setShowGridOverlay,
        toggleShowGridOverlay,
        showCanvasNavigationGrid,
        setShowCanvasNavigationGrid,
        toggleShowCanvasNavigationGrid,
        canvasNavigationGridGranularity,
        setCanvasNavigationGridGranularity,
        snapEraserToGrid,
        setSnapEraserToGrid,
        canvasZoomPercent,
        setCanvasZoomPercent,
        canZoomInCanvas,
        setCanZoomInCanvas,
        canZoomOutCanvas,
        setCanZoomOutCanvas,
        isVideoPreviewPlaying,
        toggleIsVideoPreviewPlaying,
      }}
    >
      {children}
    </NavCanvasControlContext.Provider>
  );
};
