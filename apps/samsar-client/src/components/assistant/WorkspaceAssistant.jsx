import { useEffect, useState } from 'react';
import axios from 'axios';
import AssistantHome from './AssistantHome.jsx';
import { getHeaders } from '../../utils/web.jsx';
import { useAssistantRequestGuard } from '../../hooks/useAssistantRequestGuard.js';
import { translateText as uiText } from '../../utils/localization.js';

const api = import.meta.env.VITE_PROCESSOR_API;
// Audio Studio has no video-session ID. Reuse the same assistant queue/SSE/billing flow
// with an owner-scoped conversation, without creating a media project.
export default function WorkspaceAssistant({ context, ownerId }) {
  const [opened, setOpened] = useState(false);
  const [id, setId] = useState(null);
  const [messages, setMessages] = useState([]);
  const [ready, setReady] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(0);
  const guard = useAssistantRequestGuard(id);
  useEffect(() => {
    let current = true;
    if (!ownerId || !opened) return;
    setError('');
    axios.post(`${api}/assistants/workspace`, { workspace: 'audio' }, getHeaders()).then(response => {
      if (current) setId(response.data.id);
    }).catch(() => { if (current) setError(uiText('Unable to load. Please try again.')); });
    return () => { current = false; };
  }, [ownerId, retry, opened]);

  const start = () => {
    const token = guard.capture();
    const apply = snapshot => {
      if (!guard.isCurrent(token) || !guard.acceptSession(snapshot)) return;
      setReady(true);
      setMessages(guard.messages(snapshot));
      setPending(Boolean(snapshot.sessionMessageGenerationPending));
      if (!snapshot.sessionMessageGenerationPending) guard.invalidate();
    };
    const poll = async () => {
      try {
        const response = await axios.get(`${api}/assistants/assistant_query_status?id=${encodeURIComponent(id)}&workspace=audio&include_messages=true`, getHeaders());
        apply(response.data.sessionDetails);
      } catch (failure) { if (guard.isCurrent(token) && guard.stopOnAccessError(failure)) setPending(false); }
    };
    guard.subscribe({ url: `${api}/assistants/assistant_query_stream?id=${encodeURIComponent(id)}&workspace=audio`,
      headers: getHeaders()?.headers, onSnapshot: apply });
    guard.setInterval(poll, 1500);
    void poll();
  };
  useEffect(() => { if (id) start(); return () => guard.invalidate(); }, [id]);

  const submit = async query => {
    if (!id) return;
    const token = guard.beginRequest();
    setPending(true); setError('');
    try {
      await axios.post(`${api}/assistants/submit_assistant_query`, { id, query, workspace: 'audio',
        assistantContext: context, stream: true, client_request_id: crypto.randomUUID(), assistantSessionVersion: token.serverVersion }, getHeaders());
      if (guard.isCurrent(token)) start();
    } catch {
      if (guard.isCurrent(token)) { setPending(false); setError(uiText('Unable to send message. Please try again.')); }
    }
  };
  return <>
    {error && <div role="alert" className="fixed bottom-20 right-4 z-50 rounded-lg bg-slate-900 p-3 text-sm text-white">
      {error}{!id && <button type="button" className="ml-2 underline" onClick={() => setRetry(value => value + 1)}>{uiText('Retry')}</button>}
    </div>}
    <AssistantHome sessionId={id} workspace="audio" sessionMessages={messages} isAssistantQueryGenerating={pending || (opened && !ready)} onOpen={() => setOpened(true)}
      submitAssistantQuery={submit} onSessionMessagesChange={setMessages} onAssistantQueryGeneratingChange={setPending}
      onSessionCleared={guard.invalidate} />
  </>;
}
