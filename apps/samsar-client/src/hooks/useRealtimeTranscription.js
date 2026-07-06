import { useCallback, useEffect, useRef, useState } from 'react';
import axios from 'axios';
import { getHeaders } from '../utils/web.jsx';

const DEFAULT_REALTIME_MODEL = 'gpt-4o-realtime-preview';
const REALTIME_BASE_URL = 'https://api.openai.com/v1/realtime';
const TEXT_DELTA_TYPES = new Set([
  'output_text_delta',
  'input_text_delta',
  'transcript.delta',
  'transcript_delta',
  'output_text.delta',
  'input_text.delta',
  'response.output_text.delta',
  'response.input_text.delta',
]);
const TEXT_FULL_TYPES = new Set([
  'output_text',
  'input_text',
  'transcript',
  'transcript.final',
  'response.output_text',
  'response.input_text',
]);
const TRANSCRIPT_EVENT_TYPES = new Set([
  'transcript.delta',
  'transcript.updated',
  'transcript.completed',
  'input_text.delta',
  'input_text.updated',
  'input_text.completed',
  'input_text',
  'input_text_delta',
  'input_text_completion',
  'response.delta',
  'response.completed',
  'response.updated',
  'response.output_text',
  'conversation.item.completed',
]);

function isMediaSupported() {
  return typeof window !== 'undefined' &&
    !!window.navigator?.mediaDevices?.getUserMedia;
}

function safelyExtractText(nodes, acceptedTypes) {
  if (!nodes) return '';
  if (typeof nodes === 'string') {
    return nodes;
  }

  const queue = Array.isArray(nodes) ? [...nodes] : [nodes];
  const segments = [];

  while (queue.length) {
    const node = queue.shift();
    if (!node || typeof node !== 'object') continue;

    const { type } = node;
    const isAcceptedType = type ? acceptedTypes.has(type) : false;

    const pushText = (value) => {
      if (typeof value === 'string' && value.trim().length) {
        segments.push(value);
      }
    };

    if (isAcceptedType || !type) {
      pushText(node.value);
      pushText(node.transcript);

      if (typeof node.text === 'string') {
        pushText(node.text);
      } else if (node.text && typeof node.text === 'object') {
        pushText(node.text.content);
      }

      if (typeof node.delta === 'string') {
        pushText(node.delta);
      } else if (node.delta && typeof node.delta === 'object') {
        pushText(node.delta.content);
        pushText(node.delta.text);
        if (node.delta.text && typeof node.delta.text === 'object') {
          pushText(node.delta.text.content);
        }
      }
    }

    if (
      !isAcceptedType &&
      type &&
      !segments.length &&
      node.text &&
      typeof node.text === 'object'
    ) {
      pushText(node.text.content);
    }

    if (typeof node.content === 'string') {
      pushText(node.content);
    }
    if (Array.isArray(node.content)) queue.push(...node.content);
    if (Array.isArray(node.items)) queue.push(...node.items);
    if (Array.isArray(node.output)) queue.push(...node.output);
    if (Array.isArray(node.segments)) queue.push(...node.segments);
    if (Array.isArray(node.alternatives)) queue.push(...node.alternatives);
    if (Array.isArray(node.children)) queue.push(...node.children);
    if (Array.isArray(node.payload)) queue.push(...node.payload);

    if (node.delta && typeof node.delta === 'object') {
      queue.push(node.delta);
      if (Array.isArray(node.delta.content)) queue.push(...node.delta.content);
    }
    if (node.message && typeof node.message === 'object') queue.push(node.message);
  }

  return segments.join('');
}

function resolveEphemeralKey(payload) {
  if (!payload) return { token: null, model: null, url: null };

  const token =
    payload?.token ||
    payload?.key ||
    payload?.ephemeral_key ||
    payload?.client_secret?.value ||
    payload?.client_secret?.secret ||
    payload?.clientSecret?.value ||
    payload?.clientSecret;

  const model = payload?.model || payload?.default_model || null;
  const url =
    payload?.url ||
    payload?.endpoint ||
    payload?.realtime_url ||
    payload?.client_secret?.url ||
    null;

  return { token, model, url };
}

function useRealtimeTranscription({
  transcriptEndpoint,
  transcriptHeaders,
  onTranscription,
  onSessionStarted,
  onSessionEnded,
  onError,
  model: preferredModel = DEFAULT_REALTIME_MODEL,
} = {}) {
  const [isSupported] = useState(isMediaSupported());
  const [isInitializing, setIsInitializing] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [error, setError] = useState(null);

  const peerConnectionRef = useRef(null);
  const dataChannelRef = useRef(null);
  const microphoneStreamRef = useRef(null);
  const remoteAudioRef = useRef(null);
  const transcriptBufferRef = useRef('');
  const mountedRef = useRef(true);

  const cleanupSession = useCallback(() => {
    try {
      if (dataChannelRef.current) {
        dataChannelRef.current.onclose = null;
        dataChannelRef.current.onmessage = null;
        if (dataChannelRef.current.readyState !== 'closed') {
          dataChannelRef.current.close();
        }
      }
    } catch {
      /* noop */
    }
    dataChannelRef.current = null;

    try {
      if (peerConnectionRef.current) {
        peerConnectionRef.current.ontrack = null;
        peerConnectionRef.current.onconnectionstatechange = null;
        peerConnectionRef.current.close();
      }
    } catch {
      /* noop */
    }
    peerConnectionRef.current = null;

    if (microphoneStreamRef.current) {
      microphoneStreamRef.current.getTracks().forEach((track) => {
        try { track.stop(); } catch { /* noop */ }
      });
    }
    microphoneStreamRef.current = null;

    if (remoteAudioRef.current) {
      try { remoteAudioRef.current.srcObject = null; } catch { /* noop */ }
      remoteAudioRef.current = null;
    }

    transcriptBufferRef.current = '';
  }, []);

  useEffect(() => () => {
    mountedRef.current = false;
    cleanupSession();
  }, [cleanupSession]);

  const stopTranscription = useCallback(() => {
    cleanupSession();
    if (mountedRef.current) {
      setIsRecording(false);
      setIsInitializing(false);
    }
    if (mountedRef.current) {
      onSessionEnded?.();
    }
  }, [cleanupSession, onSessionEnded]);

  const handleRealtimeMessage = useCallback((rawEvent) => {
    if (!rawEvent?.data) return;
    let payload;
    try {
      payload = JSON.parse(rawEvent.data);
    } catch  {
      // Ignore malformed realtime payloads.
      return;
    }

    if (payload.type === 'error') {
      const message =
        payload?.error?.message || 'Unexpected error from realtime session.';
      setError(message);
      onError?.(message);
      stopTranscription();
      return;
    }

    const isDelta =
      typeof payload.type === 'string' && payload.type.includes('delta');

    const extractText = (...candidates) => {
      for (const candidate of candidates) {
        const text = safelyExtractText(candidate, TEXT_DELTA_TYPES);
        if (text?.length) return text;
      }
      for (const candidate of candidates) {
        const text = safelyExtractText(candidate, TEXT_FULL_TYPES);
        if (text?.length) return text;
      }
      return '';
    };

    const isTranscriptEvent =
      TRANSCRIPT_EVENT_TYPES.has(payload.type) ||
      !!payload?.transcript ||
      !!payload?.input_text ||
      payload?.role === 'input_text';

    if (!isTranscriptEvent) {
      return;
    }

    let textChunk = '';
    if (payload.type === 'response.delta') {
      textChunk = extractText(
        payload?.response?.delta?.content,
        payload?.delta?.content,
        payload?.response?.delta,
        payload?.delta,
      );
    } else if (
      payload.type === 'response.completed' ||
      payload.type === 'response.updated' ||
      payload.type === 'response.output_text'
    ) {
      textChunk = extractText(
        payload?.response?.output,
        payload?.response?.content,
        payload?.response,
      );
    } else if (payload.type === 'conversation.item.completed') {
      textChunk = extractText(
        payload?.item?.content,
        payload?.item?.messages,
        payload?.item,
      );
    } else if (
      payload.type === 'transcript.delta' ||
      payload.type === 'transcript.updated'
    ) {
      textChunk = extractText(
        payload?.delta?.content,
        payload?.delta,
        payload?.transcript?.delta,
      );
    } else if (payload.type === 'transcript.completed') {
      textChunk = extractText(
        payload?.transcript?.content,
        payload?.transcript,
      );
    } else if (isDelta) {
      textChunk = extractText(payload, payload?.delta, payload?.content);
    }

    if (!textChunk) {
      if (!isDelta && transcriptBufferRef.current) {
        onTranscription?.(transcriptBufferRef.current, true);
      }
      return;
    }

    if (isDelta) {
      const previous = transcriptBufferRef.current || '';
      if (textChunk.length >= previous.length && textChunk.startsWith(previous)) {
        transcriptBufferRef.current = textChunk;
      } else if (previous.length && previous.startsWith(textChunk)) {
        transcriptBufferRef.current = previous;
      } else {
        transcriptBufferRef.current = `${previous}${textChunk}`;
      }
      onTranscription?.(transcriptBufferRef.current, false);
    } else {
      transcriptBufferRef.current = textChunk;
      onTranscription?.(transcriptBufferRef.current, true);
    }
  }, [onError, onTranscription, stopTranscription]);

  const requestEphemeralToken = useCallback(async () => {
    if (!transcriptEndpoint) {
      throw new Error('Missing transcription endpoint.');
    }
    const candidateHeaders = transcriptHeaders ?? getHeaders();
    const authHeader =
      candidateHeaders?.headers?.Authorization ||
      candidateHeaders?.headers?.authorization ||
      candidateHeaders?.Authorization ||
      candidateHeaders?.authorization;
    if (!authHeader) {
      throw new Error('Authentication required before using voice input.');
    }
    const requestConfig = candidateHeaders?.headers
      ? candidateHeaders
      : { headers: candidateHeaders };
    const { data } = await axios.get(transcriptEndpoint, requestConfig);
    const { token, model, url } = resolveEphemeralKey(data);
    if (!token) {
      throw new Error('Ephemeral token response missing credentials.');
    }
    const realtimeModel = model || data?.session?.model || preferredModel;
    const targetUrl =
      url ||
      data?.session?.url ||
      `${REALTIME_BASE_URL}?model=${encodeURIComponent(realtimeModel)}`;
    const metadata = {
      expiresAt: data?.expiresAt || null,
      maxTranscriptWords: data?.maxTranscriptWords ?? null,
    };
    return { token, realtimeModel, targetUrl, metadata };
  }, [preferredModel, transcriptEndpoint, transcriptHeaders]);

  const startTranscription = useCallback(async () => {
    if (!isSupported) {
      const message =
        'This device does not support microphone capture in the browser.';
      setError(message);
      onError?.(message);
      return;
    }

    if (isRecording || isInitializing) {
      return;
    }

    setError(null);
    setIsInitializing(true);

    try {
      const stream = await window.navigator.mediaDevices.getUserMedia({
        audio: true,
      });
      microphoneStreamRef.current = stream;

      const { token, realtimeModel, targetUrl, metadata } =
        await requestEphemeralToken();

      const peerConnection = new RTCPeerConnection();
      peerConnectionRef.current = peerConnection;

      stream.getTracks().forEach((track) => {
        peerConnection.addTrack(track, stream);
      });

      peerConnection.ontrack = (event) => {
        if (!event.streams?.length) return;
        const [remoteStream] = event.streams;
        if (!remoteStream) return;
        if (!remoteAudioRef.current) {
          remoteAudioRef.current = new Audio();
          remoteAudioRef.current.autoplay = true;
        }
        remoteAudioRef.current.srcObject = remoteStream;
      };

      peerConnection.onconnectionstatechange = () => {
        const state = peerConnection.connectionState;
        if (state === 'disconnected' || state === 'failed') {
          stopTranscription();
        }
      };

      const dataChannel = peerConnection.createDataChannel('oai-events');
      dataChannelRef.current = dataChannel;
      dataChannel.onmessage = handleRealtimeMessage;
      dataChannel.onclose = () => {
        stopTranscription();
      };

      const offer = await peerConnection.createOffer({
        offerToReceiveAudio: true,
        offerToReceiveVideo: false,
      });
      await peerConnection.setLocalDescription(offer);

      const baseHeaders = {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/sdp',
        'OpenAI-Beta': 'realtime=v1',
      };

      const response = await fetch(targetUrl, {
        method: 'POST',
        body: offer.sdp,
        headers: baseHeaders,
      });

      if (!response.ok) {
        throw new Error(
          `Realtime handshake failed with status ${response.status}`
        );
      }

      const answer = {
        type: 'answer',
        sdp: await response.text(),
      };
      await peerConnection.setRemoteDescription(answer);

      transcriptBufferRef.current = '';

      if (mountedRef.current) {
        setIsRecording(true);
        setIsInitializing(false);
      }
      onSessionStarted?.({
        model: realtimeModel,
        expiresAt: metadata?.expiresAt,
        maxTranscriptWords: metadata?.maxTranscriptWords,
      });

      dataChannel.addEventListener('open', () => {
        const disableResponses = {
          type: 'session.update',
          session: {
            instructions: 'You are a realtime speech-to-text service. Transcribe user microphone audio verbatim and do not generate additional responses or commentary.',
            turn_detection: {
              type: 'server_vad',
              create_response: false,
              interrupt_response: false,
            },
            input_audio_format: 'pcm16',
          },
        };

        const requestTranscriptionStream = {
          type: 'response.create',
          response: {
            modalities: ['text'],
            instructions: 'Provide streaming transcripts of the user audio only. Do not add commentary, greetings, or acknowledgements.',
          },
        };

        try {
          dataChannel.send(JSON.stringify(disableResponses));
          dataChannel.send(JSON.stringify(requestTranscriptionStream));
        } catch {
          /* ignore */
        }
      });
    } catch (err) {
      const message =
        err?.message ||
        'Unable to start realtime transcription session.';
      cleanupSession();
      if (mountedRef.current) {
        setIsInitializing(false);
        setIsRecording(false);
        setError(message);
      }
      onError?.(message);
    }
  }, [
    cleanupSession,
    handleRealtimeMessage,
    isInitializing,
    isRecording,
    isSupported,
    onError,
    onSessionStarted,
    requestEphemeralToken,
    stopTranscription,
  ]);

  return {
    startTranscription,
    stopTranscription,
    isSupported,
    isInitializing,
    isRecording,
    error,
  };
}

export default useRealtimeTranscription;
