import { translateText as uiText } from '../../utils/localization.js';
import { useUiLanguage } from '../../hooks/useUiLanguage.js';
import SingleSelect from './SingleSelect.jsx';
import { INFERENCE_EFFORT_OPTIONS } from '../../constants/Types.ts';
import { inferGPT56SolEffortFromModelValue } from '../../utils/deploymentInferencePolicy.mjs';

export const DEFAULT_INFERENCE_EFFORT = 'high';

export function getInferenceEffortOption(value) {
  return INFERENCE_EFFORT_OPTIONS.find((option) => option.value === value) ||
    INFERENCE_EFFORT_OPTIONS[0];
}

export function inferSavedInferenceEffort(user = {}) {
  if (user?.selectedInferenceEffort === 'xhigh') return 'xhigh';
  if (user?.selectedInferenceEffort === 'high') return 'high';
  return inferGPT56SolEffortFromModelValue(user?.selectedInferenceModel) ||
    DEFAULT_INFERENCE_EFFORT;
}

export default function InferenceEffortSelect({ value, onChange, compactLabels = false, ...props }) {
  const uiLanguage = useUiLanguage();
  return (
    <SingleSelect
      options={INFERENCE_EFFORT_OPTIONS}
      value={getInferenceEffortOption(value?.value || value)}
      onChange={onChange}
      isSearchable={false}
      formatOptionLabel={(option, meta) => (
        <div className="flex min-w-0 items-center justify-between gap-2">
          <span title={compactLabels ? option.label : undefined}>
            {compactLabels && meta.context === 'value'
              ? uiLanguage === 'en' ? option.value === 'xhigh' ? 'XH' : 'H' : option.label
              : option.label}
          </span>
          {meta.context === 'menu' && (
            <span
              aria-label={`${option.label}: ${option.description}`}
              className="cursor-help text-xs opacity-70"
              title={option.description}
            >
              ⓘ
            </span>
          )}
        </div>
      )}
      {...props}
    />
  );
}
