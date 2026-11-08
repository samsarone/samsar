import { useLayoutEffect, useRef } from 'react';
import { getHeaders } from '../utils/web.jsx';
import { requestSessionDetails, sessionAuthorization } from '../utils/sessionDetailsRequest.js';

// Start the authorized read alongside profile verification and editor code.
// Reading data never requires mounting the heavy editor or resolving its form.
export default function useSessionDetailsPreload(pathname, apiServer) {
  const sessionId = pathname.match(/^\/(?:video|vidgenie|vidgpt|videogpt|vidgemie)\/([^/]+)\/?$/)?.[1];
  const authorization = sessionAuthorization(getHeaders());
  const initial = useRef(null);
  // Install the handoff before child editor effects consume their initial read.
  useLayoutEffect(() => {
    if (!sessionId || !authorization) { initial.current = null; return undefined; }
    const request = {
      sessionId, authorization,
      promise: requestSessionDetails(apiServer, sessionId, getHeaders()),
    };
    initial.current = request;
    // The editor consumes failures through its normal error/retry UI.
    void request.promise.catch(() => undefined);
    return () => { if (initial.current === request) initial.current = null; };
  }, [apiServer, sessionId, authorization]);
  return initial;
}
