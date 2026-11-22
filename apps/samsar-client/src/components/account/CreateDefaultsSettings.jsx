import { useEffect, useRef, useState } from 'react';
import axios from 'axios';
import { useUser } from '../../contexts/UserContext.jsx';
import { useUiLanguage } from '../../hooks/useUiLanguage.js';
import { useInferenceModelAvailability } from '../../hooks/useInferenceModelAvailability.js';
import { useDeploymentModelAvailability } from '../../hooks/useDeploymentModelAvailability.js';
import { getHeaders } from '../../utils/web.jsx';
import { translateText as uiText } from '../../utils/localization.js';
import { CREATE_ASPECT_RATIOS, CREATE_DURATION_OPTIONS, resolveCreateDefaults } from '../../utils/generationDefaults.mjs';
import { parseReasoningModelChoice, supportsInferenceEffort } from '../../utils/inferenceModelChoices.mjs';
import { isImageModelAllowedForDeploymentScope } from '../../utils/imageModelAvailability.mjs';
import { canListVideoModel } from '../../utils/videoModelAvailability.mjs';
import { IMAGE_GENERAITON_MODEL_TYPES, VIDEO_GENERATION_MODEL_TYPES } from '../../constants/Types.ts';
import { IMAGE_MODEL_PRICES, VIDEO_MODEL_PRICES } from '../../constants/ModelPrices.jsx';
import GeminiModelSelect from '../common/GeminiModelSelect.jsx';
import ModelAdapterSelect from '../common/ModelAdapterSelect.jsx';
import CommonButton from '../common/CommonButton.tsx';
import SecondaryButton from '../common/SecondaryButton.tsx';

const API_SERVER = import.meta.env.VITE_PROCESSOR_API || 'http://localhost:3002';
const FIELD_CLASS = 'app-field min-h-11 w-full rounded-lg border border-line px-3 py-2 text-sm text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus disabled:opacity-60';

function supportedAspectRatio(model, ratio) {
  return !model?.supportedAspectRatios?.length || model.supportedAspectRatios.includes(ratio);
}

export default function CreateDefaultsSettings() {
  useUiLanguage();
  const { user, setUser } = useUser();
  const [saved, setSaved] = useState(() => resolveCreateDefaults(user));
  const [defaults, setDefaults] = useState(saved);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [loadAttempt, setLoadAttempt] = useState(0);
  const [loadFailed, setLoadFailed] = useState(false);
  const [error, setError] = useState('');
  const [status, setStatus] = useState('');
  const savingRef = useRef(false);
  const latestUserRef = useRef(user);
  latestUserRef.current = user;
  const inference = useInferenceModelAvailability();
  const deployment = useDeploymentModelAvailability();
  const standalone = deployment.isStandaloneDeployment;
  const modelsLoading = inference.isLoading || deployment.isLoading;

  useEffect(() => {
    let active = true;
    const controller = new AbortController();
    setLoading(true);
    setLoadFailed(false);
    setError('');
    axios.get(`${API_SERVER}/users/create_defaults`, { ...getHeaders(), signal: controller.signal })
      .then(({ data }) => {
        if (!active) return;
        if (!data?.createDefaults) throw new Error('Missing Create defaults');
        const next = resolveCreateDefaults({ createDefaults: data.createDefaults });
        setSaved(next);
        setDefaults(next);
      })
      .catch((failure) => {
        if (!active || failure?.code === 'ERR_CANCELED') return;
        setLoadFailed(true);
        setError(uiText('Unable to load Create defaults. Please try again.'));
      })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; controller.abort(); };
  }, [user?._id, loadAttempt]);

  const textOptions = [...new Map((inference.inferenceModelOptions || []).filter((option) =>
    !option.value.endsWith('-xhigh')).map((option) => {
    const model = parseReasoningModelChoice(option.value)?.model || option.value;
    return [model, { ...option, value: model }];
  })).values()];
  const imageOptions = IMAGE_GENERAITON_MODEL_TYPES.filter((model) => model.isExpressModel &&
    IMAGE_MODEL_PRICES.some((entry) => entry.key === model.key && (entry.providerBilled || entry.prices?.length)) &&
    isImageModelAllowedForDeploymentScope(model, standalone) &&
    (!standalone || deployment.textToVideoImageModelValues?.includes(model.key)))
    .map((model) => ({ value: model.key, label: model.name }));
  const videoOptions = VIDEO_GENERATION_MODEL_TYPES.filter((model) => model.isExpressModel &&
    canListVideoModel({ model, pricingEntry: VIDEO_MODEL_PRICES.find((entry) => entry.key === model.key), isStandaloneDeployment: standalone }) &&
    (!standalone || deployment.textToVideoVideoModelValues?.includes(model.key)))
    .map((model) => ({ value: model.key, label: model.name }));
  const modelFields = [
    { key: 'inferenceModel', label: uiText('Text model'), options: textOptions },
    { key: 'imageModel', label: uiText('Image model'), options: imageOptions },
    { key: 'videoModel', label: uiText('Video model'), options: videoOptions },
  ];
  const unavailable = !modelsLoading && modelFields.some((field) =>
    !field.options.some((option) => option.value === defaults[field.key]));
  const selectedImage = IMAGE_GENERAITON_MODEL_TYPES.find((model) => model.key === defaults.imageModel);
  const selectedVideo = VIDEO_GENERATION_MODEL_TYPES.find((model) => model.key === defaults.videoModel);
  const compatibleRatio = (ratio) => supportedAspectRatio(selectedImage, ratio) && supportedAspectRatio(selectedVideo, ratio);
  const invalidRatio = !compatibleRatio(defaults.aspectRatio);
  const dirty = JSON.stringify(defaults) !== JSON.stringify(saved);
  const busy = loading || saving;
  const change = (key, value) => {
    setDefaults((current) => ({ ...current, [key]: value }));
    setError('');
    setStatus('');
  };

  async function handleSave(event) {
    event.preventDefault();
    if (savingRef.current || busy || modelsLoading || loadFailed || unavailable || invalidRatio || !dirty) return;
    savingRef.current = true;
    setSaving(true);
    setError('');
    setStatus('');
    const userId = user?._id;
    try {
      const { data } = await axios.put(`${API_SERVER}/users/create_defaults`, { createDefaults: defaults }, getHeaders());
      if (latestUserRef.current?._id !== userId) return;
      if (!data?.createDefaults) throw new Error('Missing saved Create defaults');
      const next = resolveCreateDefaults({ createDefaults: data.createDefaults });
      setSaved(next);
      setDefaults(next);
      setUser?.({ ...latestUserRef.current, createDefaults: next });
      setStatus(uiText('Create defaults saved. New videos will use these settings.'));
    } catch (failure) {
      if (latestUserRef.current?._id === userId) {
        setError(failure?.response?.data?.message || uiText('Unable to save Create defaults. Please try again.'));
      }
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  }

  return (
    <form onSubmit={handleSave} aria-busy={busy} className="space-y-6" aria-labelledby="create-defaults-title">
      <div className="space-y-1">
        <h3 id="create-defaults-title" className="text-lg font-semibold">{uiText('Create defaults')}</h3>
        <p className="max-w-2xl text-sm leading-6 text-fg-muted">{uiText('Choose the models and settings used whenever you start a new video from Create.')}</p>
      </div>
      {loading && <p role="status" className="text-sm text-fg-muted">{uiText('Loading...')}</p>}
      <fieldset disabled={busy || loadFailed} className="min-w-0 space-y-5">
        <legend className="sr-only">{uiText('Model settings')}</legend>
        <div className="grid min-w-0 gap-4 lg:grid-cols-3">
          {modelFields.map((field) => {
            const selected = field.options.find((option) => option.value === defaults[field.key]);
            const options = selected ? field.options : [{ value: defaults[field.key], label: defaults[field.key], isDisabled: true }, ...field.options];
            const Picker = field.key === 'inferenceModel' ? GeminiModelSelect : ModelAdapterSelect;
            return <div key={field.key} className="min-w-0 space-y-2">
              <label htmlFor={`create-defaults-${field.key}`} className="block text-sm font-medium text-fg-secondary">{field.label}</label>
              <Picker
                id={`create-defaults-${field.key}`}
                aria-label={field.label}
                hostedControl="native"
                nativeClassName={FIELD_CLASS}
                isStandaloneDeployment={standalone}
                primaryAdapterByModel={deployment.primaryAdapterByModel}
                options={options}
                value={selected || options[0]}
                isDisabled={busy || loadFailed || modelsLoading || field.options.length === 0}
                onChange={(option) => { if (option?.value) change(field.key, option.value); }}
              />
            </div>;
          })}
        </div>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <div className="space-y-2">
            <label htmlFor="create-defaults-duration" className="block text-sm font-medium text-fg-secondary">{uiText('Duration')}</label>
            <select id="create-defaults-duration" className={FIELD_CLASS} value={defaults.duration} onChange={(event) => change('duration', Number(event.target.value))}>
              {CREATE_DURATION_OPTIONS.map((duration) => <option key={duration} value={duration}>{uiText('{value0} seconds', { value0: duration })}</option>)}
            </select>
          </div>
          <div className="space-y-2">
            <label htmlFor="create-defaults-ratio" className="block text-sm font-medium text-fg-secondary">{uiText('Aspect ratio')}</label>
            <select id="create-defaults-ratio" className={FIELD_CLASS} value={defaults.aspectRatio} onChange={(event) => change('aspectRatio', event.target.value)}>
              {CREATE_ASPECT_RATIOS.map((ratio) => <option key={ratio} value={ratio} disabled={!compatibleRatio(ratio)}>{ratio}</option>)}
            </select>
          </div>
          {supportsInferenceEffort(defaults.inferenceModel) && <div className="space-y-2">
            <label htmlFor="create-defaults-effort" className="block text-sm font-medium text-fg-secondary">{uiText('Reasoning effort')}</label>
            <select id="create-defaults-effort" className={FIELD_CLASS} value={defaults.inferenceEffort} onChange={(event) => change('inferenceEffort', event.target.value)}>
              <option value="high">{uiText('High')}</option>
              <option value="xhigh">{uiText('Extra high')}</option>
            </select>
          </div>}
        </div>
        <label className="flex min-h-11 cursor-pointer items-center gap-3 rounded-xl border border-line bg-surface-muted px-4 py-3 text-sm">
          <input type="checkbox" checked={defaults.enableSubtitles} onChange={(event) => change('enableSubtitles', event.target.checked)} className="size-4 accent-accent" />
          <span>{uiText('Enable subtitles')}</span>
        </label>
      </fieldset>
      {unavailable && !loading && <p className="text-sm text-danger" role="alert">{uiText('One or more saved models are unavailable. Choose supported models before saving.')}</p>}
      {invalidRatio && <p className="text-sm text-danger" role="alert">{uiText('Choose an aspect ratio supported by both the image and video model.')}</p>}
      {error && <div className="flex flex-wrap items-center gap-3">
        <p role="alert" className="text-sm text-danger">{error}</p>
        {loadFailed && <SecondaryButton type="button" onClick={() => setLoadAttempt((attempt) => attempt + 1)}>{uiText('Retry')}</SecondaryButton>}
      </div>}
      {status && <p role="status" className="text-sm text-success">{status}</p>}
      <div className="flex flex-wrap gap-3">
        <CommonButton type="submit" isPending={saving} isDisabled={loading || modelsLoading || loadFailed || unavailable || invalidRatio || !dirty} className="!m-0">{uiText('Save defaults')}</CommonButton>
        <SecondaryButton type="button" disabled={busy || !dirty} className="!m-0" onClick={() => { setDefaults(saved); setError(''); setStatus(''); }}>{uiText('Reset changes')}</SecondaryButton>
      </div>
    </form>
  );
}
