import { useUiLanguage } from '../../hooks/useUiLanguage.js';
import { translateText as uiText } from '../../utils/localization.js';
import ModelAdapterSelect from './ModelAdapterSelect.jsx';
import InferenceEffortSelect from './InferenceEffortSelect.jsx';
import { INFERENCE_MODEL_TYPES } from '../../constants/Types.ts';
import { getInferenceModelFamily } from '../../utils/inferenceModelChoices.mjs';

// Keep provider availability and adapter badges in the existing selector.
export default function InferenceModelSelect({ options = [], value, onChange, groupByFamily = true, ...props }) {
  useUiLanguage();
  const selectedFamily = getInferenceModelFamily(value?.value);
  const families = [];
  for (const option of options) {
    const family = getInferenceModelFamily(option.value);
    if (!families.some((item) => item.value === family)) {
      families.push({ value: family, label: ['GPT', 'Claude'].includes(family) ? family : option.label });
    }
  }
  const variants = groupByFamily
    ? options.filter((option) => getInferenceModelFamily(option.value) === selectedFamily)
    : options;
  const hasVariants = ['GPT', 'Claude'].includes(selectedFamily);
  const hasEmbeddedEffort = variants.some((option) => option.value.endsWith('-xhigh'));
  const effort = value?.value?.endsWith('-xhigh') ? 'xhigh' : 'high';
  const baseValue = value?.value?.replace(/-xhigh$/, '');
  const modelVariants = hasEmbeddedEffort
    ? variants.filter((option) => !option.value.endsWith('-xhigh'))
      .map((option) => ({
        ...option,
        label: INFERENCE_MODEL_TYPES.find((model) => model.value === option.value)?.label || option.label,
      }))
    : variants;
  const selectVariant = (model, nextEffort = effort) => {
    const key = model + (hasEmbeddedEffort && nextEffort === 'xhigh' ? '-xhigh' : '');
    onChange(options.find((option) => option.value === key) ||
      options.find((option) => option.value === model) || null);
  };
  if (!groupByFamily) {
    const hasEffortChoice = options.some((option) => option.value === `${baseValue}-xhigh`);
    return (
      <div className="flex min-w-0 flex-wrap gap-2">
        <div className="min-w-0 flex-[1_1_12rem]">
          <ModelAdapterSelect
            {...props}
            aria-label={uiText("Assistant model")}
            options={modelVariants}
            value={modelVariants.find((option) => option.value === baseValue) || null}
            onChange={(option) => selectVariant(option?.value)}
          />
        </div>
        {hasEffortChoice && (
          <div className="w-[5.5rem] shrink-0">
            <InferenceEffortSelect
              aria-label={uiText("Reasoning effort")}
              value={effort}
              onChange={(option) => selectVariant(baseValue, option.value)}
              isDisabled={props.isDisabled}
              compactLayout={props.compactLayout}
              compactLabels
            />
          </div>
        )}
      </div>
    );
  }
  return (
    <div className={`grid min-w-0 gap-2 ${hasEmbeddedEffort ? 'sm:grid-cols-3' : hasVariants ? 'sm:grid-cols-2' : 'grid-cols-1'}`}>
      <ModelAdapterSelect
        {...props}
        aria-label={uiText("Model family")}
        options={families}
        value={families.find((option) => option.value === selectedFamily) || null}
        onChange={(family) => {
          const matching = options.filter((option) => getInferenceModelFamily(option.value) === family?.value);
          onChange(matching.find((option) => option.value === value?.value) || matching[0] || null);
        }}
      />
      {hasVariants && (
        <ModelAdapterSelect
          {...props}
          aria-label={uiText("{value0} model", { value0: selectedFamily })}
          options={modelVariants}
          value={hasEmbeddedEffort ? modelVariants.find((option) => option.value === baseValue) : value}
          onChange={(option) => selectVariant(option.value)}
        />
      )}
      {hasEmbeddedEffort && (
        <InferenceEffortSelect
          aria-label={uiText("Reasoning effort")}
          value={effort}
          onChange={(option) => selectVariant(baseValue, option.value)}
          isDisabled={props.isDisabled}
          compactLayout={props.compactLayout}
        />
      )}
    </div>
  );
}
