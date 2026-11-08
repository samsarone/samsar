// Session/status reads must eventually release their in-flight slot, including
// when a mobile transport never settles its promise. This deadline also aborts
// the socket; a late response cannot replace the result of a later retry.
export const READ_REQUEST_TIMEOUT_MS = 30000;
export function boundedGet(client, url, config = {}) {
  config = config || {};
  const configuredTimeout = Number(config.timeout);
  const timeout = Number.isFinite(configuredTimeout) && configuredTimeout > 0 ? configuredTimeout : READ_REQUEST_TIMEOUT_MS;
  const controller = new AbortController();
  let timer;
  let cancel;
  const request = new Promise((resolve, reject) => {
    cancel = () => {
      const error = new Error('Request canceled');
      error.code = 'ERR_CANCELED';
      reject(error);
      controller.abort();
    };
    if (config.signal?.aborted) { cancel(); return; }
    config.signal?.addEventListener('abort', cancel, { once: true });
    timer = setTimeout(() => {
      const error = new Error('The request timed out. Please try again.');
      error.code = 'ECONNABORTED';
      reject(error);
      controller.abort();
    }, timeout);
    Promise.resolve(client.get(url, { ...config, timeout, signal: controller.signal })).then(resolve, reject);
  });
  return request.finally(() => {
    clearTimeout(timer);
    config.signal?.removeEventListener('abort', cancel);
  });
}

const requestsByClient = new WeakMap();

function stableEntries(value = {}) {
  return Object.entries(value).sort(([left], [right]) => left.localeCompare(right));
}

// Share only requests that are still running. Never cache private responses,
// and never combine requests from different authentication contexts.
export function deduplicatedGet(client, url, config = {}) {
  config = config || {};
  if (config.signal || config.cancelToken) return boundedGet(client, url, config);
  const resource = new URL(url, 'https://relative-request.invalid');
  resource.searchParams.delete('cacheBust');
  const params = { ...config.params };
  delete params.cacheBust;
  const key = JSON.stringify([
    resource.href,
    stableEntries(params),
    stableEntries(config.headers),
    config.withCredentials,
    config.responseType,
    config.timeout,
  ]);
  let requests = requestsByClient.get(client);
  if (!requests) {
    requests = new Map();
    requestsByClient.set(client, requests);
  }
  if (requests.has(key)) return requests.get(key);
  const request = boundedGet(client, url, config);
  const pending = request.finally(() => {
    if (requests.get(key) === pending) requests.delete(key);
  });
  requests.set(key, pending);
  return pending;
}
