export const GENBLAZE_COMPOSE_PROFILE = 'genblaze';
export const GENBLAZE_FINAL_UP_ARGS = Object.freeze([
  'up',
  '-d',
  '--build',
  '--no-deps',
  'genblaze',
]);

function normalizeString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

export function hasValidatedGenBlazeRuntimeCatalog(config = {}, catalog = null) {
  const expectedFingerprint = normalizeString(
    config?.providers?.gmicloud?.credentialFingerprint,
  ).toLowerCase();
  const catalogFingerprint = normalizeString(catalog?.credentialFingerprint).toLowerCase();
  return Boolean(
    catalog?.version === 1 &&
    catalog?.provider === 'gmicloud' &&
    /^[a-f0-9]{64}$/.test(expectedFingerprint) &&
    catalogFingerprint === expectedFingerprint
  );
}

export function splitGenBlazeComposeProfiles(profiles = []) {
  const normalizedProfiles = [...new Set(
    (Array.isArray(profiles) ? profiles : [])
      .filter((profile) => typeof profile === 'string' && profile.trim())
      .map((profile) => profile.trim()),
  )];
  return {
    enabled: normalizedProfiles.includes(GENBLAZE_COMPOSE_PROFILE),
    primaryProfiles: normalizedProfiles.filter((profile) => profile !== GENBLAZE_COMPOSE_PROFILE),
  };
}
