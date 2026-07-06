import { useEffect, useMemo, useState } from "react";
import { FaQuestionCircle } from "react-icons/fa";
import CommonButton from "../../../common/CommonButton.tsx";
import { useColorMode } from "../../../../contexts/ColorMode.jsx";
import TextareaAutosize from "react-textarea-autosize";
import { Tooltip } from "react-tooltip";
import {
  getModelPriceForAspect,
  getVideoGenerationModelDropdownData,
  getVideoGenerationModelMeta,
} from "../../util/videoGenerationModelOptions.js";
import {
  formatVideoDurationLabel,
  getVideoModelDurationUnitsForFramesPerSecond,
} from "../../../../constants/ModelPrices.jsx";
import "react-tooltip/dist/react-tooltip.css";

const NATIVE_AUDIO_VIDEO_MODELS = new Set([
  "KLINGIMGTOVID3PRO",
  "KLINGTXTTOVID3PRO",
  "SEEDANCE2.0I2V",
  "SEEDANCE2.0T2V",
  "SEEDANCET2V",
  "VEO3.1",
  "VEO3.1FAST",
  "VEO3.1I2V",
  "VEO3.1FLIV",
  "VEO3.1I2VFAST",
]);

export default function OverlayPromptGenerateVideo(props) {
  const {
    videoPromptText,
    setVideoPromptText,
    submitGenerateNewVideoRequest,
    aiVideoGenerationPending,
    selectedVideoGenerationModel,
    setSelectedVideoGenerationModel,
    generationError,
    aspectRatio,
    activeItemList,
    currentLayer,
    sessionDetails,
    layoutMode = "square",
  } = props;

  const { colorMode } = useColorMode();
  const isPortraitLayout = layoutMode === "portrait";
  const isLandscapeLayout = layoutMode === "landscape";
  const selectShell =
    colorMode === "dark"
      ? "bg-slate-950 text-slate-100 border border-slate-700"
      : "bg-slate-50 text-slate-900 border border-slate-200 shadow-sm";
  const textareaShell =
    colorMode === "dark"
      ? "bg-slate-950 text-slate-100 border border-slate-700"
      : "bg-slate-50 text-slate-900 border border-slate-200 shadow-sm";
  const chipShell =
    colorMode === "dark"
      ? "bg-slate-950 border border-slate-700 text-slate-300 hover:bg-slate-900"
      : "bg-slate-50 border border-slate-200 text-slate-600 hover:bg-white";
  const fieldLabelClassName =
    colorMode === "dark"
      ? "text-xs font-semibold text-slate-200"
      : "text-xs font-semibold text-slate-700";
  const fieldLayoutClassName = isLandscapeLayout
    ? "grid w-full grid-cols-3 gap-3"
    : "flex w-full flex-col gap-3";
  const controlGroupClassName = "flex w-full flex-col gap-1.5";
  const promptTextareaMaxRows = isPortraitLayout ? 5 : 4;

  const {
    hasImageItem,
    availableModels,
    availableModelKeys,
    availableModelKeysSignature,
  } = getVideoGenerationModelDropdownData({
    activeItemList,
    currentLayer,
    sessionDetails,
  });

  const modelOptions = availableModels.map((model) => (
    <option key={model.key} value={model.key}>
      {model.name}
    </option>
  ));

  const {
    modelDef: selectedModelDef,
    pricing: selectedModelPricing,
    supportsImageToVideo: isImageToVideoModel,
    supportsTextToVideo: isTextToVideoModel,
    supportsFirstLastFrameToVideo: isFirstLastFrameToVideoModel,
  } = getVideoGenerationModelMeta(selectedVideoGenerationModel);
  const useImgToVidSettings = isImageToVideoModel && hasImageItem;
  const useImgOnlySettings =
    isImageToVideoModel && !isTextToVideoModel && hasImageItem;
  const supportsNativeAudio = NATIVE_AUDIO_VIDEO_MODELS.has(
    selectedVideoGenerationModel
  );
  const selectedModelDurationUnits = useMemo(() => (
    selectedModelPricing?.units?.length > 0
      ? getVideoModelDurationUnitsForFramesPerSecond(
        selectedVideoGenerationModel,
        sessionDetails?.framesPerSecond,
      )
      : null
  ), [selectedModelPricing, selectedVideoGenerationModel, sessionDetails?.framesPerSecond]);

  const [useStartFrame, setUseStartFrame] = useState(() => {
    const stored = localStorage.getItem("defaultVideoStartFrame");
    return stored === null ? true : stored === "true";
  });
  const [useEndFrame, setUseEndFrame] = useState(() => {
    const stored = localStorage.getItem("defaultVideoEndFrame");
    return stored === null ? true : stored === "true";
  });
  const [combineLayers, setCombineLayers] = useState(() => {
    const stored = localStorage.getItem("combineLayers");
    return stored === "true";
  });
  const [clipLayerToAiVideo, setClipLayerToAiVideo] = useState(() => {
    const stored = localStorage.getItem("clipLayerToAiVideo");
    return stored === "true";
  });
  const [optimizePrompt, setOptimizePrompt] = useState(false);
  const [selectedDuration, setSelectedDuration] = useState(null);
  const [selectedModelSubType, setSelectedModelSubType] = useState("");
  const [generateAudio, setGenerateAudio] = useState(false);

  useEffect(() => {
    if (availableModelKeys.length === 0) return;

    const storedModel = localStorage.getItem("defaultVideoModel");
    const fallbackModel =
      storedModel && availableModelKeys.includes(storedModel)
        ? storedModel
        : availableModelKeys[0];

    if (
      selectedVideoGenerationModel &&
      availableModelKeys.includes(selectedVideoGenerationModel)
    ) {
      return;
    }

    if (fallbackModel && fallbackModel !== selectedVideoGenerationModel) {
      setSelectedVideoGenerationModel(fallbackModel);
    }
  }, [
    availableModelKeysSignature,
    selectedVideoGenerationModel,
    setSelectedVideoGenerationModel,
    availableModelKeys,
  ]);

  useEffect(() => {
    setGenerateAudio(false);

    if (selectedVideoGenerationModel === "SDVIDEO") {
      setUseEndFrame(false);
    }

    if (
      selectedVideoGenerationModel === "HAILUO" ||
      selectedVideoGenerationModel === "HAIPER2.0"
    ) {
      const storedOptimizePrompt =
        localStorage.getItem("defaultOptimizePrompt");
      setOptimizePrompt(storedOptimizePrompt === "true");
    } else {
      setOptimizePrompt(false);
    }

    if (selectedModelDurationUnits?.length > 0) {
      const storedDuration = localStorage.getItem(
        "defaultDurationFor" + selectedVideoGenerationModel
      );
      const parsedStoredDuration = Number(storedDuration);
      if (
        Number.isFinite(parsedStoredDuration) &&
        selectedModelDurationUnits.includes(parsedStoredDuration)
      ) {
        setSelectedDuration(parsedStoredDuration);
      } else {
        setSelectedDuration(selectedModelDurationUnits[0]);
      }
    } else {
      setSelectedDuration(null);
    }

    if (selectedModelDef?.modelSubTypes?.length > 0) {
      const localStoreSubType = localStorage.getItem(
        "defaultModelSubTypeFor_" + selectedVideoGenerationModel
      );
      if (
        localStoreSubType &&
        selectedModelDef.modelSubTypes.includes(localStoreSubType)
      ) {
        setSelectedModelSubType(localStoreSubType);
      } else {
        setSelectedModelSubType(selectedModelDef.modelSubTypes[0]);
      }
    } else {
      setSelectedModelSubType("");
    }
  }, [selectedVideoGenerationModel, selectedModelPricing, selectedModelDef, selectedModelDurationUnits]);

  const handleModelChange = (event) => {
    const newModel = event.target.value;
    setSelectedVideoGenerationModel(newModel);
    localStorage.setItem("defaultVideoModel", newModel);
  };

  const handleDurationChange = (event) => {
    const duration = Number(event.target.value);
    setSelectedDuration(duration);
    localStorage.setItem(
      "defaultDurationFor" + selectedVideoGenerationModel,
      duration.toString()
    );
  };

  const handleStartFrameChange = (event) => {
    const checked = event.target.checked;
    setUseStartFrame(checked);
    localStorage.setItem("defaultVideoStartFrame", String(checked));
  };

  const handleEndFrameChange = (event) => {
    const checked = event.target.checked;
    setUseEndFrame(checked);
    localStorage.setItem("defaultVideoEndFrame", String(checked));
  };

  const handleClipLayerChange = (event) => {
    const checked = event.target.checked;
    setClipLayerToAiVideo(checked);
    localStorage.setItem("clipLayerToAiVideo", String(checked));
  };

  const handleCombineLayersChange = (event) => {
    const checked = event.target.checked;
    setCombineLayers(checked);
    localStorage.setItem("combineLayers", String(checked));
  };

  const handleOptimizePromptChange = (checked) => {
    setOptimizePrompt(checked);
    localStorage.setItem("defaultOptimizePrompt", String(checked));
  };

  const handleGenerateAudioChange = (event) => {
    setGenerateAudio(event.target.checked);
  };

  const handleModelSubTypeChange = (event) => {
    const subType = event.target.value;
    setSelectedModelSubType(subType);
    localStorage.setItem(
      "defaultModelSubTypeFor_" + selectedVideoGenerationModel,
      subType
    );
  };

  const handleSubmit = () => {
    if (modelOptions.length === 0) return;

    const payload = {
      useStartFrame:
        isFirstLastFrameToVideoModel
          ? true
          : selectedVideoGenerationModel === "SDVIDEO"
          ? true
          : useImgOnlySettings
          ? useStartFrame
          : false,
      useEndFrame:
        isFirstLastFrameToVideoModel
          ? true
          : selectedVideoGenerationModel === "SDVIDEO"
          ? false
          : useImgOnlySettings
          ? useEndFrame
          : false,
      combineLayers: useImgToVidSettings ? combineLayers : false,
      clipLayerToAiVideo: useImgToVidSettings ? clipLayerToAiVideo : false,
    };

    if (
      selectedVideoGenerationModel === "HAILUO" ||
      selectedVideoGenerationModel === "HAIPER2.0"
    ) {
      payload.usePromptOptimizer = optimizePrompt;
    }

    if (selectedDuration !== null) {
      payload.duration = selectedDuration;
    }

    if (supportsNativeAudio) {
      payload.generateAudio = generateAudio === true;
    }

    if (selectedModelDef?.modelSubTypes?.length > 0) {
      payload.modelSubType = selectedModelSubType;
    }

    submitGenerateNewVideoRequest(payload);
  };

  const pricingForSelectedModel = selectedModelPricing
    ? {
      ...selectedModelPricing,
      ...(selectedModelDurationUnits ? { units: selectedModelDurationUnits } : {}),
    }
    : selectedModelPricing;
  const priceObj = getModelPriceForAspect(pricingForSelectedModel, aspectRatio);
  let modelPrice = priceObj ? priceObj.price : 0;

  if (pricingForSelectedModel?.isPerSecondPricing && selectedDuration !== null) {
    modelPrice *= selectedDuration;
  } else if (pricingForSelectedModel?.units && selectedDuration !== null) {
    const unitIndex = pricingForSelectedModel.units.findIndex(
      (unit) => unit.toString() === selectedDuration.toString()
    );
    if (unitIndex >= 0) modelPrice *= unitIndex + 1;
  }

  const errorDisplay = generationError ? (
    <div className="mt-2 shrink-0 text-center text-sm text-red-500">
      {generationError}
    </div>
  ) : null;

  return (
    <div className="flex min-h-0 w-full flex-col gap-3">
      <div className={`shrink-0 ${fieldLayoutClassName}`}>
        <div className={controlGroupClassName}>
          <div className={`${fieldLabelClassName} flex items-center gap-1`}>
            <span>Model</span>
            <a
              data-tooltip-id="videoModelCostTooltip"
              data-tooltip-content={`Currently selected model cost: ${modelPrice} Credits`}
            >
              <FaQuestionCircle className="text-[11px]" />
            </a>
            <Tooltip id="videoModelCostTooltip" place="right" effect="solid" />
          </div>
          <select
            onChange={handleModelChange}
            className={`${selectShell} w-full rounded-md px-2.5 py-2`}
            value={selectedVideoGenerationModel}
            disabled={modelOptions.length === 0}
          >
            {modelOptions}
          </select>
        </div>

        {selectedModelDef?.modelSubTypes?.length > 0 ? (
          <div className={controlGroupClassName}>
            <div className={fieldLabelClassName}>Scene Type</div>
            <select
              value={selectedModelSubType}
              onChange={handleModelSubTypeChange}
              className={`${selectShell} w-full rounded-md px-2.5 py-2`}
            >
              {selectedModelDef.modelSubTypes.map((subType) => (
                <option key={subType} value={subType}>
                  {subType}
                </option>
              ))}
            </select>
          </div>
        ) : null}

        {pricingForSelectedModel?.units ? (
          <div className={controlGroupClassName}>
            <div className={fieldLabelClassName}>Duration</div>
            <select
              onChange={handleDurationChange}
              className={`${selectShell} w-full rounded-md px-2.5 py-2`}
              value={selectedDuration || ""}
            >
              {pricingForSelectedModel.units.map((unit) => (
                <option key={unit} value={unit}>
                  {formatVideoDurationLabel(unit)} s
                </option>
              ))}
            </select>
          </div>
        ) : null}
      </div>

      <div
        className={`flex shrink-0 flex-wrap items-center gap-2.5 text-xs ${
          colorMode === "dark" ? "text-slate-200" : "text-slate-600"
        }`}
      >
        {useImgOnlySettings && !isFirstLastFrameToVideoModel ? (
          <label
            className={`inline-flex items-center gap-2 rounded-full border px-2.5 py-1.5 transition-colors duration-150 cursor-pointer ${
              useStartFrame
                ? colorMode === "dark"
                  ? "bg-indigo-500/20 border-indigo-400/40 text-white"
                  : "bg-indigo-50 border-indigo-200 text-indigo-700"
                : chipShell
            }`}
          >
            <input
              type="checkbox"
              className="hidden"
              checked={useStartFrame}
              onChange={handleStartFrameChange}
            />
            <span>Use start frame</span>
          </label>
        ) : null}

        {useImgOnlySettings && !isFirstLastFrameToVideoModel ? (
          <label
            className={`inline-flex items-center gap-2 rounded-full border px-2.5 py-1.5 transition-colors duration-150 cursor-pointer ${
              useEndFrame
                ? colorMode === "dark"
                  ? "bg-indigo-500/20 border-indigo-400/40 text-white"
                  : "bg-indigo-50 border-indigo-200 text-indigo-700"
                : chipShell
            }`}
          >
            <input
              type="checkbox"
              className="hidden"
              checked={useEndFrame}
              onChange={handleEndFrameChange}
            />
            <span>Use end frame</span>
          </label>
        ) : null}

        {useImgToVidSettings ? (
          <label
            className={`inline-flex items-center gap-2 rounded-full border px-2.5 py-1.5 transition-colors duration-150 cursor-pointer ${
              combineLayers
                ? colorMode === "dark"
                  ? "bg-indigo-500/20 border-indigo-400/40 text-white"
                  : "bg-indigo-50 border-indigo-200 text-indigo-700"
                : chipShell
            }`}
          >
            <input
              type="checkbox"
              className="hidden"
              checked={combineLayers}
              onChange={handleCombineLayersChange}
            />
            <span>Combine layers</span>
          </label>
        ) : null}

        {useImgToVidSettings ? (
          <label
            className={`inline-flex items-center gap-2 rounded-full border px-2.5 py-1.5 transition-colors duration-150 cursor-pointer ${
              clipLayerToAiVideo
                ? colorMode === "dark"
                  ? "bg-indigo-500/20 border-indigo-400/40 text-white"
                  : "bg-indigo-50 border-indigo-200 text-indigo-700"
                : chipShell
            }`}
          >
            <input
              type="checkbox"
              className="hidden"
              checked={clipLayerToAiVideo}
              onChange={handleClipLayerChange}
            />
            <span>Clip to AI video</span>
          </label>
        ) : null}

        {selectedVideoGenerationModel === "HAILUO" ||
        selectedVideoGenerationModel === "HAIPER2.0" ? (
          <label
            className={`inline-flex items-center gap-2 rounded-full border px-2.5 py-1.5 transition-colors duration-150 cursor-pointer ${
              optimizePrompt
                ? colorMode === "dark"
                  ? "bg-indigo-500/20 border-indigo-400/40 text-white"
                  : "bg-indigo-50 border-indigo-200 text-indigo-700"
                : chipShell
            }`}
          >
            <input
              type="checkbox"
              className="hidden"
              checked={optimizePrompt}
              onChange={(event) =>
                handleOptimizePromptChange(event.target.checked)
              }
            />
            <span>Optimize prompt</span>
          </label>
        ) : null}

        {supportsNativeAudio ? (
          <label
            className={`inline-flex items-center gap-2 rounded-full border px-2.5 py-1.5 transition-colors duration-150 cursor-pointer ${
              generateAudio
                ? colorMode === "dark"
                  ? "bg-indigo-500/20 border-indigo-400/40 text-white"
                  : "bg-indigo-50 border-indigo-200 text-indigo-700"
                : chipShell
            }`}
          >
            <input
              type="checkbox"
              className="hidden"
              checked={generateAudio}
              onChange={handleGenerateAudioChange}
            />
            <span>Generate audio</span>
          </label>
        ) : null}
      </div>

      {selectedVideoGenerationModel !== "SDVIDEO" ? (
        <TextareaAutosize
          onChange={(event) => setVideoPromptText(event.target.value)}
          placeholder="Describe the motion, pacing, and cinematic details you want..."
          className={`${textareaShell} min-h-0 w-full resize-none overflow-y-auto rounded-lg px-3 py-2`}
          minRows={isPortraitLayout ? 3 : 2}
          maxRows={promptTextareaMaxRows}
          value={videoPromptText}
        />
      ) : null}

      <div
        className={`flex shrink-0 pt-1 ${
          isPortraitLayout ? "justify-stretch" : "justify-end"
        }`}
      >
        <CommonButton
          onClick={handleSubmit}
          isPending={aiVideoGenerationPending}
          isDisabled={modelOptions.length === 0}
          extraClasses={isPortraitLayout ? "w-full" : "min-w-[140px]"}
        >
          Submit
        </CommonButton>
      </div>

      {errorDisplay}
    </div>
  );
}
