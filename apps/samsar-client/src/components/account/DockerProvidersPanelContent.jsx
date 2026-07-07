import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "react-toastify";
import {
  FaCheck,
  FaCircleNotch,
  FaExclamationTriangle,
  FaMinus,
  FaPlug,
  FaPlus,
  FaRedo,
  FaTrash,
  FaUndo,
} from "react-icons/fa";

import { useColorMode } from "../../contexts/ColorMode.jsx";
import { useUser } from "../../contexts/UserContext.jsx";
import { getHeaders } from "../../utils/web.jsx";
import { getSessionType } from "../../utils/environment.jsx";
import {
  DEPLOYMENT_PROVIDER_CAPABILITY_FALLBACKS,
  extractDeploymentProviders,
  fetchDeploymentProviderCapabilities,
  fetchDeploymentProviderConfig,
  fetchDeploymentProviderReconfigurationStatus,
  formatDeploymentProviderLabel,
  normalizeDeploymentProviderKey,
  requestDeploymentProviderReconfiguration,
  validateDeploymentProviderCredentials,
} from "../../utils/deploymentProviders.js";
import { clearAudioProviderAvailabilityCache } from "../../hooks/useAudioProviderAvailability.js";
import { clearDeploymentModelAvailabilityCache } from "../../hooks/useDeploymentModelAvailability.js";
import { clearInferenceModelAvailabilityCache } from "../../hooks/useInferenceModelAvailability.js";

const PROCESSOR_SERVER = import.meta.env.VITE_PROCESSOR_API;
const SETUP_WIZARD_API = import.meta.env.VITE_SETUP_WIZARD_API || "http://localhost:8089";

const PROVIDER_ORDER = Object.freeze(["samsar", "openai", "googleCloud", "fal", "runway"]);

const PROVIDER_CREDENTIAL_FIELDS = Object.freeze({
  samsar: [
    {
      name: "samsarApiKey",
      label: "Samsar API key",
      placeholder: "Paste a Samsar API key",
      type: "password",
    },
  ],
  openai: [
    {
      name: "openaiApiKey",
      label: "OpenAI API key",
      placeholder: "Paste an OpenAI API key",
      type: "password",
    },
  ],
  googleCloud: [
    {
      name: "googleProjectId",
      label: "Google Cloud project ID",
      placeholder: "Project ID from Google Cloud",
      required: false,
      type: "text",
    },
    {
      name: "googleCredentialsJson",
      label: "Service account JSON",
      placeholder: "Paste the Google service account JSON",
      multiline: true,
    },
  ],
  fal: [
    {
      name: "falApiKey",
      label: "FAL API key",
      placeholder: "Paste a FAL API key",
      type: "password",
    },
    {
      name: "validateFalRemotely",
      label: "Run remote FAL validation",
      type: "checkbox",
      required: false,
    },
  ],
  runway: [
    {
      name: "runwayApiKey",
      label: "Runway API key",
      placeholder: "Paste a Runway API key",
      type: "password",
    },
  ],
});

const SUCCESS_STATUSES = new Set(["complete", "completed", "success", "succeeded", "ready", "done"]);
const FAILURE_STATUSES = new Set(["failed", "failure", "error", "errored", "cancelled", "canceled"]);

function sleep(ms) {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms);
  });
}

function normalizeCapabilities(capabilities) {
  const source =
    capabilities && typeof capabilities === "object" && !Array.isArray(capabilities)
      ? capabilities
      : DEPLOYMENT_PROVIDER_CAPABILITY_FALLBACKS;

  return PROVIDER_ORDER.reduce((acc, providerKey) => {
    const capability = source[providerKey] || DEPLOYMENT_PROVIDER_CAPABILITY_FALLBACKS[providerKey];
    if (!capability) return acc;
    acc[providerKey] = {
      ...capability,
      label: capability.label || formatDeploymentProviderLabel(providerKey),
      models: Array.isArray(capability.models) ? capability.models : [],
      actions: Array.isArray(capability.actions) ? capability.actions : [],
      requiredFor: Array.isArray(capability.requiredFor) ? capability.requiredFor : [],
    };
    return acc;
  }, {});
}

function getErrorMessage(error, fallback) {
  return (
    error?.response?.data?.message ||
    error?.response?.data?.error ||
    error?.message ||
    fallback
  );
}

function getProviderValidationStatus(validationPayload, providerKey) {
  return validationPayload?.providers?.[providerKey] || null;
}

function buildAvailabilityFromProviders(providerKeys, capabilities) {
  const models = new Set();
  const actions = new Set();
  const providers = [];
  const seenProviders = new Set();

  providerKeys.forEach((rawProvider) => {
    const providerKey = normalizeDeploymentProviderKey(rawProvider);
    if (!providerKey || seenProviders.has(providerKey)) return;
    seenProviders.add(providerKey);
    providers.push(providerKey);

    const capability = capabilities[providerKey];
    capability?.models?.forEach((model) => models.add(model));
    capability?.actions?.forEach((action) => actions.add(action));
  });

  return {
    providers,
    models: [...models].sort(),
    actions: [...actions].sort(),
  };
}

function providerKeysMatch(actualProviders, expectedProviders) {
  const actual = new Set(actualProviders.map(normalizeDeploymentProviderKey).filter(Boolean));
  const expected = new Set(expectedProviders.map(normalizeDeploymentProviderKey).filter(Boolean));
  if (actual.size !== expected.size) return false;

  for (const providerKey of expected) {
    if (!actual.has(providerKey)) return false;
  }

  return true;
}

function getOperationId(payload) {
  return payload?.operationId || payload?.operation_id || payload?.jobId || payload?.job_id || payload?.id || "";
}

function getStatusUrl(payload) {
  return payload?.statusUrl || payload?.status_url || payload?.statusPath || payload?.status_path || "";
}

function getOperationStatus(payload) {
  return String(payload?.status || payload?.state || payload?.phase || "").trim().toLowerCase();
}

function getOperationMessage(payload, fallback) {
  return payload?.message || payload?.detail || payload?.statusMessage || payload?.status_message || fallback;
}

async function requestManagedFirewallPortCleanup() {
  if (!SETUP_WIZARD_API) {
    return null;
  }

  const response = await fetch(`${SETUP_WIZARD_API.replace(/\/+$/, "")}/api/setup/firewall/close-managed-ports`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      source: "samsar-client-admin-recreate",
      message: "Closing host firewall ports opened by Samsar setup before admin container recreation.",
    }),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok || body.ok === false) {
    throw new Error(body?.message || "Unable to close host firewall ports opened during setup.");
  }
  return body;
}

export default function DockerProvidersPanelContent() {
  const { colorMode } = useColorMode();
  const { user } = useUser();
  const isDockerInstall = getSessionType() === "docker";

  const isDark = colorMode === "dark";
  const textColor = isDark ? "text-slate-100" : "text-slate-900";
  const subtleText = isDark ? "text-slate-400" : "text-slate-600";
  const mutedText = isDark ? "text-slate-500" : "text-slate-500";
  const cardBgColor = isDark ? "bg-[#0f1629]" : "bg-white";
  const mutedBg = isDark ? "bg-[#0b1224]" : "bg-slate-50";
  const borderColor = isDark ? "border-[#1f2a3d]" : "border-slate-200";
  const inputBg = isDark ? "bg-[#080f1f] text-slate-100" : "bg-white text-slate-900";
  const activePill = isDark
    ? "border-emerald-300/40 bg-emerald-300/15 text-emerald-100"
    : "border-emerald-200 bg-emerald-50 text-emerald-800";
  const idlePill = isDark
    ? "border-[#273651] bg-[#0b1224] text-slate-200 hover:border-cyan-300/60"
    : "border-slate-200 bg-white text-slate-700 hover:border-cyan-300";
  const dangerButton = isDark
    ? "border-red-300/35 bg-red-400/10 text-red-100 hover:bg-red-400/20"
    : "border-red-200 bg-red-50 text-red-700 hover:bg-red-100";
  const primaryButton = isDark
    ? "border-cyan-300/35 bg-cyan-400/15 text-cyan-50 hover:bg-cyan-400/25"
    : "border-cyan-200 bg-cyan-50 text-cyan-900 hover:bg-cyan-100";
  const secondaryButton = isDark
    ? "border-[#273651] bg-[#0b1224] text-slate-200 hover:border-indigo-300/60"
    : "border-slate-200 bg-white text-slate-700 hover:border-indigo-300";

  const isAdminUser = Boolean(user?.isAdminUser);

  const [deploymentProviders, setDeploymentProviders] = useState([]);
  const [providerCapabilities, setProviderCapabilities] = useState(() =>
    normalizeCapabilities(DEPLOYMENT_PROVIDER_CAPABILITY_FALLBACKS)
  );
  const [isLoading, setIsLoading] = useState(false);
  const [providerError, setProviderError] = useState("");
  const [selectedProviderKey, setSelectedProviderKey] = useState("");
  const [credentialValues, setCredentialValues] = useState({});
  const [pendingAdditions, setPendingAdditions] = useState({});
  const [pendingRemovals, setPendingRemovals] = useState({});
  const [validationResult, setValidationResult] = useState(null);
  const [isValidating, setIsValidating] = useState(false);
  const [recreateStatus, setRecreateStatus] = useState(null);

  const loadProviderData = useCallback(async () => {
    if (!isDockerInstall) return null;

    setIsLoading(true);
    setProviderError("");
    try {
      const [configResult, capabilitiesResult] = await Promise.allSettled([
        fetchDeploymentProviderConfig(PROCESSOR_SERVER, getHeaders()),
        fetchDeploymentProviderCapabilities(PROCESSOR_SERVER, getHeaders()),
      ]);

      if (capabilitiesResult.status === "fulfilled") {
        setProviderCapabilities(normalizeCapabilities(capabilitiesResult.value));
      } else {
        setProviderCapabilities(normalizeCapabilities(DEPLOYMENT_PROVIDER_CAPABILITY_FALLBACKS));
      }

      if (configResult.status === "rejected") {
        throw configResult.reason;
      }

      const providers = extractDeploymentProviders(configResult.value);
      setDeploymentProviders(providers);
      return configResult.value;
    } catch (error) {
      setProviderError(getErrorMessage(error, "Unable to load enabled providers."));
      return null;
    } finally {
      setIsLoading(false);
    }
  }, [isDockerInstall]);

  useEffect(() => {
    loadProviderData();
  }, [loadProviderData]);

  const enabledProviderRows = useMemo(
    () =>
      deploymentProviders.map((provider) => ({
        key: normalizeDeploymentProviderKey(provider),
        raw: provider,
        label: formatDeploymentProviderLabel(provider),
      })),
    [deploymentProviders]
  );

  const enabledProviderKeys = useMemo(
    () => new Set(enabledProviderRows.map((provider) => provider.key)),
    [enabledProviderRows]
  );

  const pendingAdditionKeys = useMemo(() => Object.keys(pendingAdditions), [pendingAdditions]);
  const pendingRemovalKeys = useMemo(() => Object.keys(pendingRemovals), [pendingRemovals]);

  const supportedProviderRows = useMemo(
    () =>
      PROVIDER_ORDER.map((providerKey) => ({
        key: providerKey,
        label: providerCapabilities[providerKey]?.label || formatDeploymentProviderLabel(providerKey),
        requiredFor: providerCapabilities[providerKey]?.requiredFor || [],
        models: providerCapabilities[providerKey]?.models || [],
      })),
    [providerCapabilities]
  );

  const availableProviderRows = useMemo(
    () =>
      supportedProviderRows.filter(
        (provider) => !enabledProviderKeys.has(provider.key) && !pendingAdditions[provider.key]
      ),
    [enabledProviderKeys, pendingAdditions, supportedProviderRows]
  );

  const nextProviderKeys = useMemo(() => {
    const nextKeys = enabledProviderRows
      .filter((provider) => !pendingRemovals[provider.key])
      .map((provider) => provider.key);

    pendingAdditionKeys.forEach((providerKey) => {
      if (!nextKeys.includes(providerKey)) {
        nextKeys.push(providerKey);
      }
    });

    return nextKeys;
  }, [enabledProviderRows, pendingAdditionKeys, pendingRemovals]);

  const nextAvailability = useMemo(
    () => buildAvailabilityFromProviders(nextProviderKeys, providerCapabilities),
    [nextProviderKeys, providerCapabilities]
  );

  const hasPendingChanges = pendingAdditionKeys.length > 0 || pendingRemovalKeys.length > 0;
  const selectedCredentialFields = PROVIDER_CREDENTIAL_FIELDS[selectedProviderKey] || [];
  const selectedCredentials = credentialValues[selectedProviderKey] || {};
  const selectedValidationStatus = getProviderValidationStatus(validationResult, selectedProviderKey);

  const updateCredentialValue = (providerKey, fieldName, value) => {
    setCredentialValues((current) => ({
      ...current,
      [providerKey]: {
        ...(current[providerKey] || {}),
        [fieldName]: value,
      },
    }));
    setPendingAdditions((current) => {
      if (!current[providerKey]) return current;
      const next = { ...current };
      delete next[providerKey];
      return next;
    });
    setValidationResult(null);
  };

  const selectProvider = (providerKey) => {
    setSelectedProviderKey(providerKey);
    setValidationResult(null);
  };

  const removeProvider = (providerKey) => {
    setPendingRemovals((current) => ({
      ...current,
      [providerKey]: true,
    }));
  };

  const undoRemoveProvider = (providerKey) => {
    setPendingRemovals((current) => {
      const next = { ...current };
      delete next[providerKey];
      return next;
    });
  };

  const undoAddProvider = (providerKey) => {
    setPendingAdditions((current) => {
      const next = { ...current };
      delete next[providerKey];
      return next;
    });
  };

  const getCredentialPayloadForProvider = (providerKey) => {
    const fields = PROVIDER_CREDENTIAL_FIELDS[providerKey] || [];
    const values = credentialValues[providerKey] || {};
    return fields.reduce((payload, field) => {
      const value = values[field.name];
      if (field.type === "checkbox") {
        payload[field.name] = Boolean(value);
        return payload;
      }
      if (typeof value === "string" && value.trim()) {
        payload[field.name] = value.trim();
      }
      return payload;
    }, {});
  };

  const validateSelectedProvider = async () => {
    if (!selectedProviderKey) return;

    const missingRequiredField = selectedCredentialFields.find((field) => {
      if (field.required === false || field.type === "checkbox") return false;
      return !String(selectedCredentials[field.name] || "").trim();
    });

    if (missingRequiredField) {
      toast.error(`Enter ${missingRequiredField.label}.`, { position: "bottom-center" });
      return;
    }

    const credentialPayload = getCredentialPayloadForProvider(selectedProviderKey);
    setIsValidating(true);
    setValidationResult(null);
    try {
      const result = await validateDeploymentProviderCredentials(
        PROCESSOR_SERVER,
        credentialPayload,
        getHeaders()
      );
      const status = getProviderValidationStatus(result, selectedProviderKey);
      setValidationResult(result);

      if (!status?.ok) {
        toast.error(status?.message || "Provider credentials could not be validated.", {
          position: "bottom-center",
        });
        return;
      }

      setPendingAdditions((current) => ({
        ...current,
        [selectedProviderKey]: {
          credentials: credentialPayload,
          validation: status,
        },
      }));
      toast.success(`${formatDeploymentProviderLabel(selectedProviderKey)} is ready to enable.`, {
        position: "bottom-center",
      });
    } catch (error) {
      toast.error(getErrorMessage(error, "Unable to validate provider credentials."), {
        position: "bottom-center",
      });
    } finally {
      setIsValidating(false);
    }
  };

  const waitForProcessorRefresh = async () => {
    let lastPayload = null;
    for (let attempt = 0; attempt < 30; attempt += 1) {
      try {
        lastPayload = await fetchDeploymentProviderConfig(PROCESSOR_SERVER, getHeaders());
        const refreshedProviders = extractDeploymentProviders(lastPayload);
        if (providerKeysMatch(refreshedProviders, nextProviderKeys)) {
          setDeploymentProviders(refreshedProviders);
          return lastPayload;
        }
        setRecreateStatus({
          title: "Refreshing providers",
          message: "Waiting for updated provider settings...",
        });
        await sleep(2500);
      } catch (_) {
        setRecreateStatus({
          title: "Recreating containers",
          message: "Waiting for Samsar Studio to reconnect...",
        });
        await sleep(2500);
      }
    }
    throw new Error("Provider settings did not refresh after recreating containers.");
  };

  const waitForReconfigurationStatus = async (initialPayload) => {
    const operationId = getOperationId(initialPayload);
    const statusUrl = getStatusUrl(initialPayload);
    if (!operationId && !statusUrl) {
      return initialPayload;
    }

    let latestPayload = initialPayload;
    for (let attempt = 0; attempt < 90; attempt += 1) {
      const statusPayload = await fetchDeploymentProviderReconfigurationStatus(
        PROCESSOR_SERVER,
        { operationId, statusUrl },
        getHeaders()
      );
      if (!statusPayload) return latestPayload;

      latestPayload = statusPayload;
      const status = getOperationStatus(statusPayload);
      setRecreateStatus({
        title: "Recreating containers",
        message: getOperationMessage(statusPayload, "Applying provider changes..."),
      });

      if (SUCCESS_STATUSES.has(status)) {
        return statusPayload;
      }
      if (FAILURE_STATUSES.has(status)) {
        throw new Error(getOperationMessage(statusPayload, "Container recreation failed."));
      }

      await sleep(2000);
    }

    return latestPayload;
  };

  const confirmProviderChanges = async () => {
    if (!hasPendingChanges || !isAdminUser) return;

    const providerCredentials = {};
    const credentials = {};
    pendingAdditionKeys.forEach((providerKey) => {
      const providerCredentialPayload = pendingAdditions[providerKey]?.credentials || {};
      providerCredentials[providerKey] = providerCredentialPayload;
      Object.assign(credentials, providerCredentialPayload);
    });

    setRecreateStatus({
      title: "Recreating containers",
      message: "Submitting provider changes...",
    });

    try {
      setRecreateStatus({
        title: "Preparing container recreation",
        message: "Closing host firewall ports opened during setup...",
      });
      try {
        await requestManagedFirewallPortCleanup();
      } catch (cleanupError) {
        toast.warn(getErrorMessage(cleanupError, "Unable to request setup-managed port cleanup."), {
          position: "bottom-center",
        });
      }

      setRecreateStatus({
        title: "Recreating containers",
        message: "Submitting provider changes...",
      });
      const response = await requestDeploymentProviderReconfiguration(
        PROCESSOR_SERVER,
        {
          providers: nextProviderKeys,
          enabledProviders: nextProviderKeys,
          addProviders: pendingAdditionKeys,
          removeProviders: pendingRemovalKeys,
          available: nextAvailability,
          models: nextAvailability.models,
          actions: nextAvailability.actions,
          credentials,
          providerCredentials,
          source: "samsar-studio-provider-settings",
        },
        getHeaders()
      );

      setRecreateStatus({
        title: "Recreating containers",
        message: getOperationMessage(response, "Recreating Docker containers..."),
      });
      await waitForReconfigurationStatus(response);

      clearDeploymentModelAvailabilityCache();
      clearInferenceModelAvailabilityCache();
      clearAudioProviderAvailabilityCache();

      setRecreateStatus({
        title: "Refreshing providers",
        message: "Loading updated provider settings...",
      });
      await waitForProcessorRefresh();
      await loadProviderData();

      setPendingAdditions({});
      setPendingRemovals({});
      setSelectedProviderKey("");
      setValidationResult(null);
      toast.success("Provider settings updated.", { position: "bottom-center" });
    } catch (error) {
      toast.error(getErrorMessage(error, "Unable to update Docker providers."), {
        position: "bottom-center",
      });
    } finally {
      setRecreateStatus(null);
    }
  };

  if (!isDockerInstall) {
    return null;
  }

  return (
    <div className={`mx-auto flex w-full min-w-0 max-w-5xl flex-col gap-4 overflow-x-hidden sm:gap-5 ${textColor}`}>
      {recreateStatus && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/50 px-4" role="status" aria-live="polite">
          <div className={`w-full max-w-md rounded-lg border ${borderColor} ${cardBgColor} p-5 shadow-2xl`}>
            <div className="flex items-start gap-4">
              <FaCircleNotch className="mt-1 shrink-0 animate-spin text-cyan-400" />
              <div className="min-w-0">
                <h3 className="text-lg font-semibold">{recreateStatus.title}</h3>
                <p className={`mt-2 text-sm ${subtleText}`}>{recreateStatus.message}</p>
              </div>
            </div>
          </div>
        </div>
      )}

      <div className="flex w-full min-w-0 flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0">
          <p className={`text-xs font-semibold uppercase tracking-[0.22em] ${mutedText}`}>Providers</p>
          <h2 className="text-2xl font-semibold tracking-normal sm:text-3xl">Docker providers</h2>
        </div>
        <button
          type="button"
          onClick={loadProviderData}
          disabled={isLoading}
          className={`inline-flex min-h-[42px] w-full max-w-full items-center justify-center gap-2 rounded-lg border px-4 py-2 text-sm font-semibold transition disabled:cursor-not-allowed disabled:opacity-60 sm:w-auto ${secondaryButton}`}
        >
          <FaRedo className={`text-xs ${isLoading ? "animate-spin" : ""}`} />
          Refresh
        </button>
      </div>

      <section className={`w-full min-w-0 rounded-lg border ${borderColor} ${cardBgColor} p-4 sm:p-6`}>
        <div className="flex min-w-0 gap-3">
          <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border ${borderColor} ${mutedBg}`}>
            <FaPlug className={isDark ? "text-cyan-200" : "text-cyan-600"} />
          </div>
          <div className="min-w-0">
            <h3 className="text-xl font-semibold">Provider-side billing</h3>
            <p className={`mt-2 text-sm ${subtleText}`}>
              Billing is handled outside Samsar for this Docker installation. Enabled providers define the models shown in Studio.
            </p>
          </div>
        </div>
      </section>

      {providerError && (
        <div className={`rounded-lg border ${borderColor} ${cardBgColor} p-4 text-sm text-red-500`}>
          {providerError}
        </div>
      )}

      <section className={`w-full min-w-0 rounded-lg border ${borderColor} ${cardBgColor} p-4 sm:p-6`}>
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h3 className="text-lg font-semibold">Enabled providers</h3>
            <p className={`text-sm ${subtleText}`}>Providers currently configured for this installation.</p>
          </div>
          {isLoading && <span className={`text-sm ${mutedText}`}>Loading providers...</span>}
        </div>

        {!isLoading && enabledProviderRows.length === 0 && pendingAdditionKeys.length === 0 ? (
          <div className={`mt-4 rounded-lg border ${borderColor} ${mutedBg} p-4 text-sm ${subtleText}`}>
            No providers are configured for this installation yet.
          </div>
        ) : (
          <div className="mt-4 grid min-w-0 gap-3 md:grid-cols-2">
            {enabledProviderRows.map((provider) => {
              const isPendingRemoval = Boolean(pendingRemovals[provider.key]);
              return (
                <div key={provider.key} className={`rounded-lg border ${borderColor} ${mutedBg} p-4 ${isPendingRemoval ? "opacity-70" : ""}`}>
                  <div className="flex min-w-0 items-start justify-between gap-3">
                    <div className="flex min-w-0 items-center gap-3">
                      <div className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border ${borderColor} ${cardBgColor}`}>
                        <FaPlug className={isDark ? "text-emerald-200" : "text-emerald-600"} />
                      </div>
                      <div className="min-w-0">
                        <p className="truncate text-sm font-semibold">{provider.label}</p>
                        <p className={`truncate text-xs ${mutedText}`}>
                          {isPendingRemoval ? "Will be removed on confirm" : provider.raw}
                        </p>
                      </div>
                    </div>
                    {isAdminUser && (
                      isPendingRemoval ? (
                        <button
                          type="button"
                          onClick={() => undoRemoveProvider(provider.key)}
                          className={`inline-flex min-h-[34px] shrink-0 items-center justify-center gap-2 rounded-lg border px-3 text-xs font-semibold transition ${secondaryButton}`}
                        >
                          <FaUndo className="text-[10px]" />
                          Undo
                        </button>
                      ) : (
                        <button
                          type="button"
                          onClick={() => removeProvider(provider.key)}
                          className={`inline-flex min-h-[34px] shrink-0 items-center justify-center gap-2 rounded-lg border px-3 text-xs font-semibold transition ${dangerButton}`}
                        >
                          <FaTrash className="text-[10px]" />
                          Remove
                        </button>
                      )
                    )}
                  </div>
                </div>
              );
            })}

            {pendingAdditionKeys.map((providerKey) => (
              <div key={providerKey} className={`rounded-lg border ${borderColor} ${mutedBg} p-4`}>
                <div className="flex min-w-0 items-start justify-between gap-3">
                  <div className="flex min-w-0 items-center gap-3">
                    <div className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border ${borderColor} ${cardBgColor}`}>
                      <FaCheck className={isDark ? "text-emerald-200" : "text-emerald-600"} />
                    </div>
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold">{formatDeploymentProviderLabel(providerKey)}</p>
                      <p className={`truncate text-xs ${mutedText}`}>Will be enabled on confirm</p>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => undoAddProvider(providerKey)}
                    className={`inline-flex min-h-[34px] shrink-0 items-center justify-center gap-2 rounded-lg border px-3 text-xs font-semibold transition ${secondaryButton}`}
                  >
                    <FaMinus className="text-[10px]" />
                    Remove
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {isAdminUser ? (
        <section className={`w-full min-w-0 rounded-lg border ${borderColor} ${cardBgColor} p-4 sm:p-6`}>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <h3 className="text-lg font-semibold">Add providers</h3>
              <p className={`text-sm ${subtleText}`}>Choose an available provider and enter credentials to enable it.</p>
            </div>
            {availableProviderRows.length === 0 && (
              <span className={`text-sm ${mutedText}`}>All supported providers are enabled.</span>
            )}
          </div>

          {availableProviderRows.length > 0 && (
            <div className="mt-4 flex flex-wrap gap-2" role="tablist" aria-label="Available providers">
              {availableProviderRows.map((provider) => (
                <button
                  key={provider.key}
                  type="button"
                  onClick={() => selectProvider(provider.key)}
                  role="tab"
                  aria-selected={selectedProviderKey === provider.key}
                  className={`min-h-[40px] rounded-full border px-4 text-sm font-semibold transition ${
                    selectedProviderKey === provider.key ? activePill : idlePill
                  }`}
                >
                  {provider.label}
                </button>
              ))}
            </div>
          )}

          {selectedProviderKey && (
            <div className={`mt-5 rounded-lg border ${borderColor} ${mutedBg} p-4`}>
              <div className="flex min-w-0 flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <h4 className="text-base font-semibold">{formatDeploymentProviderLabel(selectedProviderKey)}</h4>
                  <p className={`text-sm ${subtleText}`}>
                    {(providerCapabilities[selectedProviderKey]?.requiredFor || []).join(", ") || "Provider credentials"}
                  </p>
                </div>
                {selectedValidationStatus?.ok && (
                  <span className="inline-flex w-fit items-center gap-2 rounded-full border border-emerald-400/30 bg-emerald-400/10 px-3 py-1 text-xs font-semibold text-emerald-400">
                    <FaCheck className="text-[10px]" />
                    Validated
                  </span>
                )}
              </div>

              <div className="mt-4 grid gap-3">
                {selectedCredentialFields.map((field) => (
                  field.type === "checkbox" ? (
                    <label key={field.name} className={`flex min-w-0 items-center gap-3 rounded-lg border ${borderColor} ${cardBgColor} px-3 py-3`}>
                      <input
                        type="checkbox"
                        checked={Boolean(selectedCredentials[field.name])}
                        onChange={(event) =>
                          updateCredentialValue(selectedProviderKey, field.name, event.target.checked)
                        }
                        className="h-4 w-4 accent-cyan-500"
                      />
                      <span className="text-sm font-semibold">{field.label}</span>
                    </label>
                  ) : (
                    <label key={field.name} className="block">
                      <span className="text-sm font-semibold">{field.label}</span>
                      {field.multiline ? (
                        <textarea
                          value={selectedCredentials[field.name] || ""}
                          onChange={(event) =>
                            updateCredentialValue(selectedProviderKey, field.name, event.target.value)
                          }
                          placeholder={field.placeholder}
                          className={`mt-2 min-h-[132px] w-full min-w-0 rounded-lg border ${borderColor} ${inputBg} px-3 py-3 text-sm outline-none placeholder:text-slate-500`}
                        />
                      ) : (
                        <input
                          type={field.type || "text"}
                          value={selectedCredentials[field.name] || ""}
                          onChange={(event) =>
                            updateCredentialValue(selectedProviderKey, field.name, event.target.value)
                          }
                          placeholder={field.placeholder}
                          className={`mt-2 min-h-[44px] w-full min-w-0 rounded-lg border ${borderColor} ${inputBg} px-3 text-sm outline-none placeholder:text-slate-500`}
                        />
                      )}
                    </label>
                  )
                ))}
              </div>

              {selectedValidationStatus && !selectedValidationStatus.ok && (
                <div className="mt-4 flex items-start gap-2 text-sm text-red-500">
                  <FaExclamationTriangle className="mt-1 shrink-0" />
                  <span>{selectedValidationStatus.message || "Credentials are not valid."}</span>
                </div>
              )}

              <div className="mt-4 flex justify-end">
                <button
                  type="button"
                  onClick={validateSelectedProvider}
                  disabled={isValidating}
                  className={`inline-flex min-h-[42px] w-full items-center justify-center gap-2 rounded-lg border px-4 text-sm font-semibold transition disabled:cursor-not-allowed disabled:opacity-60 sm:w-auto ${primaryButton}`}
                >
                  {isValidating ? (
                    <>
                      <FaCircleNotch className="animate-spin text-xs" />
                      Validating
                    </>
                  ) : (
                    <>
                      <FaPlus className="text-xs" />
                      Enable provider
                    </>
                  )}
                </button>
              </div>
            </div>
          )}
        </section>
      ) : (
        <section className={`w-full min-w-0 rounded-lg border ${borderColor} ${cardBgColor} p-4 sm:p-6`}>
          <h3 className="text-lg font-semibold">Admin access required</h3>
          <p className={`mt-1 text-sm ${subtleText}`}>Only an admin user can change Docker providers.</p>
        </section>
      )}

      {isAdminUser && hasPendingChanges && (
        <section className={`sticky bottom-4 z-20 w-full min-w-0 rounded-lg border ${borderColor} ${cardBgColor} p-4 shadow-xl`}>
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div className="min-w-0">
              <p className="text-sm font-semibold">Pending provider changes</p>
              <p className={`text-xs ${subtleText}`}>
                {pendingAdditionKeys.length > 0 ? `${pendingAdditionKeys.length} to add` : "No additions"}
                {" / "}
                {pendingRemovalKeys.length > 0 ? `${pendingRemovalKeys.length} to remove` : "No removals"}
              </p>
              <p className={`mt-1 text-xs ${mutedText}`}>
                Models after confirm: {nextAvailability.models.length ? nextAvailability.models.join(", ") : "none"}
              </p>
            </div>
            <button
              type="button"
              onClick={confirmProviderChanges}
              className={`inline-flex min-h-[44px] w-full items-center justify-center gap-2 rounded-lg border px-4 text-sm font-semibold transition sm:w-auto ${primaryButton}`}
            >
              <FaCheck className="text-xs" />
              Confirm and recreate containers
            </button>
          </div>
        </section>
      )}
    </div>
  );
}
