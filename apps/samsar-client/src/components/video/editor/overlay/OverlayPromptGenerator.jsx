import { useEffect, useMemo, useState } from "react";
import CommonButton from "../../../common/CommonButton.tsx";
import { IMAGE_GENERAITON_MODEL_TYPES } from "../../../../constants/Types.ts";
import { useColorMode } from "../../../../contexts/ColorMode.jsx";
import { IMAGE_MODEL_PRICES } from "../../../../constants/ModelPrices.jsx";
import TextareaAutosize from "react-textarea-autosize";
import ImagePayloadAspectRatioSelector from "../../../image/ImagePayloadAspectRatioSelector.jsx";
import { imageAspectRatioOptions } from "../../../../constants/ImageAspectRatios.js";
import { useDeploymentModelAvailability } from "../../../../hooks/useDeploymentModelAvailability.js";
import { filterOptionsForDeploymentModelValues } from "../../../../utils/deploymentProviders.js";

import { FaCheck, FaQuestionCircle } from "react-icons/fa";
import { Tooltip } from "react-tooltip";
import "react-tooltip/dist/react-tooltip.css";

export default function OverlayPromptGenerator(props) {
  const {
    promptText,
    setPromptText,
    isGenerationPending,
    selectedGenerationModel,
    setSelectedGenerationModel,
    generationError,
    submitGenerateNewRequest,
    aspectRatio,
    setAspectRatio,
    canvasDimensions,
    layoutMode = "square",
    showAspectRatioSelector = false,
    editorVariant = "videoStudio",
  } = props;

  const { colorMode } = useColorMode();
  const [retryOnFailure, setRetryOnFailure] = useState(false);
  const [isCharacterImage, setIsCharacterImage] = useState(false);
  const [selectedImageStyle, setSelectedImageStyle] = useState(null);
  const {
    isDockerInstall: isDockerModelFilteringEnabled,
    imageModelValues,
  } = useDeploymentModelAvailability();
  const availableImageModels = useMemo(
    () => (
      isDockerModelFilteringEnabled
        ? filterOptionsForDeploymentModelValues(IMAGE_GENERAITON_MODEL_TYPES, imageModelValues, (model) => model.key)
        : IMAGE_GENERAITON_MODEL_TYPES
    ),
    [imageModelValues, isDockerModelFilteringEnabled]
  );

  const isPortraitLayout = layoutMode === "portrait";
  const isImageStudioPrompt = editorVariant === "imageStudio";
  const selectShell =
    colorMode === "dark"
      ? "bg-slate-950 text-slate-100 border border-slate-700"
      : "bg-slate-50 text-slate-900 border border-slate-200 shadow-sm";
  const textareaShell =
    colorMode === "dark"
      ? "bg-slate-950 text-slate-100 border border-slate-700"
      : "bg-slate-50 text-slate-900 border border-slate-200 shadow-sm";
  const checkboxText =
    colorMode === "dark" ? "text-slate-200" : "text-slate-600";
  const fieldLabelClassName =
    colorMode === "dark"
      ? "text-xs font-semibold text-slate-200"
      : "text-xs font-semibold text-slate-700";
  const controlGroupClassName = isImageStudioPrompt
    ? "flex w-full min-w-0 items-center gap-4"
    : "flex w-full min-w-0 items-center gap-3";
  const topControlRowClassName = isPortraitLayout
    ? "flex w-full flex-col gap-3"
    : isImageStudioPrompt
    ? "flex w-full flex-wrap items-center gap-4"
    : "flex w-full flex-wrap items-center gap-3";
  const selectControlGroupClassName = isPortraitLayout
    ? controlGroupClassName
    : isImageStudioPrompt
    ? "flex min-w-[240px] flex-1 items-center gap-4"
    : "flex min-w-[220px] flex-1 items-center gap-3";
  const optionRowClassName = isPortraitLayout
    ? isImageStudioPrompt
      ? "flex flex-wrap items-center gap-3"
      : "flex flex-wrap items-center gap-2"
    : isImageStudioPrompt
    ? "flex flex-wrap items-center gap-3"
    : "ml-auto flex flex-wrap items-center gap-2";
  const optionChipBase =
    colorMode === "dark"
      ? "bg-slate-950 border border-slate-700 text-slate-300 hover:bg-slate-900"
      : "bg-slate-50 border border-slate-200 text-slate-600 hover:bg-white";
  const optionChipActive =
    colorMode === "dark"
      ? "bg-slate-900 border border-slate-500 text-white"
      : "bg-slate-100 border border-slate-300 text-slate-900";
  const optionIndicatorBase =
    colorMode === "dark"
      ? "border-slate-600 bg-slate-950 text-slate-200"
      : "border-slate-300 bg-white text-slate-700";
  const optionIndicatorActive =
    colorMode === "dark"
      ? "border-slate-400 bg-slate-100 text-slate-900"
      : "border-slate-400 bg-slate-900 text-white";
  const inputPaddingClass = isImageStudioPrompt ? "rounded-xl px-4 py-3 text-sm" : "rounded-md px-2.5 py-2";
  const labelClassName = isImageStudioPrompt
    ? colorMode === "dark"
      ? "text-sm font-semibold text-slate-100"
      : "text-sm font-semibold text-slate-800"
    : fieldLabelClassName;
  const checkboxChipClassName = isImageStudioPrompt
    ? "inline-flex cursor-pointer items-center gap-2 rounded-full px-3 py-2 text-xs font-medium transition-colors duration-150"
    : "inline-flex cursor-pointer items-center gap-2 rounded-full px-2.5 py-1.5 text-[11px] font-medium transition-colors duration-150";
  const promptTextareaMaxRows = isImageStudioPrompt
    ? 7
    : isPortraitLayout
    ? 5
    : 4;

  useEffect(() => {
    const storedDefaultModel = localStorage.getItem("defaultModel");
    if (
      storedDefaultModel &&
      availableImageModels.some((model) => model.key === storedDefaultModel)
    ) {
      setSelectedGenerationModel(storedDefaultModel);
      return;
    }
    if (
      selectedGenerationModel &&
      !availableImageModels.some((model) => model.key === selectedGenerationModel) &&
      availableImageModels[0]?.key
    ) {
      setSelectedGenerationModel(availableImageModels[0].key);
    }
  }, [availableImageModels, selectedGenerationModel, setSelectedGenerationModel]);

  useEffect(() => {
    if (!selectedGenerationModel) return;

    const modelDef = availableImageModels.find(
      (model) => model.key === selectedGenerationModel
    );
    if (!modelDef) {
      const fallbackModel = availableImageModels[0]?.key;
      if (fallbackModel) {
        setSelectedGenerationModel(fallbackModel);
        localStorage.setItem("defaultModel", fallbackModel);
        localStorage.setItem("defaultImageModel", fallbackModel);
      }
      return;
    }
    if (modelDef?.imageStyles?.length) {
      const localKey = `defaultImageStyle_${selectedGenerationModel}`;
      const storedStyle = localStorage.getItem(localKey);
      const isValidStyle = modelDef.imageStyles.includes(storedStyle);

      if (storedStyle && isValidStyle) {
        setSelectedImageStyle(storedStyle);
      } else {
        setSelectedImageStyle(modelDef.imageStyles[0]);
      }
    } else {
      setSelectedImageStyle(null);
    }
  }, [availableImageModels, selectedGenerationModel, setSelectedGenerationModel]);

  const modelPricing = IMAGE_MODEL_PRICES.find(
    (model) => model.key === selectedGenerationModel
  );
  const priceObj = modelPricing
    ? modelPricing.prices.find((price) => price.aspectRatio === aspectRatio)
    : null;
  const modelPrice = priceObj ? priceObj.price : 0;
  const selectedModelDefinition = availableImageModels.find(
    (model) => model.key === selectedGenerationModel
  );

  const setSelectedModelDisplay = (evt) => {
    const newModel = evt.target.value;
    setSelectedGenerationModel(newModel);
    localStorage.setItem("defaultModel", newModel);
  };

  const handleImageStyleChange = (event) => {
    const newStyle = event.target.value;
    setSelectedImageStyle(newStyle);
    const localKey = `defaultImageStyle_${selectedGenerationModel}`;
    localStorage.setItem(localKey, newStyle);
  };

  const handleSubmit = () => {
    if (!availableImageModels.some((model) => model.key === selectedGenerationModel)) return;

    const payload = {
      prompt: promptText,
      model: selectedGenerationModel,
      retryOnFailure,
      isCharacterImage,
      aspectRatio,
    };

    if (selectedModelDefinition?.imageStyles?.length && selectedImageStyle) {
      payload.imageStyle = selectedImageStyle;
    }

    submitGenerateNewRequest(payload);
  };

  const errorDisplay = generationError ? (
    <div className="shrink-0 text-center text-sm text-red-500">{generationError}</div>
  ) : null;

  return (
    <div className="flex min-h-0 w-full flex-col gap-3">
      <div className={`shrink-0 ${topControlRowClassName}`}>
        <div className={selectControlGroupClassName}>
          <div
            className={`${labelClassName} flex shrink-0 items-center gap-1 whitespace-nowrap`}
          >
            <span>Model</span>
            <a
              data-tooltip-id="modelCostTooltip"
              data-tooltip-content={`Currently selected model cost: ${modelPrice} Credits`}
            >
              <FaQuestionCircle className="text-[11px]" />
            </a>
            <Tooltip id="modelCostTooltip" place="right" effect="solid" />
          </div>
          <select
            onChange={setSelectedModelDisplay}
            className={`${selectShell} min-w-0 flex-1 ${inputPaddingClass}`}
            value={selectedGenerationModel}
          >
            {availableImageModels.map((model) => (
              <option key={model.key} value={model.key}>
                {model.name}
              </option>
            ))}
          </select>
        </div>

        {selectedModelDefinition?.imageStyles?.length ? (
          <div className={selectControlGroupClassName}>
            <div className={`${labelClassName} shrink-0 whitespace-nowrap`}>
              Style
            </div>
            <select
              onChange={handleImageStyleChange}
              value={selectedImageStyle || ""}
              className={`${selectShell} min-w-0 flex-1 ${inputPaddingClass}`}
            >
              {selectedModelDefinition.imageStyles.map((style) => (
                <option key={style} value={style}>
                  {style}
                </option>
              ))}
            </select>
          </div>
        ) : null}

        <div className={`${optionRowClassName} ${checkboxText}`}>
          <label
            className={`${checkboxChipClassName} ${
              retryOnFailure ? optionChipActive : optionChipBase
            }`}
          >
            <input
              type="checkbox"
              className="sr-only"
              checked={retryOnFailure}
              onChange={(event) => setRetryOnFailure(event.target.checked)}
            />
            <span
              className={`flex h-4 w-4 items-center justify-center rounded-[4px] border text-[9px] ${
                retryOnFailure ? optionIndicatorActive : optionIndicatorBase
              }`}
            >
              {retryOnFailure ? <FaCheck /> : null}
            </span>
            <span className="flex items-center gap-1">
              Retry
              <a
                data-tooltip-id="retryOnFailTooltip"
                data-tooltip-content="Retry generation if it fails up to 3 times with prompt variants"
              >
                <FaQuestionCircle className="text-[10px] opacity-70" />
              </a>
              <Tooltip id="retryOnFailTooltip" place="right" effect="solid" />
            </span>
          </label>

          <label
            className={`${checkboxChipClassName} ${
              isCharacterImage ? optionChipActive : optionChipBase
            }`}
          >
            <input
              type="checkbox"
              className="sr-only"
              checked={isCharacterImage}
              onChange={(event) => setIsCharacterImage(event.target.checked)}
            />
            <span
              className={`flex h-4 w-4 items-center justify-center rounded-[4px] border text-[9px] ${
                isCharacterImage ? optionIndicatorActive : optionIndicatorBase
              }`}
            >
              {isCharacterImage ? <FaCheck /> : null}
            </span>
            <span className="flex items-center gap-1">
              Speaker scene
              <a
                data-tooltip-id="characterImageTooltip"
                data-tooltip-content="Generate an image from the POV of the main character in the prompt."
              >
                <FaQuestionCircle className="text-[10px] opacity-70" />
              </a>
              <Tooltip id="characterImageTooltip" place="right" effect="solid" />
            </span>
          </label>
        </div>
      </div>

      {showAspectRatioSelector ? (
        <div className="w-full shrink-0">
          <ImagePayloadAspectRatioSelector
            label="Generation ratio"
            value={aspectRatio}
            onChange={setAspectRatio}
            options={imageAspectRatioOptions}
            canvasDimensions={canvasDimensions}
            compactInline
          />
        </div>
      ) : null}

      <TextareaAutosize
        onChange={(event) => setPromptText(event.target.value)}
        placeholder="Describe your prompt to generate an image"
        className={`${textareaShell} min-h-0 w-full resize-none overflow-y-auto ${isImageStudioPrompt ? "rounded-2xl px-4 py-3.5 text-sm leading-6" : "rounded-lg px-3 py-2"}`}
        minRows={isImageStudioPrompt ? 4 : isPortraitLayout ? 3 : 2}
        maxRows={promptTextareaMaxRows}
        value={promptText}
      />

      <div
        className={`flex shrink-0 pt-1 ${
          isPortraitLayout ? "justify-stretch" : "justify-end"
        }`}
      >
        <CommonButton
          onClick={handleSubmit}
          isPending={isGenerationPending}
          extraClasses={
            isImageStudioPrompt
              ? "min-h-[46px] min-w-[160px] text-sm"
              : isPortraitLayout
              ? "w-full"
              : "min-w-[140px]"
          }
        >
          Submit
        </CommonButton>
      </div>

      {errorDisplay}
    </div>
  );
}
