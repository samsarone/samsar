import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { MdArrowForward, MdCenterFocusStrong, MdCloseFullscreen, MdOutlineTune, MdAutoAwesome, MdInfoOutline } from 'react-icons/md';
import { Popover, PopoverButton, PopoverPanel } from '@headlessui/react';
import { FaSpinner } from 'react-icons/fa';
import axios from 'axios';
import { useUser } from '../../contexts/UserContext.jsx';
import { useUiLanguage } from '../../hooks/useUiLanguage.js';
import { useDeploymentModelAvailability } from '../../hooks/useDeploymentModelAvailability.js';
import { useInferenceModelAvailability } from '../../hooks/useInferenceModelAvailability.js';
import { getHeaders } from '../../utils/web.jsx';
import { buildLoginPathForRedirect } from '../../utils/authRedirect.js';
import { CREATE_ASPECT_RATIOS, CREATE_DURATION_OPTIONS, resolveCreateDefaults } from '../../utils/generationDefaults.mjs';
import { supportsInferenceEffort } from '../../utils/inferenceModelChoices.mjs';
import { formatUiNumber, translateText as uiText } from '../../utils/localization.js';
import { resolveLanguageCode } from '../../constants/supportedLanguages.js';
import { IMAGE_GENERAITON_MODEL_TYPES, INFERENCE_MODEL_TYPES, VIDEO_GENERATION_MODEL_TYPES } from '../../constants/Types.ts';
import { VIDEO_MODEL_PRICES } from '../../constants/ModelPrices.jsx';
import { getExpressVideoCreditsPerSecondForRateClass } from '../../constants/pricing/ExpressVideoPricingDistribution.js';
import { isProviderBilledVideoPricing } from '../../utils/videoModelAvailability.mjs';
import VidgeniePageShell from '../oneshot_editor/VidgeniePageShell.jsx';
import { IS_STANDALONE_DEPLOYMENT } from '../../utils/environment.jsx';

const CreatePublishedGallery = lazy(() => import('./CreatePublishedGallery.jsx'));
const API_SERVER = import.meta.env.VITE_PROCESSOR_API || 'http://localhost:3002';
const DRAFT_KEY = 'samsarCreatePrompt';
const PROMPT_LIMIT = 4000;
const controlClass = 'min-h-11 w-full rounded-lg border border-control-border bg-surface-raised px-3 py-2 text-sm text-fg outline-none transition-colors hover:border-accent/60 focus-visible:ring-2 focus-visible:ring-focus disabled:opacity-50 motion-reduce:transition-none';
const secondaryClass = 'inline-flex min-h-11 items-center justify-center gap-2 rounded-lg border border-control-border bg-surface-raised px-3 py-2 text-sm font-medium text-control-fg transition-colors hover:bg-surface-hover hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus disabled:cursor-not-allowed disabled:opacity-50 motion-reduce:transition-none';

function readDraft() {
  try { return sessionStorage.getItem(DRAFT_KEY) || ''; } catch { return ''; }
}
function storeDraft(value) {
  try { sessionStorage.setItem(DRAFT_KEY, value); } catch { /* The form also works without storage. */ }
}
function modelLabel(value, models) {
  const model = models.find((item) => (item.key || item.value) === value);
  return model?.name || model?.label || value;
}

export default function CreateLanding() {
  useUiLanguage();
  const { user, userFetching, userInitiated } = useUser();
  const navigate = useNavigate();
  const defaults = resolveCreateDefaults(user);
  const [prompt, setPrompt] = useState(readDraft);
  const [overrides, setOverrides] = useState(null);
  const [focused, setFocused] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState('');
  const submissionRef = useRef(false);
  const previewPreloadRef = useRef(null);
  const promptRef = useRef(null);
  const deployment = useDeploymentModelAvailability();
  const inference = useInferenceModelAvailability();
  const isLoading = !userInitiated || userFetching || (Boolean(user?._id) && (deployment.isLoading || inference.isLoading));
  const currentOverrides = overrides?.userId === user?._id ? overrides : {};
  const duration = currentOverrides?.duration ?? defaults.duration;
  const aspectRatio = currentOverrides?.aspectRatio ?? defaults.aspectRatio;
  const providerBilled = IS_STANDALONE_DEPLOYMENT || deployment.isStandaloneDeployment || isProviderBilledVideoPricing(VIDEO_MODEL_PRICES.find((item) => item.key === defaults.videoModel));
  const rate = getExpressVideoCreditsPerSecondForRateClass(defaults.videoModel, 'vidgenie');
  const estimatedCredits = rate == null ? null : duration * rate;
  const aspectRatioSupported = (ratio) => [
    IMAGE_GENERAITON_MODEL_TYPES.find((model) => model.key === defaults.imageModel),
    VIDEO_GENERATION_MODEL_TYPES.find((model) => model.key === defaults.videoModel),
  ].every((model) => !model?.supportedAspectRatios?.length || model.supportedAspectRatios.includes(ratio));

  useEffect(() => {
    if (!focused) return undefined;
    function exitFocus(event) { if (event.key === 'Escape') setFocused(false); }
    window.addEventListener('keydown', exitFocus);
    return () => window.removeEventListener('keydown', exitFocus);
  }, [focused]);

  function changeOption(key, value) {
    setOverrides({ ...currentOverrides, userId: user?._id, [key]: value });
    setError('');
  }
  function warmPreview() {
    if (previewPreloadRef.current) return;
    previewPreloadRef.current = import('../oneshot_editor/OneshotEditorContainer.jsx')
      .then(({ preloadOneshotEditor }) => preloadOneshotEditor())
      .catch(() => { previewPreloadRef.current = null; });
  }
  async function handleSubmit(event) {
    event.preventDefault();
    if (submissionRef.current || isLoading || !prompt.trim()) return;
    const headers = getHeaders();
    if (!user?._id || !headers) {
      storeDraft(prompt);
      navigate(buildLoginPathForRedirect('/create'));
      return;
    }
    if (deployment.isStandaloneDeployment && (
      !inference.modelValues.includes(defaults.inferenceModel)
      || !deployment.textToVideoImageModelValues.includes(defaults.imageModel)
      || !deployment.textToVideoVideoModelValues.includes(defaults.videoModel)
    )) {
      setError(uiText('Your default models are unavailable. Update your model settings to continue.'));
      return;
    }
    if (!aspectRatioSupported(aspectRatio)) {
      setError(uiText('Choose an aspect ratio supported by both the image and video model.'));
      return;
    }
    submissionRef.current = true;
    warmPreview();
    setIsSubmitting(true);
    setError('');
    const input = {
      prompt: prompt.trim(),
      inference_model: defaults.inferenceModel,
      image_model: defaults.imageModel,
      video_model: defaults.videoModel,
      duration,
      aspect_ratio: aspectRatio,
      language: resolveLanguageCode(user.preferredLanguage),
      enable_subtitles: defaults.enableSubtitles,
      generation_step_mode: 'one_step',
      auto_render_full_video: true,
      manual_step_stages: [],
    };
    if (supportsInferenceEffort(input.inference_model)) input.effort = defaults.inferenceEffort;
    try {
      const { data } = await axios.post(`${API_SERVER}/v2/video/step/text_to_video`, { input }, headers);
      const sessionId = data?.session_id || data?.request_id || data?.sessionID;
      if (typeof sessionId !== 'string' || !sessionId.trim()) throw new Error('Missing session id');
      try {
        sessionStorage.removeItem(DRAFT_KEY);
        localStorage.setItem('videoSessionId', sessionId);
        localStorage.setItem(`vidgenieRequestStepMode:${sessionId}`, 'one_step');
      } catch { /* Navigation does not depend on browser storage. */ }
      navigate(`/vidgenie/${encodeURIComponent(sessionId)}?view=preview`);
    } catch (failure) {
      if ([401, 403].includes(failure?.response?.status)) navigate(buildLoginPathForRedirect('/create'));
      else setError(failure?.response?.data?.message || uiText('Unable to create your video. Please try again.'));
    } finally {
      submissionRef.current = false;
      setIsSubmitting(false);
    }
  }

  return (
    <VidgeniePageShell>
      <main className="pb-6 pt-4 sm:pt-7">
        <section className="mx-auto w-full max-w-4xl text-left" aria-labelledby="create-title">
          <div className="mb-5 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <p className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-widest text-fg-muted"><MdAutoAwesome aria-hidden="true" />{uiText('Express creator')}</p>
              <h1 id="create-title" className="text-2xl font-semibold tracking-tight sm:text-3xl">{uiText('Create video')}</h1>
              <p className="mt-2 max-w-lg text-sm leading-6 text-fg-secondary">{uiText('Describe your idea. Bring it to life in one step.')}</p>
            </div>
            <div role="status" aria-label={uiText('Render estimate')} className="shrink-0 rounded-xl border border-line bg-surface-raised px-4 py-3 sm:text-right">
              <p className="text-xs text-fg-muted">{uiText('Estimated render cost')}</p>
              <p className="mt-1 text-base font-semibold tabular-nums">{providerBilled ? uiText('API charge') : estimatedCredits == null ? uiText('Estimate unavailable') : uiText('{credits} credits', { credits: formatUiNumber(estimatedCredits) })}</p>
              {!providerBilled && rate != null && <p className="mt-1 text-xs text-fg-muted">{uiText('{seconds}s × {rate} credits/s', { seconds: duration, rate })}</p>}
            </div>
          </div>
          <form onSubmit={handleSubmit} onFocusCapture={warmPreview} aria-busy={isSubmitting} className="vidgenie-editor-card relative rounded-2xl border border-line bg-white p-4 text-fg shadow-sm dark:bg-[#181b24]/96 dark:shadow-[0_20px_56px_rgba(0,0,0,0.32)] sm:p-6">
            <div className="mb-3 flex items-center justify-between gap-3">
              <label htmlFor="create-prompt" className="text-sm font-semibold">{uiText('Describe your video')}</label>
              <button type="button" aria-pressed={focused} onClick={() => setFocused(!focused)} className="inline-flex min-h-9 items-center gap-1.5 rounded-lg px-2 text-xs text-fg-muted hover:bg-surface-hover hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus">
                {focused ? <MdCloseFullscreen aria-hidden="true" className="size-4" /> : <MdCenterFocusStrong aria-hidden="true" className="size-4" />}
                {focused ? uiText('Exit focus mode') : uiText('Focus mode')}
              </button>
            </div>
            <textarea
              ref={promptRef}
              id="create-prompt"
              value={prompt}
              onChange={(event) => { setPrompt(event.target.value); storeDraft(event.target.value); setError(''); }}
              placeholder={uiText('A story, a product, a world you want to share…')}
              aria-describedby={`create-prompt-hint${error ? ' create-error' : ''}`}
              aria-invalid={Boolean(error)}
              maxLength={PROMPT_LIMIT}
              required
              disabled={isSubmitting}
              className={`block w-full resize-y rounded-xl border border-control-border bg-surface-raised px-4 py-3 text-base leading-7 text-fg outline-none transition-[border-color,box-shadow] placeholder:text-fg-muted focus:border-accent/70 focus:ring-2 focus:ring-accent/15 disabled:opacity-60 motion-reduce:transition-none ${focused ? 'min-h-72 sm:min-h-96' : 'min-h-40 sm:min-h-44'}`}
            />
            <div className="mt-2 flex items-center justify-between gap-3 text-xs text-fg-muted">
              <p id="create-prompt-hint">{uiText('Include the subject, visual style, and story.')}</p>
              <span className="shrink-0 tabular-nums" aria-label={uiText('Prompt character count')}>{formatUiNumber(prompt.length)} / {formatUiNumber(PROMPT_LIMIT)}</span>
            </div>
            <div className="mt-5 grid grid-cols-2 gap-3 sm:max-w-md sm:gap-4">
              <div>
                <label htmlFor="create-duration" className="mb-1.5 block text-xs font-medium text-fg-muted">{uiText('Duration')}</label>
                <select id="create-duration" value={duration} title={uiText('Saved default: {seconds} seconds. Changes here apply only to this video.', { seconds: defaults.duration })} aria-describedby="create-defaults-hint" onChange={(event) => changeOption('duration', Number(event.target.value))} disabled={isSubmitting} className={controlClass}>
                  {CREATE_DURATION_OPTIONS.map((value) => <option key={value} value={value}>{uiText('{seconds} seconds', { seconds: value })}</option>)}
                </select>
              </div>
              <div>
                <label htmlFor="create-aspect-ratio" className="mb-1.5 block text-xs font-medium text-fg-muted">{uiText('Aspect ratio')}</label>
                <select id="create-aspect-ratio" value={aspectRatio} title={uiText('Saved default: {ratio}. Changes here apply only to this video.', { ratio: defaults.aspectRatio })} aria-describedby="create-defaults-hint" onChange={(event) => changeOption('aspectRatio', event.target.value)} disabled={isSubmitting} className={controlClass}>
                  {CREATE_ASPECT_RATIOS.map((value) => <option key={value} value={value} disabled={!aspectRatioSupported(value)}>{value === '16:9' ? uiText('Landscape · 16:9') : value === '9:16' ? uiText('Portrait · 9:16') : uiText('Square · 1:1')}</option>)}
                </select>
              </div>
            </div>
            <div className="mt-4 flex flex-wrap items-center gap-2 text-xs text-fg-secondary" aria-label={uiText('Model settings')}>
              {[
                [uiText('Text model'), modelLabel(defaults.inferenceModel, INFERENCE_MODEL_TYPES)],
                [uiText('Image model'), modelLabel(defaults.imageModel, IMAGE_GENERAITON_MODEL_TYPES)],
                [uiText('Video model'), modelLabel(defaults.videoModel, VIDEO_GENERATION_MODEL_TYPES)],
              ].map(([label, value]) => <Link key={label} to="/account/settings/defaults" title={uiText('{setting}: {model}. Change in Defaults.', { setting: label, model: value })} className="rounded-md bg-surface-muted px-2.5 py-1.5 transition-colors hover:bg-surface-hover hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus motion-reduce:transition-none">{value}</Link>)}
              {defaults.enableSubtitles && <span className="rounded-md bg-surface-muted px-2.5 py-1.5">{uiText('Subtitles on')}</span>}
              <Popover className="relative inline-flex">
                <PopoverButton type="button" aria-label={uiText('About Create defaults')} title={uiText('View saved defaults')} className="inline-flex size-8 items-center justify-center rounded-full text-fg-muted hover:bg-surface-hover hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus">
                  <MdInfoOutline aria-hidden="true" className="size-4" />
                </PopoverButton>
                <PopoverPanel anchor="bottom end" role="dialog" aria-label={uiText('Create defaults')} className="z-[1300] w-72 max-w-[calc(100vw-1.5rem)] space-y-2 rounded-xl border border-line bg-surface p-4 text-left text-xs leading-5 text-fg-secondary shadow-xl [--anchor-gap:8px] [--anchor-padding:12px]">
                  <p className="font-semibold text-fg">{uiText('Saved defaults: {seconds}s · {ratio}', { seconds: defaults.duration, ratio: defaults.aspectRatio })}</p>
                  <p>{uiText('Subtitles: {state}', { state: defaults.enableSubtitles ? uiText('On') : uiText('Off') })}</p>
                  <p>{uiText('Duration and aspect ratio changes here apply only to this video.')}</p>
                  <Link to="/account/settings/defaults" className="inline-flex min-h-9 items-center gap-1 rounded text-sm font-medium text-fg underline underline-offset-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus">{uiText('Change defaults')}<MdArrowForward aria-hidden="true" /></Link>
                </PopoverPanel>
              </Popover>
            </div>
            <p id="create-defaults-hint" className="sr-only">{uiText('Saved defaults: {seconds}s · {ratio}', { seconds: defaults.duration, ratio: defaults.aspectRatio })}. {uiText('Duration and aspect ratio changes here apply only to this video.')}</p>
            {error && <p id="create-error" role="alert" className="mt-4 rounded-lg border border-danger/25 bg-danger/5 px-3 py-2 text-sm text-danger">{error} <Link to="/account/settings/defaults" className="font-medium underline">{uiText('Defaults')}</Link></p>}
            <div className="mt-5 flex flex-wrap items-center justify-between gap-3 border-t border-line pt-4">
              <Link to="/account/settings/defaults" className={secondaryClass}><MdOutlineTune aria-hidden="true" className="size-4" />{uiText('Defaults')}</Link>
              <div className="ml-auto flex items-center gap-2">
                {prompt && <button type="button" disabled={isSubmitting} onClick={() => { setPrompt(''); storeDraft(''); setError(''); promptRef.current?.focus(); }} className="min-h-11 rounded-lg px-3 text-xs text-fg-muted hover:bg-surface-hover hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus disabled:opacity-50">{uiText('Clear')}</button>}
                <button type="submit" disabled={isLoading || isSubmitting || !prompt.trim()} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-lg bg-gradient-to-r from-accent-from to-accent-to px-4 py-2.5 text-sm font-semibold text-on-accent transition-all duration-200 hover:from-accent-hover-from hover:to-accent-hover-to hover:-translate-y-px focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus focus-visible:ring-offset-2 focus-visible:ring-offset-surface disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:translate-y-0 dark:shadow-[0_8px_18px_rgba(3,12,28,0.22)] motion-reduce:transition-none motion-reduce:hover:translate-y-0">
                  {isSubmitting ? <FaSpinner aria-hidden="true" className="animate-spin motion-reduce:animate-none" /> : null}
                  {isSubmitting ? uiText('Creating your video...') : uiText('Create video')}
                  {!isSubmitting && <MdArrowForward aria-hidden="true" className="size-4" />}
                </button>
              </div>
            </div>
          </form>
        </section>
        {!focused && !IS_STANDALONE_DEPLOYMENT && !deployment.isStandaloneDeployment && <Suspense fallback={null}><CreatePublishedGallery /></Suspense>}
      </main>
    </VidgeniePageShell>
  );
}
