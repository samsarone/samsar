import { lazy, Suspense, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { MdArrowUpward, MdOutlineTune } from 'react-icons/md';
import { FaSpinner } from 'react-icons/fa';
import axios from 'axios';
import { useUser } from '../../contexts/UserContext.jsx';
import { useUiLanguage } from '../../hooks/useUiLanguage.js';
import { useDeploymentModelAvailability } from '../../hooks/useDeploymentModelAvailability.js';
import { useInferenceModelAvailability } from '../../hooks/useInferenceModelAvailability.js';
import { getHeaders } from '../../utils/web.jsx';
import { buildLoginPathForRedirect } from '../../utils/authRedirect.js';
import { resolveGenerationModelDefaults } from '../../utils/generationDefaults.mjs';
import { parseReasoningModelChoice, supportsInferenceEffort } from '../../utils/inferenceModelChoices.mjs';
import { translateText as uiText } from '../../utils/localization.js';
import { resolveLanguageCode } from '../../constants/supportedLanguages.js';
import OverflowContainer from '../common/OverflowContainer.tsx';
import { IS_STANDALONE_DEPLOYMENT } from '../../utils/environment.jsx';

const CreatePublishedGallery = lazy(() => import('./CreatePublishedGallery.jsx'));

const API_SERVER = import.meta.env.VITE_PROCESSOR_API || 'http://localhost:3002';
const DRAFT_KEY = 'samsarCreatePrompt';
const PROMPT_LIMIT = 4000;

function readStored(storage, key, fallback = '') {
  try { return storage?.getItem(key) || fallback; } catch { return fallback; }
}

function storeDraft(value) {
  try { sessionStorage.setItem(DRAFT_KEY, value); } catch { /* The form also works without storage. */ }
}

export default function CreateLanding() {
  useUiLanguage();
  const { user, userFetching, userInitiated } = useUser();
  const navigate = useNavigate();
  const [prompt, setPrompt] = useState(() => readStored(sessionStorage, DRAFT_KEY));
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState('');
  const submissionRef = useRef(false);
  const previewPreloadRef = useRef(null);
  const deployment = useDeploymentModelAvailability();
  const inference = useInferenceModelAvailability();
  const isLoading = !userInitiated || userFetching || (Boolean(user?._id) && (deployment.isLoading || inference.isLoading));

  function warmPreview() {
    if (previewPreloadRef.current) return;
    // Download the player during composition; session reads still begin after creation.
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

    const models = resolveGenerationModelDefaults(user);
    const reasoningChoice = parseReasoningModelChoice(models.inferenceModel);
    const inferenceModel = reasoningChoice?.model || models.inferenceModel;
    if (deployment.isStandaloneDeployment && (
      !inference.modelValues.includes(inferenceModel)
      || !deployment.textToVideoImageModelValues.includes(models.imageModel)
      || !deployment.textToVideoVideoModelValues.includes(models.videoModel)
    )) {
      setError(uiText('Your default models are unavailable. Update your model settings to continue.'));
      return;
    }

    submissionRef.current = true;
    warmPreview();
    setIsSubmitting(true);
    setError('');
    const input = {
      prompt: prompt.trim(),
      inference_model: inferenceModel,
      image_model: models.imageModel,
      video_model: models.videoModel,
      duration: 30,
      aspect_ratio: '16:9',
      language: resolveLanguageCode(user.preferredLanguage),
      enable_subtitles: false,
      generation_step_mode: 'one_step',
      auto_render_full_video: true,
      manual_step_stages: [],
    };
    if (supportsInferenceEffort(input.inference_model)) {
      input.effort = user.selectedInferenceEffort || reasoningChoice?.effort || 'high';
    }

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
      if ([401, 403].includes(failure?.response?.status)) {
        navigate(buildLoginPathForRedirect('/create'));
      } else {
        setError(failure?.response?.data?.message || uiText('Unable to create your video. Please try again.'));
      }
    } finally {
      submissionRef.current = false;
      setIsSubmitting(false);
    }
  }

  return (
    <div className="min-h-dvh bg-canvas">
      <OverflowContainer>
        <main className="mx-auto w-full max-w-6xl px-4 pb-12 pt-[calc(var(--app-nav-height)+3rem)] text-fg sm:px-6 sm:pt-[calc(var(--app-nav-height)+5rem)]">
          <section className="mx-auto w-full max-w-2xl" aria-labelledby="create-title">
            <h1 id="create-title" className="mb-7 text-center text-3xl font-medium tracking-tight sm:mb-9 sm:text-4xl">{uiText('Create video')}</h1>
            <form onSubmit={handleSubmit} onFocusCapture={warmPreview} aria-busy={isSubmitting} className="rounded-[28px] border border-line/70 bg-surface p-4 shadow-sm transition-[border-color,box-shadow] focus-within:border-accent/60 focus-within:ring-4 focus-within:ring-accent/5 motion-reduce:transition-none sm:p-5">
              <label htmlFor="create-prompt" className="sr-only">{uiText('Describe your video')}</label>
              <textarea
                id="create-prompt"
                value={prompt}
                onChange={(event) => { setPrompt(event.target.value); storeDraft(event.target.value); setError(''); }}
                placeholder={uiText('Describe your video')}
                aria-describedby={error ? 'create-error' : undefined}
                maxLength={PROMPT_LIMIT}
                required
                disabled={isSubmitting}
                className="block min-h-36 w-full resize-y rounded-xl bg-transparent px-2 py-3 text-base leading-7 text-fg outline-none placeholder:text-fg-muted sm:min-h-40"
              />
              <div className="mt-3 flex items-center justify-between gap-3">
                <Link to="/account/settings" aria-label={uiText('Settings')} title={uiText('Settings')} className="inline-flex size-11 shrink-0 items-center justify-center rounded-full text-fg-muted transition-colors hover:bg-surface-hover hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus motion-reduce:transition-none">
                  <MdOutlineTune aria-hidden="true" className="size-5" />
                </Link>
                <button type="submit" disabled={isLoading || isSubmitting || !prompt.trim()} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-full bg-accent px-5 py-3 text-sm font-medium text-on-accent transition-colors hover:bg-accent-strong focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus focus-visible:ring-offset-2 focus-visible:ring-offset-surface disabled:cursor-not-allowed disabled:opacity-50 motion-reduce:transition-none">
                  {isSubmitting ? <FaSpinner aria-hidden="true" className="animate-spin motion-reduce:animate-none" /> : null}
                  {isSubmitting ? uiText('Creating your video...') : uiText('Create video')}
                  {!isSubmitting ? <MdArrowUpward aria-hidden="true" className="size-4" /> : null}
                </button>
              </div>
            </form>
            {error && <p id="create-error" role="alert" className="mt-3 px-2 text-left text-sm text-danger">{error}</p>}
          </section>
          {!IS_STANDALONE_DEPLOYMENT && <Suspense fallback={null}><CreatePublishedGallery /></Suspense>}
        </main>
      </OverflowContainer>
    </div>
  );
}
