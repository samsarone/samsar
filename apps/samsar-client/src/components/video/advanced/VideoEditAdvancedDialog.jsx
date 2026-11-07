import { useUiLanguage } from '../../../hooks/useUiLanguage.js';
import { translateText as uiText } from '../../../utils/localization.js';
import { useState } from 'react';
import axios from 'axios';
import { FaCopy, FaDownload, FaSpinner, FaTimes } from 'react-icons/fa';
import { useColorMode } from '../../../contexts/ColorMode.jsx';
import { getHeaders } from '../../../utils/web.jsx';
import {
  buildHintsText,
  buildTranscriptText,
  normalizeSessionId,
} from '../../../utils/sessionTimelineText.js';

const PROCESSOR_API_URL = import.meta.env.VITE_PROCESSOR_API;

function getErrorMessage(error) {
  return (
    error?.response?.data?.message ||
    error?.response?.data?.error ||
    error?.message ||
    uiText("Unable to complete this advanced action.")
  );
}

function downloadTextFile({ fileName, text }) {
  const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

export default function VideoEditAdvancedDialog({
  sessionId,
  currentSession = null,
  onClose,
  onRequestAccepted,
}) {
  useUiLanguage();
  const { colorMode } = useColorMode();
  const resolvedSessionId = normalizeSessionId(sessionId || currentSession?._id || currentSession?.id);
  const [pendingAction, setPendingAction] = useState(null);
  const [errorMessage, setErrorMessage] = useState('');
  const isCopyingSession = pendingAction === 'copy_session';
  const isDownloadingTranscript = pendingAction === 'download_transcript';
  const isDownloadingHints = pendingAction === 'download_hints';

  const surfaceClass = 'bg-surface text-fg border border-line';
  const mutedClass = 'text-fg-muted';
  const cardClass = `border-line ${colorMode === 'dark' ? 'bg-[#12141c]' : 'bg-slate-50'}`;
  const iconClass = colorMode === 'dark'
    ? 'bg-[#f6c453]/14 text-[#ffe0a3]'
    : 'bg-sky-100 text-sky-700';
  const secondaryButtonClass = `border border-line-control bg-surface-raised text-fg-body ${colorMode === 'dark' ? 'hover:bg-[#292d3a]' : 'hover:bg-slate-50'}`;
  const primaryButtonClass = `text-on-accent ${colorMode === 'dark' ? 'bg-[#ff4655] hover:bg-[#ff6572]' : 'bg-blue-600 hover:bg-blue-700'}`;
  const optionButtonClass = `border border-line-control bg-surface-raised text-fg-body ${colorMode === 'dark' ? 'hover:bg-[#292d3a]' : 'hover:bg-slate-50'}`;

  const getLatestSessionDetails = async () => {
    if (!resolvedSessionId) {
      return currentSession;
    }

    try {
      const headers = getHeaders();
      const response = await axios.get(
        `${PROCESSOR_API_URL}/video_sessions/session_details?id=${resolvedSessionId}`,
        headers
      );
      return response?.data || currentSession;
    } catch {
      return currentSession;
    }
  };

  const submitCopySession = async () => {
    const headers = getHeaders();
    if (!headers) {
      setErrorMessage(uiText("Sign in before copying this session."));
      return;
    }

    if (!resolvedSessionId) {
      setErrorMessage(uiText("Session id is required."));
      return;
    }

    setPendingAction('copy_session');
    setErrorMessage('');

    try {
      const response = await axios.post(
        `${PROCESSOR_API_URL}/video_sessions/_copy_session`,
        { sessionId: resolvedSessionId },
        headers
      );
      const responseData = response?.data || {};
      const nextSessionId = normalizeSessionId(
        responseData.session_id ||
        responseData.sessionId ||
        responseData.session?._id ||
        responseData.session?.id
      );

      if (!nextSessionId) {
        throw new Error(uiText("Copy completed without a new session id."));
      }

      if (typeof onRequestAccepted === 'function') {
        onRequestAccepted({
          operation: 'copy_session',
          requestId: nextSessionId,
          sessionId: nextSessionId,
          status: 'COMPLETED',
          response: responseData,
        });
      }
    } catch (error) {
      setErrorMessage(getErrorMessage(error));
    } finally {
      setPendingAction(null);
    }
  };

  const downloadTranscript = async () => {
    if (!resolvedSessionId && !currentSession) {
      setErrorMessage(uiText("Session details are not available."));
      return;
    }

    setPendingAction('download_transcript');
    setErrorMessage('');

    try {
      const sessionDetails = await getLatestSessionDetails();
      const transcriptText = buildTranscriptText(sessionDetails);

      if (!transcriptText) {
        setErrorMessage(uiText("No subtitle transcript is available for this session."));
        return;
      }

      const fileSessionId = normalizeSessionId(sessionDetails?._id || sessionDetails?.id || resolvedSessionId) || 'session';
      downloadTextFile({
        fileName: `samsar-transcript-${fileSessionId}.txt`,
        text: transcriptText,
      });
    } catch (error) {
      setErrorMessage(getErrorMessage(error));
    } finally {
      setPendingAction(null);
    }
  };

  const downloadHints = async () => {
    if (!resolvedSessionId && !currentSession) {
      setErrorMessage(uiText("Session details are not available."));
      return;
    }

    setPendingAction('download_hints');
    setErrorMessage('');

    try {
      const sessionDetails = await getLatestSessionDetails();
      const hintsText = buildHintsText(sessionDetails);

      if (!hintsText) {
        setErrorMessage(uiText("No hints are available for this session."));
        return;
      }

      const fileSessionId = normalizeSessionId(sessionDetails?._id || sessionDetails?.id || resolvedSessionId) || 'session';
      downloadTextFile({
        fileName: `samsar-hints-${fileSessionId}.txt`,
        text: hintsText,
      });
    } catch (error) {
      setErrorMessage(getErrorMessage(error));
    } finally {
      setPendingAction(null);
    }
  };

  const renderOption = ({ icon, title, description, buttonLabel, onClick, isPending, primary = false }) => (
    <div className={`rounded-xl border p-3 ${cardClass}`}>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start">
        <div className={`mt-0.5 inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl ${iconClass}`}>
          {icon}
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-sm font-semibold">{title}</div>
          <div className={`mt-1 text-xs leading-5 ${mutedClass}`}>
            {description}
          </div>
        </div>
        <button
          type="button"
          className={`inline-flex shrink-0 items-center gap-2 self-start rounded-lg px-3 py-2 text-xs font-semibold transition disabled:cursor-not-allowed disabled:opacity-60 sm:self-auto ${primary ? primaryButtonClass : optionButtonClass}`}
          onClick={onClick}
          disabled={Boolean(pendingAction)}
        >
          {isPending ? <FaSpinner className="animate-spin" /> : null}
          {buttonLabel}
        </button>
      </div>
    </div>
  );

  return (
    <div className={`relative w-[min(92vw,520px)] rounded-2xl p-5 text-left shadow-2xl ${surfaceClass}`}>
      <button
        type="button"
        className={`absolute right-4 top-4 rounded-full p-2 ${secondaryButtonClass}`}
        onClick={onClose}
        aria-label={uiText("Close")}
      >
        <FaTimes />
      </button>

      <div className="pr-12">
        <h2 className="text-lg font-semibold">{uiText("Advanced options")}</h2>
        <div className={`mt-1 truncate text-xs ${mutedClass}`}>{uiText("Session {value0}", { value0: resolvedSessionId || '-' })}</div>
      </div>

      <div className="mt-5 grid gap-3">
        {renderOption({
          icon: <FaCopy />,
          title: uiText("Deep clone session"),
          description: uiText("Creates a new editable session with copied timeline data and assets."),
          buttonLabel: uiText('Clone'),
          onClick: submitCopySession,
          isPending: isCopyingSession,
          primary: true,
        })}
        {renderOption({
          icon: <FaDownload />,
          title: uiText("Download transcripts"),
          description: uiText("Downloads the available subtitle transcript with timeline timestamps."),
          buttonLabel: uiText('Download'),
          onClick: downloadTranscript,
          isPending: isDownloadingTranscript,
        })}
        {renderOption({
          icon: <FaDownload />,
          title: uiText("Download hints"),
          description: uiText("Downloads the available speech hints with timeline timestamps."),
          buttonLabel: uiText('Download'),
          onClick: downloadHints,
          isPending: isDownloadingHints,
        })}
      </div>

      {errorMessage && (
        <div className="mt-4 rounded-lg border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-sm text-rose-300">
          {errorMessage}
        </div>
      )}

      <div className="mt-5 flex flex-wrap justify-end gap-3">
        <button
          type="button"
          className={`rounded-lg px-4 py-2 text-sm font-semibold transition ${secondaryButtonClass}`}
          onClick={onClose}
        >{uiText("Close")}</button>
      </div>
    </div>
  );
}
