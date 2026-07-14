function trimApiServer(apiServer) {
  return typeof apiServer === 'string' ? apiServer.trim().replace(/\/+$/, '') : '';
}

function trimEndpoint(endpoint) {
  return typeof endpoint === 'string' ? endpoint.trim().replace(/^\/+|\/+$/g, '') : '';
}

export function getVideoPostProcessingRequestUrls(apiServer, endpoint) {
  const baseUrl = trimApiServer(apiServer);
  const routeName = trimEndpoint(endpoint);

  return {
    primaryUrl: `${baseUrl}/v2/${routeName}`,
    legacyUrl: `${baseUrl}/v1/video/${routeName}`,
  };
}

export function isMissingVideoPostProcessingRoute(error, primaryUrl) {
  if (error?.response?.status !== 404 || typeof primaryUrl !== 'string') {
    return false;
  }

  const responseBody = error?.response?.data;
  if (typeof responseBody !== 'string') {
    return false;
  }

  let pathname = '';
  try {
    pathname = new URL(primaryUrl, 'http://localhost').pathname;
  } catch {
    return false;
  }

  const escapedPath = pathname.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`Cannot\\s+POST\\s+${escapedPath}(?![A-Za-z0-9_/-])`, 'i').test(responseBody);
}
