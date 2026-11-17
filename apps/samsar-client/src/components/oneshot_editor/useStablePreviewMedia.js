import { useCallback, useRef, useState } from 'react';
import { getStudioMediaIdentity } from '../video/util/studioMediaIdentity.mjs';

// A status poll can renew a delivery credential without changing the media.
// Keep sources already assigned to browser elements, and retain the newest
// credential for an explicit retry if the existing source fails to load.
export function useStablePreviewMedia(incomingSegments, scopeKey) {
  const sourcesRef = useRef({ scopeKey, sources: new Map() });
  const [, setSourceVersion] = useState(0);
  const previousSources = Object.is(sourcesRef.current.scopeKey, scopeKey)
    ? sourcesRef.current.sources
    : new Map();
  const sources = new Map();
  const segments = incomingSegments.map((segment) => {
    const identity = getStudioMediaIdentity(segment.url);
    const previous = previousSources.get(segment.key);
    const keepSource = previous?.identity === identity
      && !(previous.failed && previous.url !== segment.url);
    const source = keepSource
      ? { ...previous, latestUrl: segment.url }
      : { identity, url: segment.url, latestUrl: segment.url };
    sources.set(segment.key, source);
    return source.url === segment.url ? segment : { ...segment, url: source.url };
  });
  // Reconcile during rendering so an error event immediately following a poll
  // uses that poll's grant. Removed segments are discarded with the old map.
  sourcesRef.current = { scopeKey, sources };

  const refreshSource = useCallback((segmentKey) => {
    const source = sourcesRef.current.sources.get(segmentKey);
    if (!source) return false;
    if (source.url === source.latestUrl) {
      source.failed = true;
      return false;
    }
    source.url = source.latestUrl;
    source.failed = false;
    setSourceVersion((version) => version + 1);
    return true;
  }, []);

  return { segments, refreshSource };
}
