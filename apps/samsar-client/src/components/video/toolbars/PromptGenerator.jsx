import { useMemo, useState, useEffect } from "react";
import CommonButton from "../../common/CommonButton.tsx";
import {
  IMAGE_GENERAITON_MODEL_TYPES,
} from "../../../constants/Types.ts";
import { IMAGE_MODEL_PRICES } from "../../../constants/ModelPrices.jsx";
import { useColorMode } from "../../../contexts/ColorMode.jsx";
import { FaQuestionCircle } from "react-icons/fa";
import "react-tooltip/dist/react-tooltip.css";
import { Tooltip } from "react-tooltip";
import AutoExpandableTextarea from "../../common/AutoExpandableTextarea.jsx";
import ImagePayloadAspectRatioSelector from "../../image/ImagePayloadAspectRatioSelector.jsx";
import { imageAspectRatioOptions } from "../../../constants/ImageAspectRatios.js";
import { useDeploymentModelAvailability } from "../../../hooks/useDeploymentModelAvailability.js";
import { filterOptionsForDeploymentModelValues } from "../../../utils/deploymentProviders.js";

export default function PromptGenerator(props) {
  const {
    promptText,
    setPromptText,
    submitGenerateNewRequest,
    isGenerationPending,
    selectedGenerationModel,
    setSelectedGenerationModel,
    generationError,
    aspectRatio,
    setAspectRatio,
    canvasDimensions,
    showModelSelector = true,
    sizeVariant = "default",
  } = props;

  const { colorMode } = useColorMode();
  const isImageStudio = sizeVariant === "imageStudio";
  const isSidebarCollapsed = sizeVariant === "sidebarCollapsed";
  const isSidebarExpanded = sizeVariant === "sidebarExpanded";
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


  // Whether to retry if generation fails:
  const [retryOnFailure, setRetryOnFailure] = useState(false);
  // Whether it’s a “character speaker” type image:
  const [isCharacterImage, setIsCharacterImage] = useState(false);

  // ------------------------------------------------------------------
  // Track the user-selected image style (if model has an imageStyles array)
  // ------------------------------------------------------------------
  const [selectedImageStyle, setSelectedImageStyle] = useState(null);

  // Whenever the model changes, check if it has `imageStyles`. If so, load from
  // local storage or default to the first style. If not, set to null.
  useEffect(() => {
    if (!selectedGenerationModel) return;

    // Find the model definition from IMAGE_GENERAITON_MODEL_TYPES
    const modelDefinition = availableImageModels.find(
      (m) => m.key === selectedGenerationModel
    );
    if (!modelDefinition) {
      const fallbackModel = availableImageModels[0]?.key;
      if (fallbackModel) {
        setSelectedGenerationModel(fallbackModel);
        localStorage.setItem("defaultImageModel", fallbackModel);
        localStorage.setItem("defaultModel", fallbackModel);
      }
      return;
    }

    if (modelDefinition?.imageStyles?.length) {
      // We’ll store/retrieve the style in localStorage using a key that’s unique to this model:
      const localStorageKey = `defaultImageStyle_${selectedGenerationModel}`;
      const storedStyle = localStorage.getItem(localStorageKey);

      // If we have a stored style that is still valid for this model, use it
      const isValidStoredStyle = modelDefinition.imageStyles.includes(storedStyle);
      if (storedStyle && isValidStoredStyle) {
        setSelectedImageStyle(storedStyle);
      } else {
        // Otherwise, default to the first style in the array
        setSelectedImageStyle(modelDefinition.imageStyles[0]);
      }
    } else {
      // This model doesn’t have imageStyles
      setSelectedImageStyle(null);
    }
  }, [availableImageModels, selectedGenerationModel, setSelectedGenerationModel]);

  // ------------------------------------------------------------------
  // UI style helpers
  // ------------------------------------------------------------------
  const selectShell =
    colorMode === "dark"
      ? "bg-slate-900/60 text-slate-100 border border-white/10"
      : "bg-white text-slate-900 border border-slate-200 shadow-sm";
  const textareaShell =
    colorMode === "dark"
      ? "bg-slate-900/60 text-slate-100 border border-white/10"
      : "bg-white text-slate-900 border border-slate-200 shadow-sm";
  const fieldRowClass = isImageStudio
    ? "flex w-full items-center gap-4 py-1"
    : isSidebarExpanded
    ? "mt-2 mb-3 grid w-full grid-cols-[112px_minmax(0,1fr)] items-center gap-3"
    : isSidebarCollapsed
    ? "mt-2 mb-3 flex w-full flex-col gap-1.5"
    : "flex w-full mt-2 mb-2";
  const fieldLabelWrapClass = isImageStudio
    ? "inline-flex min-w-[88px] items-center"
    : isSidebarExpanded || isSidebarCollapsed
    ? "inline-flex w-full items-center"
    : "inline-flex w-[25%] items-center";
  const fieldLabelClass = isImageStudio
    ? "text-sm font-semibold flex items-center"
    : isSidebarExpanded || isSidebarCollapsed
    ? "text-xs font-bold flex w-full items-center"
    : "text-xs font-bold flex items-center";
  const selectClass = isImageStudio
    ? `${selectShell} inline-flex min-h-[44px] flex-1 rounded-xl px-4 py-2.5 text-sm bg-transparent`
    : isSidebarExpanded
    ? `${selectShell} inline-flex min-h-[44px] w-full rounded-xl px-4 py-2.5 text-sm bg-transparent`
    : isSidebarCollapsed
    ? `${selectShell} inline-flex min-h-[44px] w-full rounded-xl px-3 py-2.5 text-sm bg-transparent`
    : `${selectShell} inline-flex w-[75%] rounded-md px-3 py-2 bg-transparent`;
  const optionLabelClass = isImageStudio ? "ml-1 text-sm font-semibold" : "ml-1 text-xs font-semibold";
  const buttonContainerClass = isImageStudio
    ? "pt-3 text-center"
    : isSidebarExpanded
    ? "pt-4 flex justify-end"
    : isSidebarCollapsed
    ? "pt-3"
    : "text-center";
  const buttonExtraClass = isImageStudio
    ? "min-h-[46px] min-w-[160px] text-sm"
    : isSidebarExpanded
    ? "min-w-[168px] text-sm"
    : isSidebarCollapsed
    ? "w-full whitespace-normal text-center leading-tight"
    : "";

  // ------------------------------------------------------------------
  // Find the cost of the current model + aspect ratio, if any
  // ------------------------------------------------------------------
  const pricingInfo = IMAGE_MODEL_PRICES.find(
    (m) => m.key === selectedGenerationModel
  );
  const priceObj = pricingInfo
    ? pricingInfo.prices.find((price) => price.aspectRatio === aspectRatio)
    : null;
  const modelPrice = priceObj ? priceObj.price : 0;

  // ------------------------------------------------------------------
  // Handle user selecting a new model from the dropdown
  // ------------------------------------------------------------------
  const handleModelChange = (evt) => {
    const newModel = evt.target.value;
    setSelectedGenerationModel(newModel);
    localStorage.setItem("defaultImageModel", newModel);
  };

  // ------------------------------------------------------------------
  // Handle user changing the image style (when model has imageStyles)
  // ------------------------------------------------------------------
  const handleImageStyleChange = (evt) => {
    const newStyle = evt.target.value;
    setSelectedImageStyle(newStyle);

    // Save in localStorage so next time user picks this model, we recall it
    const localStorageKey = `defaultImageStyle_${selectedGenerationModel}`;
    localStorage.setItem(localStorageKey, newStyle);
  };

  // ------------------------------------------------------------------
  // On “Submit” click, build the payload and call `submitGenerateNewRequest`
  // ------------------------------------------------------------------
  const handleSubmit = () => {
    if (!availableImageModels.some((model) => model.key === selectedGenerationModel)) return;

    const payload = {
      prompt: promptText,
      model: selectedGenerationModel,
      retryOnFailure,
      isCharacterImage,
      aspectRatio,
    };
    // If the selected model has an imageStyles array, include imageStyle
    const modelDefinition = availableImageModels.find(
      (m) => m.key === selectedGenerationModel
    );
    if (modelDefinition?.imageStyles?.length && selectedImageStyle) {
      payload.imageStyle = selectedImageStyle;
    }

    submitGenerateNewRequest(payload);
  };

  // Show any generation error
  const errorDisplay = generationError && (
    <div className="text-red-500 text-center text-sm">{generationError}</div>
  );

  return (
    <div>
      {/* ------------------ Model Selection ------------------ */}
      {showModelSelector && (
        <div className={fieldRowClass}>
          <div className={fieldLabelWrapClass}>
            <div className={fieldLabelClass}>
              Model
              <a
                data-tooltip-id="modelCostTooltip"
                data-tooltip-content={`Currently selected model cost: ${modelPrice} credits`}
              >
                <FaQuestionCircle className="ml-1 mr-1" />
              </a>
              {/* Tooltip for cost */}
              <Tooltip id="modelCostTooltip" place="right" effect="solid" />
            </div>
          </div>
          <select
            onChange={handleModelChange}
            className={selectClass}
            value={selectedGenerationModel}
          >
            {availableImageModels.map((model) => (
              <option key={model.key} value={model.key}>
                {model.name}
              </option>
            ))}
          </select>
        </div>
      )}

      {/* ------------------ Image Style Dropdown ------------------ */}
      {showModelSelector &&
        (() => {
          // Check if currently selected model has imageStyles
          const modelDef = availableImageModels.find(
            (m) => m.key === selectedGenerationModel
          );
          if (modelDef?.imageStyles?.length) {
            return (
              <div className={fieldRowClass}>
                <div className={fieldLabelWrapClass}>
                  <div className={isImageStudio ? "text-sm font-semibold" : "text-xs font-bold"}>Image Style</div>
                </div>
                <select
                  onChange={handleImageStyleChange}
                  value={selectedImageStyle || ""}
                  className={selectClass}
                >
                  {modelDef.imageStyles.map((style) => (
                    <option key={style} value={style}>
                      {style}
                    </option>
                  ))}
                </select>
              </div>
            );
          }
          return null;
        })()}

      {/* ------------------ Retry on Failure & Character Image ------------------ */}
      <div className="mb-3">
        <ImagePayloadAspectRatioSelector
          label="Generation ratio"
          value={aspectRatio}
          onChange={setAspectRatio}
          options={imageAspectRatioOptions}
          canvasDimensions={canvasDimensions}
          sizeVariant={sizeVariant}
        />
      </div>

      <div className="w-full mb-2">
        <div className={`flex items-center flex-wrap gap-x-4 gap-y-2 ${isImageStudio ? "text-sm font-medium" : "text-xs font-semibold"}`}>
          <label className="flex items-center">
            <input
              type="checkbox"
              className={`${isImageStudio ? "h-[18px] w-[18px]" : "h-4 w-4"} form-checkbox text-blue-600`}
              checked={retryOnFailure}
              onChange={(e) => setRetryOnFailure(e.target.checked)}
            />
            <span className={optionLabelClass}>
              Fail Retry
              <a
                data-tooltip-id="retryOnFailTooltip"
                data-tooltip-content="Retry generation if it fails"
              >
                <FaQuestionCircle className="ml-1 inline-flex" />
              </a>
              <Tooltip id="retryOnFailTooltip" place="right" effect="solid">
                Retry generation if it fails
              </Tooltip>
            </span>
          </label>

          <label className="flex items-center">
            <input
              type="checkbox"
              className={`${isImageStudio ? "h-[18px] w-[18px]" : "h-4 w-4"} form-checkbox text-blue-600`}
              checked={isCharacterImage}
              onChange={(e) => setIsCharacterImage(e.target.checked)}
            />
            <span className={optionLabelClass}>
              Speaker
              <a
                data-tooltip-id="characterImageTooltip"
                data-tooltip-content="Generate an image of a character speaking the prompt"
              >
                <FaQuestionCircle className="ml-1 inline-flex" />
              </a>
              <Tooltip id="characterImageTooltip" place="right" effect="solid">
                Generate an image of a character speaking the prompt
              </Tooltip>
            </span>
          </label>
        </div>
      </div>

      {/* ------------------ Prompt Textarea ------------------ */}
      <AutoExpandableTextarea
        onChange={(evt) => setPromptText(evt.target.value)}
        placeholder="Add prompt text here"
        className={`${textareaShell} w-full m-auto rounded-2xl bg-transparent ${isImageStudio ? "px-4 py-3.5 text-sm" : "px-3 py-3"}`}
        minRows={isImageStudio ? 5 : 4}
        maxRows={10}
        value={promptText}
      />

      {/* ------------------ Submit Button ------------------ */}
      <div className={buttonContainerClass}>
          <CommonButton onClick={handleSubmit} isPending={isGenerationPending} extraClasses={buttonExtraClass}>
            Submit
          </CommonButton>
      </div>

      {errorDisplay}
    </div>
  );
}
