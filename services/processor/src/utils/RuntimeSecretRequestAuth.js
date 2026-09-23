import { runtimeSecretMatches } from './RuntimeSecrets.js';

export function extractRuntimeRequestSecret(
  request,
  { headerName = 'x-internal-secret', queryName = 'secret' } = {},
) {
  const headerValue = request?.headers?.[headerName];
  if (typeof headerValue === 'string' && headerValue) {
    return headerValue;
  }

  const queryValue = request?.query?.[queryName];
  if (typeof queryValue === 'string' && queryValue) {
    return queryValue;
  }

  return '';
}

export function requestHasValidRuntimeSecret(
  request,
  {
    environmentName = 'INTERNAL_SECRET',
    headerName = 'x-internal-secret',
    queryName = 'secret',
    env = process.env,
  } = {},
) {
  const candidate = extractRuntimeRequestSecret(request, { headerName, queryName });
  return runtimeSecretMatches(environmentName, candidate, env);
}
