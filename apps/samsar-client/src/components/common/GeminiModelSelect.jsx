import { translateText as uiText } from '../../utils/localization.js';
import { getInferenceModelFamily, normalizeGeminiModelChoice } from '../../utils/inferenceModelChoices.mjs';
import ModelAdapterSelect from './ModelAdapterSelect.jsx';

// Keep the existing picker for other providers; Gemini has a model variant
// beside its family choice, rather than GPT/Claude reasoning-effort values.
export default function GeminiModelSelect({ options = [], value, onChange, ...props }) {
  const geminiOptions = options.filter((option) => getInferenceModelFamily(option.value) === 'Gemini');
  const variantOptions = geminiOptions.map((option) => ({
    ...option,
    label: normalizeGeminiModelChoice(option.value) === 'gemini-4-neon' ? 'Neon' : 'Carbon',
  }));
  const isGeminiSelected = getInferenceModelFamily(value?.value) === 'Gemini';
  const familyOption = {
    value: 'Gemini',
    label: 'Gemini',
    adapterModelKey: isGeminiSelected ? value.value : geminiOptions[0]?.value,
  };
  let addedGemini = false;
  const modelOptions = options.flatMap((option) => {
    if (getInferenceModelFamily(option.value) !== 'Gemini') return [option];
    if (addedGemini) return [];
    addedGemini = true;
    return [familyOption];
  });

  return (
    <div className={`grid min-w-0 gap-2 ${isGeminiSelected ? 'grid-cols-2' : 'grid-cols-1'}`}>
      <ModelAdapterSelect
        {...props}
        options={modelOptions}
        value={isGeminiSelected ? familyOption : value}
        onChange={(option) => onChange(option?.value === 'Gemini'
          ? geminiOptions.find((candidate) => candidate.value === value?.value) || geminiOptions[0] || null
          : option)}
      />
      {isGeminiSelected && (
        <ModelAdapterSelect
          {...props}
          id={props.id ? `${props.id}-gemini` : undefined}
          aria-label={uiText('{value0} model', { value0: 'Gemini' })}
          options={variantOptions}
          value={variantOptions.find((option) => option.value === value.value)}
          onChange={(option) => onChange(geminiOptions.find((candidate) => candidate.value === option?.value) || null)}
          styles={{
            ...props.styles,
            menu: (provided) => ({
              ...(typeof props.styles?.menu === 'function' ? props.styles.menu(provided) : {}),
              width: '100%',
            }),
          }}
        />
      )}
    </div>
  );
}
