import { useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { FaArrowRight, FaSpinner } from 'react-icons/fa';
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
  const deployment = useDeploymentModelAvailability();
  const inference = useInferenceModelAvailability();
  const isLoading = !userInitiated || userFetching || (Boolean(user?._id) && (deployment.isLoading || inference.isLoading));

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
      navigate(`/vidgenie/${encodeURIComponent(sessionId)}`);
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
    <OverflowContainer>
      <main className="relative isolate flex min-h-[calc(100dvh-6rem)] items-center justify-center overflow-hidden px-5 py-16 text-fg sm:px-8">
        <div aria-hidden="true" className="pointer-events-none absolute left-1/2 top-1/2 -z-10 h-80 w-80 -translate-x-1/2 -translate-y-1/2 rounded-full bg-rose-400/10 blur-3xl sm:h-[30rem] sm:w-[30rem]" />
        <div className="w-full max-w-2xl">
          <div className="mb-9 text-center">
            <p className="mb-4 text-xs font-semibold uppercase tracking-[0.24em] text-fg-muted">{uiText('From an idea to a video')}</p>
            <h1 className="text-4xl font-semibold tracking-tight sm:text-5xl">{uiText('What do you want to create?')}</h1>
            <p id="create-description" className="mx-auto mt-5 max-w-lg text-base leading-7 text-fg-muted">{uiText('Describe your video. Samsar takes care of the rest.')}</p>
          </div>
          <form onSubmit={handleSubmit} aria-busy={isSubmitting} className="rounded-3xl border border-line bg-surface p-3 shadow-xl shadow-black/5 sm:p-4">
            <label htmlFor="create-prompt" className="sr-only">{uiText('Describe your video')}</label>
            <textarea
              id="create-prompt"
              value={prompt}
              onChange={(event) => { setPrompt(event.target.value); storeDraft(event.target.value); setError(''); }}
              placeholder={uiText('A short film about a quiet city waking up...')}
              aria-describedby="create-description create-error"
              maxLength={PROMPT_LIMIT}
              required
              disabled={isSubmitting}
              className="block min-h-40 w-full resize-y rounded-2xl bg-transparent px-3 py-4 text-base leading-7 text-fg outline-none placeholder:text-fg-muted focus-visible:ring-2 focus-visible:ring-rose-400/50 sm:px-4"
            />
            <div className="mt-2 flex justify-end">
              <button type="submit" disabled={isLoading || isSubmitting || !prompt.trim()} className="inline-flex min-h-12 items-center justify-center gap-3 rounded-2xl bg-[#ff4655] px-6 py-3 text-sm font-semibold text-white transition hover:bg-[#e63746] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-400 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50">
                {isSubmitting ? <FaSpinner aria-hidden="true" className="animate-spin" /> : null}
                {isSubmitting ? uiText('Creating your video...') : uiText('Create video')}
                {!isSubmitting ? <FaArrowRight aria-hidden="true" /> : null}
              </button>
            </div>
          </form>
          <div id="create-error" role={error ? 'alert' : undefined} className="mt-4 text-center text-sm text-red-500">{error}</div>
          <p className="mt-5 text-center text-xs leading-6 text-fg-muted">{uiText('Your default models are ready to go.')}{' '}<Link to="/account/settings" className="rounded underline underline-offset-4 hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-400">{uiText('Settings')}</Link></p>
        </div>
      </main>
    </OverflowContainer>
  );
}
