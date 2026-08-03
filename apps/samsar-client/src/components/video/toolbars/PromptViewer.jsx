import { useEffect, useMemo, useState } from 'react';
import SecondaryButton from '../../common/SecondaryButton.tsx';
import TextareaAutosize from 'react-textarea-autosize';
import { IMAGE_MODEL_PRICES } from '../../../constants/ModelPrices.jsx';
import {
  IMAGE_GENERAITON_MODEL_TYPES,
  imageGenerationModelSupportsAspectRatio,
} from "../../../constants/Types.ts";
import { useColorMode } from '../../../contexts/ColorMode.jsx';
import ModelAdapterSelect from '../../common/ModelAdapterSelect.jsx';
import { useDeploymentModelAvailability } from '../../../hooks/useDeploymentModelAvailability.js';
import { filterOptionsForDeploymentModelValues } from '../../../utils/deploymentProviders.js';
import { useUser } from '../../../contexts/UserContext.jsx';
import { mergeCustomTextToImageModelDefinitions } from '../../../utils/customTextToImageAdapters.mjs';

export default function PromptViewer(props) {
  const {
    currentDefaultPrompt,
    submitGenerateRecreateRequest,
    showCreateNewPrompt,
    isGenerationPending,
    aspectRatio,
  } = props;

  // Track whether to retry on failure
  const [retryOnFailure, setRetryOnFailure] = useState(false);
  // Prompt text
  const [promptText, setPromptText] = useState(currentDefaultPrompt);
  // Selected model
  const [selectedModel, setSelectedModel] = useState(IMAGE_GENERAITON_MODEL_TYPES[0].key);
  // Selected image style, if the model supports it
  const [selectedImageStyle, setSelectedImageStyle] = useState(null);
  const { colorMode } = useColorMode();
  const { user } = useUser();
  const {
    isStandaloneDeployment: isStandaloneModelFilteringEnabled,
    imageModelValues,
    primaryAdapterByModel,
  } = useDeploymentModelAvailability();
  const availableImageModels = useMemo(
    () => {
      const deploymentModels = isStandaloneModelFilteringEnabled
        ? filterOptionsForDeploymentModelValues(IMAGE_GENERAITON_MODEL_TYPES, imageModelValues, (model) => model.key)
        : IMAGE_GENERAITON_MODEL_TYPES;
      const modelsWithCustomAdapters = isStandaloneModelFilteringEnabled
        ? mergeCustomTextToImageModelDefinitions(deploymentModels, user?.custom_adapters)
        : deploymentModels;
      return modelsWithCustomAdapters.filter((model) =>
        imageGenerationModelSupportsAspectRatio(model, aspectRatio)
      );
    },
    [aspectRatio, imageModelValues, isStandaloneModelFilteringEnabled, user?.custom_adapters]
  );

  // ─────────────────────────────────────────────────────────
  //  On mount, try to load default model from localStorage
  // ─────────────────────────────────────────────────────────
  useEffect(() => {
    const storageModel = localStorage.getItem('defaultImageModel');
    if (storageModel && availableImageModels.some((model) => model.key === storageModel)) {
      setSelectedModel(storageModel);
      return;
    }
    if (!availableImageModels.some((model) => model.key === selectedModel) && availableImageModels[0]?.key) {
      setSelectedModel(availableImageModels[0].key);
    }
  }, [availableImageModels, selectedModel]);

  // ─────────────────────────────────────────────────────────
  //  Whenever the selected model changes, see if it has imageStyles.
  //  If it does, load from localStorage or default to the first style.
  // ─────────────────────────────────────────────────────────
  useEffect(() => {
    const modelDef = availableImageModels.find((m) => m.key === selectedModel);
    if (!modelDef) {
      const fallbackModel = availableImageModels[0]?.key;
      if (fallbackModel) {
        setSelectedModel(fallbackModel);
        localStorage.setItem('defaultImageModel', fallbackModel);
      }
      return;
    }
    if (modelDef?.imageStyles?.length) {
      const localKey = `defaultImageStyle_${selectedModel}`;
      const storedStyle = localStorage.getItem(localKey);

      // If we have a stored style that still exists in this model's array, use it
      const isValidStoredStyle = modelDef.imageStyles.includes(storedStyle);
      if (storedStyle && isValidStoredStyle) {
        setSelectedImageStyle(storedStyle);
      } else {
        // Otherwise, default to the first style in the array
        setSelectedImageStyle(modelDef.imageStyles[0]);
      }
    } else {
      // This model doesn't have an imageStyles array
      setSelectedImageStyle(null);
    }
  }, [availableImageModels, selectedModel]);

  // ─────────────────────────────────────────────────────────
  //  Handle changes
  // ─────────────────────────────────────────────────────────
  const handleInputChange = (e) => {
    setPromptText(e.target.value);
  };

  const handleModelChange = (newModel) => {
    setSelectedModel(newModel);
    localStorage.setItem('defaultImageModel', newModel);
  };

  const handleImageStyleChange = (e) => {
    const newStyle = e.target.value;
    setSelectedImageStyle(newStyle);
    const localKey = `defaultImageStyle_${selectedModel}`;
    localStorage.setItem(localKey, newStyle);
  };

  // ─────────────────────────────────────────────────────────
  //  Submitting (Regenerate)
  // ─────────────────────────────────────────────────────────
  const handleSubmit = () => {
    if (!availableImageModels.some((model) => model.key === selectedModel)) return;

    const payload = {
      prompt: promptText,
      model: selectedModel,
      // If you also want to send retryOnFailure:
      retryOnFailure,
    };

    // If model supports imageStyles, attach the user’s chosen style
    const modelDef = availableImageModels.find((m) => m.key === selectedModel);
    if (modelDef?.imageStyles?.length && selectedImageStyle) {
      payload.imageStyle = selectedImageStyle;
    }

    submitGenerateRecreateRequest(payload);
  };

  // ─────────────────────────────────────────────────────────
  //  Pricing
  // ─────────────────────────────────────────────────────────
  const modelPricing = IMAGE_MODEL_PRICES.find((m) => m.key === selectedModel);
  const priceObj = modelPricing
    ? modelPricing.prices.find((price) => price.aspectRatio === aspectRatio)
    : null;
  const modelPrice = priceObj ? priceObj.price : 0;
  const panelClassName = colorMode === 'dark'
    ? 'bg-neutral-800 text-slate-100'
    : 'bg-white/90 text-slate-900 border border-slate-200';
  const helperTextClassName = colorMode === 'dark' ? 'text-gray-300' : 'text-slate-600';
  const creditTextClassName = colorMode === 'dark' ? 'text-[#ffe0a3]' : 'text-blue-700';
  const fieldClassName = colorMode === 'dark'
    ? 'border-[#667188] bg-[#151720] text-[#fafafa] focus:border-[#f6c453] focus:outline-none focus:ring-2 focus:ring-[#f6c453]/20'
    : 'border-slate-200 bg-white text-slate-900 placeholder:text-slate-400';

  return (
    <div className={`flex flex-col items-center space-y-2 p-2 rounded-lg ${panelClassName}`}>
      {/* ───────────── Display Cost & Retry Option ───────────── */}
      <div className="w-full">
        <div className={`text-xs font-semibold ${helperTextClassName}`}>
          Incurs <span className={creditTextClassName}>{modelPrice} Credits</span>
          <label className="ml-2 items-center">
            <input
              type="checkbox"
              className={`form-checkbox h-4 w-4 ${colorMode === 'dark' ? 'text-[#f6c453] focus:ring-[#f6c453]/35' : 'text-blue-600'}`}
              checked={retryOnFailure}
              onChange={(e) => setRetryOnFailure(e.target.checked)}
            />
            <span className="ml-1 text-xs font-semibold">Retry on fail</span>
          </label>
        </div>
      </div>

      {/* ───────────── Model Selection ───────────── */}
      <div className="flex w-full mt-2 mb-2">
        <div className="inline-flex w-[25%]">
          <div className="text-xs font-bold">Model</div>
        </div>
        <ModelAdapterSelect
          options={availableImageModels}
          value={selectedModel}
          onChange={handleModelChange}
          primaryAdapterByModel={primaryAdapterByModel}
          isStandaloneDeployment={isStandaloneModelFilteringEnabled}
          valueMode="value"
          hostedControl="native"
          nativeClassName={`w-[75%] p-2 border rounded ${fieldClassName}`}
          styles={{
            container: (provided) => ({ ...provided, width: "75%" }),
          }}
        />
      </div>

      {/* ───────────── Image Style Dropdown (if model has imageStyles) ───────────── */}
      {(() => {
        const modelDef = availableImageModels.find((m) => m.key === selectedModel);
        if (modelDef?.imageStyles?.length) {
          return (
            <div className="flex w-full mt-2 mb-2">
              <div className="inline-flex w-[25%]">
                <div className="text-xs font-bold">Image Style</div>
              </div>
              <select
                onChange={handleImageStyleChange}
                value={selectedImageStyle || ''}
                className={`w-[75%] p-2 border rounded ${fieldClassName}`}
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

      {/* ───────────── Prompt Textarea ───────────── */}
      <TextareaAutosize
        className={`text-left max-h-64 overflow-y-auto w-full px-2 py-2 border rounded ${fieldClassName}`}
        value={promptText}
        onChange={handleInputChange}
        minRows={3}
        maxRows={10}
        style={{ resize: 'none' }}
      />

      {/* ───────────── Action Buttons ───────────── */}
      <div className="flex space-x-4">
        <SecondaryButton
          className="px-4 py-2"
          onClick={handleSubmit}
          isPending={isGenerationPending}
        >
          Regenerate
        </SecondaryButton>

        <SecondaryButton
          className="px-4 py-2"
          onClick={showCreateNewPrompt}
          isPending={isGenerationPending}
        >
          New
        </SecondaryButton>
      </div>
    </div>
  );
}
