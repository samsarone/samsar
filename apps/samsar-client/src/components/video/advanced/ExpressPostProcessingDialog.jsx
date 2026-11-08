import { useEffect, useRef, useState } from 'react';
import { Dialog, DialogPanel, DialogTitle } from '@headlessui/react';
import { FaTimes } from 'react-icons/fa';
import axios from 'axios';
import ExpressPostProcessingPanel from '../../oneshot_editor/ExpressPostProcessingPanel.jsx';
import { buildExpressPostProcessingRequest, createDefaultPostProcessingForm, sessionHasOutroImage } from '../../oneshot_editor/expressPostProcessing.js';
import { getRerollCandidateLayers, getRerollLocalCreditEstimate, normalizeRerollLayerIndexes } from '../../oneshot_editor/RerollScenePreview.jsx';
import { useUser } from '../../../contexts/UserContext.jsx';
import { useDeploymentModelAvailability } from '../../../hooks/useDeploymentModelAvailability.js';
import { useUiLanguage } from '../../../hooks/useUiLanguage.js';
import { translateText as uiText } from '../../../utils/localization.js';
import { getHeaders } from '../../../utils/web.jsx';
import { resolveSessionAudioLanguage, resolveSubtitleRegenerationDefault } from '../../../utils/subtitleRegenerationLanguage.mjs';
import { getVideoPostProcessingRequestUrls, isMissingVideoPostProcessingRoute } from '../../../utils/videoPostProcessingApi.mjs';
import { inferSavedInferenceEffort } from '../../common/InferenceEffortSelect.jsx';

const API_SERVER = import.meta.env.VITE_PROCESSOR_API;

export default function ExpressPostProcessingDialog({ session, onClose, onRequestAccepted, openAdvancedVideoEditDialog, showLoginDialog }) {
  useUiLanguage();
  const { user, getUserAPI } = useUser();
  const { isStandaloneDeployment, hasSubtitleGenerationCredentials } = useDeploymentModelAvailability();
  const canGenerateSubtitles = !isStandaloneDeployment || hasSubtitleGenerationCredentials;
  const [action, setAction] = useState('generated_outro');
  const [form, setForm] = useState(() => ({ ...createDefaultPostProcessingForm(), subtitleLanguage: resolveSubtitleRegenerationDefault(session) || '' }));
  const [pending, setPending] = useState('');
  const [error, setError] = useState('');
  const [playing, setPlaying] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState('');
  const mounted = useRef(false);
  const busy = useRef(false);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);
  const id = session?._id;
  const candidateLayers = getRerollCandidateLayers(session);
  const indexes = normalizeRerollLayerIndexes(form.rerollLayerIndexes);
  const audioLanguage = resolveSessionAudioLanguage(session);
  const updateField = (field, value) => {
    setForm(current => ({ ...current, [field]: value }));
    setError('');
  };
  const submit = async (actionKey) => {
    if (busy.current || !id) return;
    const headers = getHeaders();
    if (!user || !headers) { onClose(); showLoginDialog?.(); return; }
    try {
      const operation = buildExpressPostProcessingRequest({
        actionKey, id, postProcessingForm: form, currentRenderHasOutro: sessionHasOutroImage(session),
        canGenerateSubtitles, postProcessingAudioLanguage: audioLanguage, rerollLayerIndexes: indexes,
        inferenceModel: user.selectedInferenceModel, inferenceEffort: inferSavedInferenceEffort(user),
      });
      if (!operation) return;
      busy.current = true;
      setPending(actionKey);
      setError('');
      setPlaying(null);
      const { endpoint, payload } = operation;
      const { primaryUrl, legacyUrl } = getVideoPostProcessingRequestUrls(API_SERVER, endpoint);
      let response;
      try {
        response = await axios.post(primaryUrl, { input: payload }, headers);
      } catch (requestError) {
        if (!mounted.current) return;
        if (!['add_subtitles', 'remove_subtitles'].includes(endpoint) || !isMissingVideoPostProcessingRoute(requestError, primaryUrl)) throw requestError;
        response = await axios.post(legacyUrl, { input: payload }, headers);
      }
      if (!mounted.current) return;
      const data = response.data;
      const sessionId = data?.sessionID || data?.session_id || data?.sessionId || data?.request_id;
      const requestId = data?.request_id || sessionId;
      if (!requestId) throw new Error(uiText('Post-processing did not return a request id.'));
      getUserAPI?.();
      onRequestAccepted({ sessionId, requestId, status: data?.status, pollMode: 'status' });
    } catch (requestError) {
      if (mounted.current) setError(requestError?.response?.data?.message || requestError?.message || uiText('Unable to start post-processing.'));
    } finally {
      busy.current = false;
      if (mounted.current) setPending('');
    }
  };
  const uploadImage = async (event) => {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = '';
    if (!file || busy.current) return;
    if (!file.type?.startsWith('image/')) { setUploadError(uiText('Upload an image file.')); return; }
    const headers = getHeaders();
    if (!user || !headers) { onClose(); showLoginDialog?.(); return; }
    busy.current = true;
    setUploading(true);
    setUploadError('');
    try {
      const imageData = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = () => reject(new Error(uiText('CTA image upload failed.')));
        reader.readAsDataURL(file);
      });
      if (!mounted.current) return;
      const { data } = await axios.post(`${API_SERVER}/v2/upload_image_data`, { input: { image_data: [imageData] } }, headers);
      if (!mounted.current) return;
      const url = data?.image_urls?.find(value => typeof value === 'string' && value.trim());
      if (!url) throw new Error(uiText('Upload did not return an image URL.'));
      updateField('outroCtaImageUrl', url.trim());
    } catch (uploadFailure) {
      if (mounted.current) setUploadError(uploadFailure?.response?.data?.message || uploadFailure?.message || uiText('CTA image upload failed.'));
    } finally {
      busy.current = false;
      if (mounted.current) setUploading(false);
    }
  };
  return (
    <Dialog open onClose={() => { if (!busy.current) onClose(); }} className="relative z-[10000]">
      <div className="fixed inset-0 bg-black/70 backdrop-blur-sm" aria-hidden="true" />
      <div className="fixed inset-0 flex items-center justify-center p-3 sm:p-6">
        <DialogPanel className="max-h-[calc(100dvh-3rem)] w-full max-w-5xl overflow-y-auto rounded-2xl border border-line bg-surface p-4 text-left text-fg shadow-xl">
          <div className="mb-3 flex items-center justify-between gap-3">
            <DialogTitle className="font-semibold">{uiText('Express edits')}</DialogTitle>
            <button type="button" aria-label={uiText('Close dialog')} onClick={onClose} disabled={Boolean(pending) || uploading} className="rounded-lg p-2 hover:bg-surface-hover disabled:opacity-50"><FaTimes /></button>
          </div>
          <ExpressPostProcessingPanel
            currentRenderHasOutro={sessionHasOutroImage(session)} postProcessingAction={action}
            postProcessingForm={form} postProcessingPendingAction={pending || (uploading ? 'upload_image' : '')}
            postProcessingAudioLanguage={audioLanguage} canGenerateSubtitles={canGenerateSubtitles}
            rerollCandidateLayers={candidateLayers} rerollLayerIndexes={indexes}
            rerollLocalCreditEstimate={getRerollLocalCreditEstimate({ layerIndexes: indexes, candidateLayers })}
            isRerollPreviewRefreshing={false} playingRerollLayerId={playing}
            postProcessingError={error} postProcessingMessage=""
            selectPostProcessingAction={value => { setAction(value); setError(''); setPlaying(null); }}
            updatePostProcessingFormField={updateField} submitPostProcessingOperation={submit}
            setOutroCtaImageUploadError={setUploadError} uploadingOutroCtaImage={uploading}
            outroCtaImageUploadError={uploadError} handleOutroCtaImageUploadInput={uploadImage}
            openAdvancedVideoEditDialog={() => { onClose(); openAdvancedVideoEditDialog(); }}
            toggleRerollLayerIndex={index => updateField('rerollLayerIndexes', indexes.includes(index) ? indexes.filter(value => value !== index) : [...indexes, index])}
            toggleRerollLayerPlayback={layerId => setPlaying(value => value === layerId ? null : layerId)}
          />
        </DialogPanel>
      </div>
    </Dialog>
  );
}
