const ENVIRONMENT_VARIABLE_NAME_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;
const ENVIRONMENT_VARIABLE_REFERENCE_PATTERN = /^\$(?:([A-Za-z_][A-Za-z0-9_]*)|\{([A-Za-z_][A-Za-z0-9_]*)\})$/;

export const DEFAULT_PROVIDER_ENVIRONMENT_VARIABLE_BY_FIELD = Object.freeze({
  samsarApiKey: 'SAMSAR_API_KEY',
  openaiApiKey: 'OPENAI_API_KEY',
  openrouterApiKey: 'OPENROUTER_API_KEY',
  googleCredentialsJson: 'GOOGLE_APPLICATION_CREDENTIALS_JSON_B64',
  kimiK3ApiKey: 'KIMI_K3_API_KEY',
  alibabaApiKey: 'ALIBABA_API_KEY',
  alibabaApiHost: 'ALIBABA_API_HOST',
  falApiKey: 'FAL_API_KEY',
  elevenLabsApiKey: 'ELEVENLABS_API_KEY',
  runwayApiKey: 'RUNWAY_API_KEY',
});

export const PROVIDER_ENVIRONMENT_VARIABLE_NAMES = Object.freeze([
  ...new Set([
    ...Object.values(DEFAULT_PROVIDER_ENVIRONMENT_VARIABLE_BY_FIELD),
    'GOOGLE_APPLICATION_CREDENTIALS_JSON',
    'DASHSCOPE_API_KEY',
    'DASHSCOPE_BASE_URL',
    'ELEVENLABS_API_TOKEN',
    'RUNWAYML_API_KEY',
  ]),
]);

export function isValidEnvironmentVariableName(value) {
  return ENVIRONMENT_VARIABLE_NAME_PATTERN.test(String(value || '').trim());
}

export function parseEnvironmentVariableReference(value) {
  const normalized = typeof value === 'string' ? value.trim() : '';
  if (!normalized) {
    return '';
  }
  const match = normalized.match(ENVIRONMENT_VARIABLE_REFERENCE_PATTERN);
  return match ? match[1] || match[2] : null;
}

export function getProviderEnvironmentReferencePlaceholder(field) {
  const variableName = DEFAULT_PROVIDER_ENVIRONMENT_VARIABLE_BY_FIELD[field];
  return variableName ? `$${variableName}` : '$VARIABLE_NAME';
}

export function resolveProviderEnvironmentReferences(
  references = {},
  environment = {},
  { allowedVariableNames = PROVIDER_ENVIRONMENT_VARIABLE_NAMES } = {},
) {
  const allowedNames = new Set(
    [...allowedVariableNames].map((value) => String(value || '').trim()).filter(isValidEnvironmentVariableName),
  );
  const credentials = {};
  const variableNames = {};

  for (const field of Object.keys(DEFAULT_PROVIDER_ENVIRONMENT_VARIABLE_BY_FIELD)) {
    const reference = typeof references?.[field] === 'string' ? references[field].trim() : '';
    if (!reference) {
      credentials[field] = '';
      continue;
    }

    const variableName = parseEnvironmentVariableReference(reference);
    if (!variableName) {
      throw new Error(`Use a Bash variable reference such as $${DEFAULT_PROVIDER_ENVIRONMENT_VARIABLE_BY_FIELD[field]} instead of entering a value.`);
    }
    if (!allowedNames.has(variableName)) {
      throw new Error(`$${variableName} was not forwarded to the setup wizard. Add ${variableName} to SAMSAR_SETUP_PROVIDER_ENV_NAMES and rerun ./setup.sh.`);
    }

    const resolvedValue = typeof environment?.[variableName] === 'string' ? environment[variableName] : '';
    if (!resolvedValue.trim()) {
      throw new Error(`$${variableName} is not set or is empty. Export it in Bash and rerun ./setup.sh.`);
    }

    credentials[field] = resolvedValue;
    variableNames[field] = variableName;
  }

  return { credentials, variableNames };
}
