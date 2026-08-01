export const CUSTOM_TEXT_TO_IMAGE_MODEL_PREFIX = "CUSTOM_TEXT_TO_IMAGE:";
export const CUSTOM_TEXT_TO_IMAGE_OPERATION = "text_to_image";
export const CUSTOM_TEXT_TO_IMAGE_REQUEST_ID_TOKEN = "{request_id}";

function normalizeString(value) {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeHttpUrl(value, { allowRequestIdToken = false } = {}) {
  const normalized = normalizeString(value);
  if (!normalized) return "";

  const candidate = allowRequestIdToken
    ? normalized.replaceAll(CUSTOM_TEXT_TO_IMAGE_REQUEST_ID_TOKEN, "request-id")
    : normalized;
  try {
    const parsed = new URL(candidate);
    return parsed.protocol === "http:" || parsed.protocol === "https:"
      ? normalized
      : "";
  } catch {
    return "";
  }
}

function joinLegacyEndpointUrl(baseUrl, endpoint) {
  const normalizedBaseUrl = normalizeHttpUrl(baseUrl).replace(/\/+$/, "");
  const normalizedEndpoint = normalizeString(endpoint).replace(/^\/+/, "");
  if (!normalizedBaseUrl || !normalizedEndpoint) return "";
  try {
    return new URL(normalizedEndpoint, `${normalizedBaseUrl}/`).toString();
  } catch {
    return "";
  }
}

export function buildCustomTextToImageModelKey(adapterId) {
  const normalizedId = normalizeString(adapterId);
  return normalizedId ? `${CUSTOM_TEXT_TO_IMAGE_MODEL_PREFIX}${normalizedId}` : "";
}

export function isCustomTextToImageModelKey(modelKey) {
  return normalizeString(modelKey).startsWith(CUSTOM_TEXT_TO_IMAGE_MODEL_PREFIX);
}

export function inferCustomTextToImageUrls(generateUrl) {
  const normalizedGenerateUrl = normalizeHttpUrl(generateUrl).replace(/\/+$/, "");
  if (!normalizedGenerateUrl) {
    return {
      generateUrl: "",
      statusUrl: "",
      resultUrl: "",
    };
  }

  return {
    generateUrl: normalizedGenerateUrl,
    statusUrl: `${normalizedGenerateUrl}/${CUSTOM_TEXT_TO_IMAGE_REQUEST_ID_TOKEN}/status`,
    resultUrl: `${normalizedGenerateUrl}/${CUSTOM_TEXT_TO_IMAGE_REQUEST_ID_TOKEN}/result`,
  };
}

export function createEmptyCustomTextToImageAdapter(overrides = {}) {
  const id = normalizeString(overrides.id) ||
    `text_to_image_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  return {
    id,
    model_key: buildCustomTextToImageModelKey(id),
    name: "",
    operation: CUSTOM_TEXT_TO_IMAGE_OPERATION,
    generate_url: "",
    status_url: "",
    result_url: "",
    header_key: "Authorization",
    header_value: "",
    has_header_value: false,
    ...overrides,
  };
}

export function normalizeCustomTextToImageAdapters(customAdapters) {
  const source = customAdapters && typeof customAdapters === "object"
    ? customAdapters
    : {};
  const endpoints = Array.isArray(source.custom_endpoints)
    ? source.custom_endpoints
    : Array.isArray(source.customEndpoints)
      ? source.customEndpoints
      : [];

  return endpoints
    .filter((endpoint) => (
      endpoint &&
      typeof endpoint === "object" &&
      normalizeString(endpoint.operation) === CUSTOM_TEXT_TO_IMAGE_OPERATION
    ))
    .map((endpoint, index) => {
      const id = normalizeString(endpoint.id) || `text_to_image_${index + 1}`;
      const generateUrl = normalizeString(
        endpoint.generate_url ?? endpoint.generateUrl,
      ) || joinLegacyEndpointUrl(
        endpoint.base_url ?? endpoint.baseUrl,
        endpoint.endpoint ?? endpoint.path ?? endpoint.route,
      );
      const inferredUrls = inferCustomTextToImageUrls(generateUrl);

      return createEmptyCustomTextToImageAdapter({
        id,
        model_key: buildCustomTextToImageModelKey(id),
        name: normalizeString(endpoint.name) || `Custom image model ${index + 1}`,
        generate_url: generateUrl,
        status_url: normalizeString(endpoint.status_url ?? endpoint.statusUrl) || inferredUrls.statusUrl,
        result_url: normalizeString(endpoint.result_url ?? endpoint.resultUrl) || inferredUrls.resultUrl,
        header_key: normalizeString(endpoint.header_key ?? endpoint.headerKey) || "Authorization",
        header_value: normalizeString(endpoint.header_value ?? endpoint.headerValue),
        has_header_value:
          endpoint.has_header_value === true || endpoint.hasHeaderValue === true,
      });
    });
}

export function validateCustomTextToImageAdapter(adapter, index = 0) {
  const label = normalizeString(adapter?.name) || `Model ${index + 1}`;
  if (!normalizeString(adapter?.name)) {
    return `A model name is required for ${label}.`;
  }
  if (!normalizeHttpUrl(adapter?.generate_url)) {
    return `${label} needs a valid HTTP or HTTPS generate URL.`;
  }

  for (const [field, fieldLabel] of [
    ["status_url", "status/poll URL"],
    ["result_url", "result URL"],
  ]) {
    const value = normalizeString(adapter?.[field]);
    if (!normalizeHttpUrl(value, { allowRequestIdToken: true })) {
      return `${label} needs a valid HTTP or HTTPS ${fieldLabel}.`;
    }
    if (!value.includes(CUSTOM_TEXT_TO_IMAGE_REQUEST_ID_TOKEN)) {
      return `${label} ${fieldLabel} must include ${CUSTOM_TEXT_TO_IMAGE_REQUEST_ID_TOKEN}.`;
    }
  }

  const headerKey = normalizeString(adapter?.header_key);
  const hasHeaderValue = Boolean(
    normalizeString(adapter?.header_value) || adapter?.has_header_value === true,
  );
  if (hasHeaderValue && !headerKey) {
    return `${label} needs an authentication header key.`;
  }
  if (headerKey && !/^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/.test(headerKey)) {
    return `${label} has an invalid authentication header key.`;
  }

  return "";
}

export function getCustomTextToImageModelDefinitions(customAdapters) {
  return normalizeCustomTextToImageAdapters(customAdapters).map((adapter) => ({
    key: adapter.model_key,
    value: adapter.model_key,
    name: adapter.name,
    label: adapter.name,
    isExpressModel: true,
    isCustomTextToImageModel: true,
    customAdapterId: adapter.id,
    supportedAspectRatios: ["1:1", "16:9", "9:16"],
  }));
}

export function mergeCustomTextToImageModelDefinitions(models, customAdapters) {
  const result = Array.isArray(models) ? [...models] : [];
  const seen = new Set(result.map((model) => normalizeString(model?.key ?? model?.value)));
  for (const model of getCustomTextToImageModelDefinitions(customAdapters)) {
    if (seen.has(model.key)) continue;
    seen.add(model.key);
    result.push(model);
  }
  return result;
}
