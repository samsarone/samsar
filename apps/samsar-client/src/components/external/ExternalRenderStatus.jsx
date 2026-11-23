import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import axios from 'axios';
import { useUiLanguage } from '../../hooks/useUiLanguage.js';
import { boundedGet } from '../../utils/deduplicatedGet.mjs';
import { formatUiStatus, translateText as uiText } from '../../utils/localization.js';
import { resolveVideoGenerationErrorMessage } from '../../utils/videoGenerationStatus.mjs';
import { isExternalRenderActive } from '../../utils/vidgenieRouting.js';
import { getHeaders } from '../../utils/web.jsx';

export default function ExternalRenderStatus({ requestId, apiServer }) {
  useUiLanguage();
  const [render, setRender] = useState(null);
  const [loadError, setLoadError] = useState('');
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    let timer;
    async function refresh() {
      const headers = getHeaders();
      if (!headers) {
        setRender(null);
        setLoadError(uiText('Please sign in again.'));
        return;
      }
      try {
        const { data } = await boundedGet(axios, `${apiServer}/v1/external_users/status`, {
          ...headers, params: { request_id: requestId }, signal: controller.signal,
        });
        if (controller.signal.aborted) return;
        if (!data?.status) throw new Error(uiText('The project could not be loaded. Please try again.'));
        setRender(data);
        setLoadError('');
        if (isExternalRenderActive(data.status)) timer = window.setTimeout(refresh, 5000);
      } catch (error) {
        if (controller.signal.aborted) return;
        setLoadError(error?.response?.data?.message || uiText('The project could not be loaded. Please try again.'));
        const httpStatus = error?.response?.status;
        if (!httpStatus || httpStatus >= 500 || httpStatus === 429) {
          timer = window.setTimeout(refresh, 5000);
        } else {
          setRender(null);
        }
      }
    }
    setLoadError('');
    void refresh();
    return () => {
      controller.abort();
      window.clearTimeout(timer);
    };
  }, [apiServer, requestId, attempt]);

  const status = render?.status?.toUpperCase();
  const failure = ['FAILED', 'ERROR', 'TIMEOUT', 'CANCELLED', 'CANCELED'].includes(status)
    ? resolveVideoGenerationErrorMessage(render) : '';
  const statusText = status === 'PAUSED' ? uiText('Paused') : formatUiStatus(status === 'IN_PROGRESS' ? 'PROCESSING' : status);
  const linkClass = 'inline-flex min-h-11 items-center rounded-full border border-line px-5 text-sm font-medium text-fg hover:bg-surface-raised';

  return (
    <main className="mx-auto max-w-3xl py-4 text-fg sm:py-8">
      <h1 className="text-3xl font-semibold">{uiText('Render status')}</h1>
      <div role="status" className="mt-4 text-lg text-fg-muted">
        {render ? statusText : !loadError && uiText('Loading...')}
      </div>
      {failure && <p className="mt-2 break-words text-fg-muted">{failure}</p>}
      {render?.result_url && (
        <video controls playsInline preload="metadata" className="mt-5 max-h-[65vh] w-full rounded-2xl bg-black" src={render.result_url} />
      )}
      {loadError && (
        <div role="alert" className="mt-4 space-y-3">
          <p>{loadError}</p>
          <button type="button" className={linkClass} onClick={() => setAttempt(value => value + 1)}>{uiText('Try again')}</button>
        </div>
      )}
      <nav className="mt-6 flex flex-wrap gap-3">
        <Link className={linkClass} to="/create">{uiText('Create')}</Link>
        <Link className={linkClass} to="/external/studio">{uiText('External Studio')}</Link>
      </nav>
    </main>
  );
}
