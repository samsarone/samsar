import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import axios from 'axios';
import { useNavigate } from 'react-router-dom';

import { useUser } from '../../contexts/UserContext.jsx';
import { getHeaders } from '../../utils/web.jsx';
import { useDeploymentModelAvailability } from '../../hooks/useDeploymentModelAvailability.js';
import { filterOptionsForDeploymentModelValues } from '../../utils/deploymentProviders.js';

const PROCESSOR_SERVER = import.meta.env.VITE_PROCESSOR_API || 'http://localhost:3002';

const TEXT_MODELS = [
  { label: 'RunwayML Gen 4.5', value: 'RUNWAYML' },
  { label: 'Veo 3.1', value: 'VEO3.1I2V' },
  { label: 'Veo 3.1 Fast', value: 'VEO3.1I2VFAST' },
  { label: 'Nvidia Cosmos 3', value: 'COSMOS3SUPERI2V' },
  { label: 'Seedance 1.5', value: 'SEEDANCEI2V' },
  { label: 'Kling Pro', value: 'KLINGIMGTOVID3PRO' },
  { label: 'Custom Image to Video', value: 'CUSTOM_IMAGE_TO_VIDEO' },
];

const IMAGE_MODELS = [
  { label: 'GPT Image 2', value: 'GPTIMAGE2' },
  { label: 'Nano Banana 2', value: 'NANOBANANA2' },
  { label: 'NanoBanana Pro', value: 'NANOBANANAPRO' },
  { label: 'Seedream', value: 'SEEDREAM' },
];

const IMAGE_LIST_VIDEO_MODELS = [
  { label: 'Veo 3.1', value: 'VEO3.1I2V' },
  { label: 'Veo 3.1 Fast', value: 'VEO3.1I2VFAST' },
  { label: 'Nvidia Cosmos 3', value: 'COSMOS3SUPERI2V' },
  { label: 'Seedance 1.5', value: 'SEEDANCEI2V' },
  { label: 'Kling Pro', value: 'KLINGIMGTOVID3PRO' },
  { label: 'RunwayML Gen 4.5', value: 'RUNWAYML' },
  { label: 'Custom Image to Video', value: 'CUSTOM_IMAGE_TO_VIDEO' },
];

const DURATION_OPTIONS = [10, 30, 60, 90, 120];
const CREDIT_PACKS = [1000, 2500, 5000];

function formatDate(value) {
  if (!value) return 'Just now';
  try {
    return new Date(value).toLocaleString();
  } catch {
    return value;
  }
}

function formatCredits(value) {
  const numericValue = Number(value);
  if (!Number.isFinite(numericValue)) return '0';
  return numericValue.toLocaleString();
}

function toDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error(`Failed to read ${file.name}`));
    reader.readAsDataURL(file);
  });
}

export default function ExternalStudioDashboard() {
  const navigate = useNavigate();
  const { user, userFetching, resetUser } = useUser();
  const [credits, setCredits] = useState(null);
  const [requests, setRequests] = useState([]);
  const [loading, setLoading] = useState(true);
  const [submittingMode, setSubmittingMode] = useState(null);
  const [rechargeCredits, setRechargeCredits] = useState(String(CREDIT_PACKS[0]));
  const [notice, setNotice] = useState(null);
  const pollingRef = useRef(null);

  const [textForm, setTextForm] = useState({
    prompt: '',
    duration: '10',
    video_model: TEXT_MODELS[0].value,
    image_model: IMAGE_MODELS[0].value,
    enable_subtitles: true,
  });

  const [imageForm, setImageForm] = useState({
    prompt: '',
    duration: '10',
    video_model: 'RUNWAYML',
    image_model: IMAGE_MODELS[0].value,
    enable_subtitles: true,
  });
  const [imageFiles, setImageFiles] = useState([]);
  const {
    isDockerInstall: isDockerModelFilteringEnabled,
    textToVideoImageModelValues,
    textToVideoVideoModelValues,
    imageListToVideoImageModelValues,
    imageListToVideoVideoModelValues,
  } = useDeploymentModelAvailability();
  const textVideoModels = useMemo(
    () => (
      isDockerModelFilteringEnabled
        ? filterOptionsForDeploymentModelValues(TEXT_MODELS, textToVideoVideoModelValues)
        : TEXT_MODELS
    ),
    [isDockerModelFilteringEnabled, textToVideoVideoModelValues]
  );
  const textImageModels = useMemo(
    () => (
      isDockerModelFilteringEnabled
        ? filterOptionsForDeploymentModelValues(IMAGE_MODELS, textToVideoImageModelValues)
        : IMAGE_MODELS
    ),
    [isDockerModelFilteringEnabled, textToVideoImageModelValues]
  );
  const imageListVideoModels = useMemo(
    () => (
      isDockerModelFilteringEnabled
        ? filterOptionsForDeploymentModelValues(IMAGE_LIST_VIDEO_MODELS, imageListToVideoVideoModelValues)
        : IMAGE_LIST_VIDEO_MODELS
    ),
    [imageListToVideoVideoModelValues, isDockerModelFilteringEnabled]
  );
  const imageListImageModels = useMemo(
    () => (
      isDockerModelFilteringEnabled
        ? filterOptionsForDeploymentModelValues(IMAGE_MODELS, imageListToVideoImageModelValues)
        : IMAGE_MODELS
    ),
    [imageListToVideoImageModelValues, isDockerModelFilteringEnabled]
  );

  useEffect(() => {
    setTextForm((current) => ({
      ...current,
      video_model: textVideoModels.some((model) => model.value === current.video_model)
        ? current.video_model
        : textVideoModels[0]?.value || '',
      image_model: textImageModels.some((model) => model.value === current.image_model)
        ? current.image_model
        : textImageModels[0]?.value || '',
    }));
  }, [textImageModels, textVideoModels]);

  useEffect(() => {
    setImageForm((current) => ({
      ...current,
      video_model: imageListVideoModels.some((model) => model.value === current.video_model)
        ? current.video_model
        : imageListVideoModels[0]?.value || '',
      image_model: imageListImageModels.some((model) => model.value === current.image_model)
        ? current.image_model
        : imageListImageModels[0]?.value || '',
    }));
  }, [imageListImageModels, imageListVideoModels]);

  const isTextVideoModelAvailable = textVideoModels.some((model) => model.value === textForm.video_model);
  const isTextImageModelAvailable = textImageModels.some((model) => model.value === textForm.image_model);
  const isImageListVideoModelAvailable = imageListVideoModels.some((model) => model.value === imageForm.video_model);
  const isImageListImageModelAvailable = imageListImageModels.some((model) => model.value === imageForm.image_model);

  const pendingRequests = useMemo(
    () => requests.filter((item) => !['COMPLETED', 'FAILED', 'CANCELLED', 'ARCHIVED'].includes(item.status)),
    [requests],
  );

  const callExternalApi = useCallback(async (config) => {
    const headers = getHeaders();
    if (!headers) {
      throw new Error('Please sign in again.');
    }

    const response = await axios({
      ...config,
      headers: {
        ...(headers.headers || {}),
        ...(config.headers || {}),
      },
    });

    return response.data;
  }, []);

  const loadDashboard = useCallback(async () => {
    if (!user?.isExternalUser) {
      setLoading(false);
      return;
    }

    try {
      const [creditsResponse, requestsResponse] = await Promise.all([
        callExternalApi({
          url: `${PROCESSOR_SERVER}/v1/external_users/credits`,
          method: 'GET',
        }),
        callExternalApi({
          url: `${PROCESSOR_SERVER}/v1/external_users/requests`,
          method: 'GET',
        }),
      ]);

      setCredits(creditsResponse);
      setRequests(Array.isArray(requestsResponse?.requests) ? requestsResponse.requests : []);
    } catch (error) {
      setNotice({
        tone: 'error',
        message: error?.response?.data?.message || error.message || 'Failed to load external dashboard.',
      });
    } finally {
      setLoading(false);
    }
  }, [callExternalApi, user?.isExternalUser]);

  useEffect(() => {
    if (userFetching) {
      return;
    }

    if (!user) {
      navigate('/login', { replace: true });
      return;
    }

    if (!user.isExternalUser) {
      navigate('/', { replace: true });
      return;
    }

    void loadDashboard();
  }, [loadDashboard, navigate, user, userFetching]);

  useEffect(() => {
    if (!pendingRequests.length) {
      if (pollingRef.current) {
        window.clearInterval(pollingRef.current);
        pollingRef.current = null;
      }
      return undefined;
    }

    pollingRef.current = window.setInterval(() => {
      void loadDashboard();
    }, 5000);

    return () => {
      if (pollingRef.current) {
        window.clearInterval(pollingRef.current);
        pollingRef.current = null;
      }
    };
  }, [loadDashboard, pendingRequests.length]);

  async function handleRecharge() {
    try {
      setNotice(null);
      const response = await callExternalApi({
        url: `${PROCESSOR_SERVER}/v1/external_users/credits/recharge`,
        method: 'POST',
        data: {
          input: {
            credits: Number(rechargeCredits),
          },
        },
      });

      if (response?.url) {
        window.open(response.url, '_blank', 'noopener,noreferrer');
      }

      setNotice({
        tone: 'success',
        message: `Opened checkout for ${formatCredits(response?.credits)} credits.`,
      });
      await loadDashboard();
    } catch (error) {
      setNotice({
        tone: 'error',
        message: error?.response?.data?.message || error.message || 'Failed to create recharge session.',
      });
    }
  }

  async function handleSubmitText() {
    try {
      if (!isTextVideoModelAvailable || !isTextImageModelAvailable) {
        throw new Error('Selected text-to-video model is not available for this configuration.');
      }

      setSubmittingMode('text');
      setNotice(null);
      await callExternalApi({
        url: `${PROCESSOR_SERVER}/v1/external_users/text_to_video`,
        method: 'POST',
        data: {
          input: {
            ...textForm,
            duration: Number(textForm.duration),
          },
        },
      });
      setNotice({
        tone: 'success',
        message: 'Text-to-video request submitted.',
      });
      setTextForm((current) => ({ ...current, prompt: '' }));
      await loadDashboard();
    } catch (error) {
      setNotice({
        tone: 'error',
        message: error?.response?.data?.message || error.message || 'Failed to submit text-to-video request.',
      });
    } finally {
      setSubmittingMode(null);
    }
  }

  async function handleSubmitImageList() {
    try {
      if (!imageFiles.length) {
        throw new Error('Add at least one image.');
      }
      if (!isImageListVideoModelAvailable || !isImageListImageModelAvailable) {
        throw new Error('Selected image-list-to-video model is not available for this configuration.');
      }

      setSubmittingMode('image');
      setNotice(null);
      const image_data = await Promise.all(imageFiles.map((file) => toDataUrl(file)));
      const uploadResponse = await callExternalApi({
        url: `${PROCESSOR_SERVER}/v1/external_users/upload_image_data`,
        method: 'POST',
        data: {
          input: {
            image_data,
          },
        },
      });

      await callExternalApi({
        url: `${PROCESSOR_SERVER}/v1/external_users/image_list_to_video`,
        method: 'POST',
        data: {
          input: {
            ...imageForm,
            duration: Number(imageForm.duration),
            image_urls: uploadResponse?.image_urls || [],
          },
        },
      });

      setNotice({
        tone: 'success',
        message: 'Image-list-to-video request submitted.',
      });
      setImageFiles([]);
      setImageForm((current) => ({ ...current, prompt: '' }));
      await loadDashboard();
    } catch (error) {
      setNotice({
        tone: 'error',
        message: error?.response?.data?.message || error.message || 'Failed to submit image-list-to-video request.',
      });
    } finally {
      setSubmittingMode(null);
    }
  }

  async function handlePublish(requestId) {
    try {
      setNotice(null);
      await callExternalApi({
        url: `${PROCESSOR_SERVER}/v1/external_users/publish`,
        method: 'POST',
        data: {
          input: {
            request_id: requestId,
          },
        },
      });
      setNotice({
        tone: 'success',
        message: 'Video published.',
      });
      await loadDashboard();
    } catch (error) {
      setNotice({
        tone: 'error',
        message: error?.response?.data?.message || error.message || 'Failed to publish video.',
      });
    }
  }

  async function handleArchive(requestId) {
    try {
      setNotice(null);
      await callExternalApi({
        url: `${PROCESSOR_SERVER}/v1/external_users/archive`,
        method: 'POST',
        data: {
          input: {
            request_id: requestId,
          },
        },
      });
      setNotice({
        tone: 'success',
        message: 'Video archived.',
      });
      await loadDashboard();
    } catch (error) {
      setNotice({
        tone: 'error',
        message: error?.response?.data?.message || error.message || 'Failed to archive video.',
      });
    }
  }

  function handleLogout() {
    resetUser();
    navigate('/login', { replace: true });
  }

  if (loading) {
    return <div className="p-10 text-center text-slate-500">Loading external studio…</div>;
  }

  if (!user?.isExternalUser) {
    return null;
  }

  return (
    <div className="min-h-screen bg-[#0a1020] px-4 py-10 text-slate-100">
      <div className="mx-auto max-w-6xl">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <div className="text-xs uppercase tracking-[0.25em] text-emerald-300/80">External Studio</div>
            <h1 className="mt-2 text-4xl font-semibold tracking-[-0.04em] text-white">
              {user.displayName || user.username || 'External user'}
            </h1>
            <p className="mt-2 max-w-2xl text-sm text-slate-400">
              Manage credits, generate videos, and review library items linked to this external account.
            </p>
          </div>

          <div className="flex flex-wrap items-center justify-end gap-3">
            <button
              type="button"
              onClick={handleLogout}
              className="rounded-full border border-white/15 bg-white/5 px-5 py-3 text-sm font-semibold text-slate-200 transition hover:bg-white/10"
            >
              Logout
            </button>

            <div className="rounded-3xl border border-white/10 bg-white/5 px-5 py-4">
              <div className="text-xs uppercase tracking-[0.2em] text-slate-400">Credits</div>
              <div className="mt-2 text-3xl font-semibold text-white">
                {formatCredits(credits?.remainingCredits ?? user.generationCredits ?? 0)}
              </div>
            </div>
          </div>
        </div>

        {notice ? (
          <div
            className={`mt-6 rounded-2xl border px-4 py-3 text-sm ${
              notice.tone === 'error'
                ? 'border-red-400/20 bg-red-500/10 text-red-100'
                : 'border-emerald-400/20 bg-emerald-500/10 text-emerald-100'
            }`}
          >
            {notice.message}
          </div>
        ) : null}

        <div className="mt-8 grid gap-6 lg:grid-cols-[minmax(0,1.1fr)_minmax(320px,0.9fr)]">
          <div className="space-y-6">
            <section className="rounded-3xl border border-white/10 bg-white/5 p-6">
              <h2 className="text-xl font-semibold text-white">Text to video</h2>
              <div className="mt-4 space-y-4">
                <textarea
                  value={textForm.prompt}
                  onChange={(event) => setTextForm((current) => ({ ...current, prompt: event.target.value }))}
                  placeholder="Describe the video you want to create."
                  className="min-h-36 w-full rounded-2xl border border-white/10 bg-[#0c1528] px-4 py-3 text-sm text-white outline-none"
                />
                <div className="grid gap-4 md:grid-cols-3">
                  <select
                    value={textForm.video_model}
                    onChange={(event) => setTextForm((current) => ({ ...current, video_model: event.target.value }))}
                    className="rounded-2xl border border-white/10 bg-[#0c1528] px-4 py-3 text-sm text-white"
                  >
                    {textVideoModels.map((model) => (
                      <option key={model.value} value={model.value}>{model.label}</option>
                    ))}
                  </select>
                  <select
                    value={textForm.image_model}
                    onChange={(event) => setTextForm((current) => ({ ...current, image_model: event.target.value }))}
                    className="rounded-2xl border border-white/10 bg-[#0c1528] px-4 py-3 text-sm text-white"
                  >
                    {textImageModels.map((model) => (
                      <option key={model.value} value={model.value}>{model.label}</option>
                    ))}
                  </select>
                  <select
                    value={textForm.duration}
                    onChange={(event) => setTextForm((current) => ({ ...current, duration: event.target.value }))}
                    className="rounded-2xl border border-white/10 bg-[#0c1528] px-4 py-3 text-sm text-white"
                  >
                    {DURATION_OPTIONS.map((duration) => (
                      <option key={duration} value={String(duration)}>{duration} seconds</option>
                    ))}
                  </select>
                </div>
                <label className="flex items-center gap-2 text-sm text-slate-300">
                  <input
                    type="checkbox"
                    checked={Boolean(textForm.enable_subtitles)}
                    onChange={(event) =>
                      setTextForm((current) => ({ ...current, enable_subtitles: event.target.checked }))
                    }
                  />
                  Enable subtitles
                </label>
                <button
                  type="button"
                  onClick={() => void handleSubmitText()}
                  disabled={submittingMode === 'text' || !textForm.prompt.trim() || !isTextVideoModelAvailable || !isTextImageModelAvailable}
                  className="rounded-full bg-emerald-400 px-5 py-3 text-sm font-semibold text-slate-950 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {submittingMode === 'text' ? 'Submitting…' : 'Generate text video'}
                </button>
              </div>
            </section>

            <section className="rounded-3xl border border-white/10 bg-white/5 p-6">
              <h2 className="text-xl font-semibold text-white">Image list to video</h2>
              <div className="mt-4 space-y-4">
                <input
                  type="file"
                  accept="image/*"
                  multiple
                  onChange={(event) => setImageFiles(Array.from(event.target.files || []))}
                  className="block w-full text-sm text-slate-300"
                />
                <div className="text-xs text-slate-500">
                  {imageFiles.length ? `${imageFiles.length} image(s) selected` : 'Upload ordered image frames'}
                </div>
                <textarea
                  value={imageForm.prompt}
                  onChange={(event) => setImageForm((current) => ({ ...current, prompt: event.target.value }))}
                  placeholder="Optional prompt to guide motion and pacing."
                  className="min-h-28 w-full rounded-2xl border border-white/10 bg-[#0c1528] px-4 py-3 text-sm text-white outline-none"
                />
                <div className="grid gap-4 md:grid-cols-3">
                  <select
                    value={imageForm.video_model}
                    onChange={(event) => setImageForm((current) => ({ ...current, video_model: event.target.value }))}
                    className="rounded-2xl border border-white/10 bg-[#0c1528] px-4 py-3 text-sm text-white"
                  >
                    {imageListVideoModels.map((model) => (
                      <option key={model.value} value={model.value}>{model.label}</option>
                    ))}
                  </select>
                  <select
                    value={imageForm.image_model}
                    onChange={(event) => setImageForm((current) => ({ ...current, image_model: event.target.value }))}
                    className="rounded-2xl border border-white/10 bg-[#0c1528] px-4 py-3 text-sm text-white"
                  >
                    {imageListImageModels.map((model) => (
                      <option key={model.value} value={model.value}>{model.label}</option>
                    ))}
                  </select>
                  <select
                    value={imageForm.duration}
                    onChange={(event) => setImageForm((current) => ({ ...current, duration: event.target.value }))}
                    className="rounded-2xl border border-white/10 bg-[#0c1528] px-4 py-3 text-sm text-white"
                  >
                    {DURATION_OPTIONS.map((duration) => (
                      <option key={duration} value={String(duration)}>{duration} seconds</option>
                    ))}
                  </select>
                </div>
                <label className="flex items-center gap-2 text-sm text-slate-300">
                  <input
                    type="checkbox"
                    checked={Boolean(imageForm.enable_subtitles)}
                    onChange={(event) =>
                      setImageForm((current) => ({ ...current, enable_subtitles: event.target.checked }))
                    }
                  />
                  Enable subtitles
                </label>
                <button
                  type="button"
                  onClick={() => void handleSubmitImageList()}
                  disabled={submittingMode === 'image' || imageFiles.length === 0 || !isImageListVideoModelAvailable || !isImageListImageModelAvailable}
                  className="rounded-full bg-emerald-400 px-5 py-3 text-sm font-semibold text-slate-950 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {submittingMode === 'image' ? 'Submitting…' : 'Generate image-list video'}
                </button>
              </div>
            </section>
          </div>

          <div className="space-y-6">
            <section className="rounded-3xl border border-white/10 bg-white/5 p-6">
              <h2 className="text-xl font-semibold text-white">Top up credits</h2>
              <div className="mt-4 space-y-4">
                <select
                  value={rechargeCredits}
                  onChange={(event) => setRechargeCredits(event.target.value)}
                  className="w-full rounded-2xl border border-white/10 bg-[#0c1528] px-4 py-3 text-sm text-white"
                >
                  {CREDIT_PACKS.map((creditsOption) => (
                    <option key={creditsOption} value={String(creditsOption)}>
                      {formatCredits(creditsOption)} credits
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  onClick={() => void handleRecharge()}
                  className="rounded-full border border-white/10 bg-white/10 px-5 py-3 text-sm font-semibold text-white"
                >
                  Open checkout
                </button>
              </div>
            </section>

            <section className="rounded-3xl border border-white/10 bg-white/5 p-6">
              <div className="flex items-center justify-between gap-4">
                <h2 className="text-xl font-semibold text-white">Your videos</h2>
                <button
                  type="button"
                  onClick={() => void loadDashboard()}
                  className="rounded-full border border-white/10 bg-white/10 px-4 py-2 text-xs font-semibold text-white"
                >
                  Refresh
                </button>
              </div>

              <div className="mt-4 space-y-4">
                {requests.length === 0 ? (
                  <div className="rounded-2xl border border-dashed border-white/10 px-4 py-8 text-sm text-slate-400">
                    No external videos yet.
                  </div>
                ) : (
                  requests.map((item) => (
                    <div key={item.request_id} className="rounded-2xl border border-white/10 bg-[#0c1528] p-4">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <div className="text-sm font-semibold text-white">{item.prompt || item.request_id}</div>
                          <div className="mt-1 text-xs uppercase tracking-[0.2em] text-slate-500">{item.status}</div>
                        </div>
                        <div className="text-xs text-slate-500">{formatDate(item.updated_at || item.created_at)}</div>
                      </div>
                      {item.video_url ? (
                        <video
                          className="mt-4 aspect-video w-full rounded-xl bg-black"
                          controls
                          preload="metadata"
                          src={item.video_url}
                        />
                      ) : null}
                      <div className="mt-4 flex flex-wrap gap-2">
                        {item.video_url ? (
                          <a
                            href={item.video_url}
                            target="_blank"
                            rel="noreferrer"
                            className="rounded-full border border-white/10 bg-white/10 px-3 py-2 text-xs font-semibold text-white"
                          >
                            Open
                          </a>
                        ) : null}
                        {!item.is_published && item.video_url ? (
                          <button
                            type="button"
                            onClick={() => void handlePublish(item.request_id)}
                            className="rounded-full border border-white/10 bg-white/10 px-3 py-2 text-xs font-semibold text-white"
                          >
                            Publish
                          </button>
                        ) : null}
                        <button
                          type="button"
                          onClick={() => void handleArchive(item.request_id)}
                          className="rounded-full border border-white/10 bg-white/10 px-3 py-2 text-xs font-semibold text-white"
                        >
                          Archive
                        </button>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </section>
          </div>
        </div>
      </div>
    </div>
  );
}
