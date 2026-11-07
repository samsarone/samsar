import { formatUiStatus } from '../../utils/localization.js';
import { getUiLocale, formatUiNumber, formatUiDate } from '../../utils/localization.js';
import { useUiLanguage } from '../../hooks/useUiLanguage.js';
import { translateText as uiText } from '../../utils/localization.js';
import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import axios from "axios";

import { FaBolt, FaClock, FaDatabase, FaPlug, FaSync } from "react-icons/fa";
import { toast } from "react-toastify";

import SecondaryButton from "../common/SecondaryButton.tsx";
import { useColorMode } from "../../contexts/ColorMode.jsx";
import { getHeaders } from "../../utils/web.jsx";
import { IS_STANDALONE_DEPLOYMENT } from "../../utils/environment.jsx";
import {
  extractDeploymentProviders,
  fetchDeploymentProviderConfig,
  formatDeploymentProviderLabel,
  normalizeDeploymentProviderKey,
} from "../../utils/deploymentProviders.js";

const PROCESSOR_SERVER = import.meta.env.VITE_PROCESSOR_API;
const numberFormatter = { format: formatUiNumber };

const SOURCE_LABELS = {
  get chat_enhance() { return uiText("Chat Enhance"); },
  get image_update_set() { return uiText("Image list to set"); },
  get image_remove_branding() { return uiText("Image text removal"); },
  get image_enhance() { return uiText("Image upscale"); },
  get image_list_to_video() { return uiText("Image list to video"); },
  get text_to_image() { return uiText("Text to image"); },
  get image_to_video() { return uiText("Image to video"); },
  get text_to_video() { return uiText("Text to video"); },
  get text_to_speech() { return uiText("Text to speech"); },
  get text_to_music() { return uiText("Text to music"); },
  get text_to_sound_effect() { return uiText("Text to sound effect"); },
  get lip_sync() { return uiText("Lip sync"); },
  get transcription() { return uiText("Transcription"); },
  get narrative_inference() { return uiText("Narrative inference"); },
  get vision_inference() { return uiText("Vision inference"); },
  get subtitle_accent_inference() { return uiText("Subtitle accent inference"); },
};

const formatSourceLabel = (source) => {
  if (!source) return uiText("Unknown");
  if (SOURCE_LABELS[source]) return SOURCE_LABELS[source];
  return source
    .split("_")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
};

const formatMetadataSummary = (metadata) => {
  if (!metadata || typeof metadata !== "object") return "—";
  const parts = [];

  if (metadata.duration) parts.push(uiText("Duration: {duration}s", { duration: metadata.duration }));
  if (metadata.durationSeconds) parts.push(uiText("Duration: {duration}s", { duration: metadata.durationSeconds }));
  if (metadata.stageCount) parts.push(uiText("{count} stages", { count: metadata.stageCount }));
  if (metadata.imageCount) parts.push(uiText("Images: {value0}", { value0: metadata.imageCount }));
  if (metadata.targetImageCount) parts.push(uiText("Targets: {value0}", { value0: metadata.targetImageCount }));
  if (metadata.aspectRatio) parts.push(uiText("Aspect ratio: {value0}", { value0: metadata.aspectRatio }));
  if (metadata.resolution) parts.push(uiText("Resolution: {value0}", { value0: metadata.resolution }));
  if (metadata.sessionId) parts.push(uiText("Session: {value0}", { value0: metadata.sessionId }));
  if (metadata.videoGenerationModel) parts.push(uiText("Model: {value0}", { value0: metadata.videoGenerationModel }));
  if (metadata.pricing?.model) parts.push(uiText("Model: {value0}", { value0: metadata.pricing.model }));
  if (metadata.pricing?.mode) parts.push(uiText("Mode: {value0}", { value0: metadata.pricing.mode }));

  return parts.length > 0 ? parts.join(" • ") : "—";
};

const getUsageRequestType = (item = {}) => (
  item.requestType ||
  item.callType ||
  item.source ||
  item.metadata?.requestType ||
  item.metadata?.callType ||
  ""
);

const formatStandaloneModelJob = (item = {}) => {
  const metadata = item.metadata && typeof item.metadata === "object" ? item.metadata : {};
  const jobType = item.jobType || metadata.jobType;
  const model = item.model || metadata.model;
  const service = item.service || metadata.service;
  const parts = [];

  if (jobType) parts.push(jobType);
  if (model && model !== jobType) parts.push(model);
  if (service) parts.push(service);

  return parts.length > 0 ? parts.join(" • ") : "—";
};

const formatStandaloneStatus = (item = {}) => {
  const metadata = item.metadata && typeof item.metadata === "object" ? item.metadata : {};
  return formatUiStatus(item.status || metadata.status || "requested");
};

const getUsageSubRows = (item = {}) => (
  Array.isArray(item.subRows) ? item.subRows : []
);

const formatCredits = (value) => (
  numberFormatter.format(Math.max(0, Number.parseFloat(value || 0)))
);

const formatHostedDetails = (item = {}) => {
  const subRows = getUsageSubRows(item);
  if (subRows.length > 0) {
    return formatMetadataSummary({
      ...(item.metadata || {}),
      stageCount: item.metadata?.stageCount || subRows.length,
    });
  }
  return formatMetadataSummary(item.metadata);
};

const formatStageLabel = (item = {}) => {
  const metadata = item.metadata && typeof item.metadata === "object" ? item.metadata : {};
  return metadata.stageLabel || formatSourceLabel(metadata.stageKey || item.requestType || item.source);
};

const formatDate = (value) => {
  if (!value) return "—";
  return formatUiDate(value, { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' });
};

const PROVIDER_METADATA_KEYS = [
  "provider",
  "providerKey",
  "provider_key",
  "externalProvider",
  "external_provider",
  "modelProvider",
  "model_provider",
  "requestProvider",
  "request_provider",
  "sourceProvider",
  "source_provider",
];

const firstProviderCandidate = (candidates) => (
  candidates.find((candidate) => typeof candidate === "string" && candidate.trim()) || ""
);

const resolveUsageProviderValue = (item = {}) => {
  const metadata = item.metadata && typeof item.metadata === "object" ? item.metadata : {};
  return firstProviderCandidate([
    item.provider,
    item.providerKey,
    item.provider_key,
    item.externalProvider,
    item.external_provider,
    ...PROVIDER_METADATA_KEYS.map((key) => metadata[key]),
    metadata.pricing?.provider,
    metadata.pricing?.providerKey,
    metadata.request?.provider,
    metadata.request?.providerKey,
    metadata.input?.provider,
    metadata.input?.providerKey,
    metadata.model?.provider,
    metadata.model?.providerKey,
  ]);
};

function UsagePagination({ pagination, itemCount, loading, onPageChange, label }) {
  useUiLanguage();
  const { page, pageSize, totalItems = 0, totalPages, hasNextPage, hasPreviousPage } = pagination;
  const firstItem = itemCount ? (page - 1) * pageSize + 1 : 0;
  const lastItem = itemCount ? firstItem + itemCount - 1 : 0;

  return (
    <nav aria-label={label} className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
      <div className="text-sm text-fg-muted" aria-live="polite">
        <p>{uiText("Showing {value0}–{value1} of {value2}", { value0: numberFormatter.format(firstItem), value1: numberFormatter.format(lastItem), value2: numberFormatter.format(totalItems) })}</p>
        <p>{uiText("Page {value0} of {value1}", { value0: page, value1: totalPages || 1 })}</p>
      </div>
      <div className="grid grid-cols-2 gap-2 sm:flex">
        <SecondaryButton
          onClick={() => onPageChange(page - 1)}
          disabled={loading || !hasPreviousPage}
          className="w-full sm:w-auto"
        >{uiText("Previous")}</SecondaryButton>
        <SecondaryButton
          onClick={() => onPageChange(page + 1)}
          disabled={loading || !hasNextPage}
          className="w-full sm:w-auto"
        >{uiText("Next")}</SecondaryButton>
      </div>
    </nav>
  );
}

export default function UsagePanelContent() {
  const uiLanguage = useUiLanguage();
  const { colorMode } = useColorMode();
  const isStandaloneDeployment = IS_STANDALONE_DEPLOYMENT;

  const [usageLogs, setUsageLogs] = useState([]);
  const [pagination, setPagination] = useState({
    page: 1,
    pageSize: 25,
    totalItems: 0,
    totalPages: 1,
    hasNextPage: false,
    hasPreviousPage: false,
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const usageRequestRef = useRef(null);
  const [deploymentProviders, setDeploymentProviders] = useState([]);
  const [isLoadingDeploymentProviders, setIsLoadingDeploymentProviders] = useState(false);
  const [deploymentProviderError, setDeploymentProviderError] = useState("");

  const textColor = 'text-fg';
  const secondaryTextColor = 'text-fg-muted';
  const cardBgColor = 'bg-surface';
  const borderColor = 'border-line';
  const mutedBg = 'bg-surface-muted';
  const headerBg = colorMode === "dark" ? "bg-[#151720]" : "bg-slate-100";

  const fetchUsageLogs = useCallback(async (pageToLoad = 1, pageSize = 25) => {
    usageRequestRef.current?.abort();
    const controller = new AbortController();
    usageRequestRef.current = controller;
    setLoading(true);
    setError("");
    try {
      const headers = getHeaders() || {};
      const response = await axios.get(`${PROCESSOR_SERVER}/users/usage/logs`, {
        ...headers,
        params: { page: pageToLoad, pageSize },
        signal: controller.signal,
      });

      if (controller.signal.aborted) return;
      setUsageLogs(response.data?.items || []);
      setPagination((prev) => ({
        ...prev,
        page: pageToLoad,
        pageSize,
        ...(response.data?.pagination || {}),
      }));
    } catch  {
      if (controller.signal.aborted) return;
      setError(uiText("Unable to load usage logs. Please try again."));
      toast.error(uiText("Failed to load usage logs"), { position: "bottom-center" });
    } finally {
      if (!controller.signal.aborted) setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchUsageLogs(1);
    return () => usageRequestRef.current?.abort();
  }, [fetchUsageLogs]);

  useEffect(() => {
    if (!isStandaloneDeployment) return;

    let isCancelled = false;
    setIsLoadingDeploymentProviders(true);
    setDeploymentProviderError("");

    fetchDeploymentProviderConfig(PROCESSOR_SERVER, getHeaders())
      .then((payload) => {
        if (isCancelled) return;
        setDeploymentProviders(extractDeploymentProviders(payload));
      })
      .catch(() => {
        if (isCancelled) return;
        setDeploymentProviderError(uiText("Unable to load enabled providers."));
      })
      .finally(() => {
        if (!isCancelled) {
          setIsLoadingDeploymentProviders(false);
        }
      });

    return () => {
      isCancelled = true;
    };
  }, [isStandaloneDeployment]);

  const totalCreditsUsed = useMemo(
    () =>
      usageLogs.reduce(
        (sum, item) => sum + Math.max(0, Number.parseFloat(item.credits || 0)),
        0
      ),
    [usageLogs]
  );

  const lastActivity = usageLogs[0]?.createdAt;
  const enabledProviderRows = useMemo(() => (
    deploymentProviders.map((provider) => ({
      key: normalizeDeploymentProviderKey(provider),
      raw: provider,
      label: formatDeploymentProviderLabel(provider),
    }))
  ), [uiLanguage, deploymentProviders]);
  const providerCallStats = useMemo(() => {
    const stats = new Map();

    enabledProviderRows.forEach((provider) => {
      if (!provider.key) return;
      stats.set(provider.key, {
        ...provider,
        count: 0,
        isConfigured: true,
      });
    });

    let unrecordedProviderCount = 0;

    usageLogs.forEach((item) => {
      const rawProvider = resolveUsageProviderValue(item);
      const providerKey = normalizeDeploymentProviderKey(rawProvider);

      if (!providerKey) {
        unrecordedProviderCount += 1;
        return;
      }

      if (!stats.has(providerKey)) {
        stats.set(providerKey, {
          key: providerKey,
          raw: rawProvider,
          label: formatDeploymentProviderLabel(rawProvider),
          count: 0,
          isConfigured: false,
        });
      }

      stats.get(providerKey).count += 1;
    });

    if (unrecordedProviderCount > 0) {
      stats.set("unknown", {
        key: "unknown",
        raw: "",
        label: uiText("Unknown provider"),
        count: unrecordedProviderCount,
        isConfigured: false,
      });
    }

    return Array.from(stats.values()).sort((left, right) => {
      if (left.isConfigured !== right.isConfigured) {
        return left.isConfigured ? -1 : 1;
      }
      return left.label.localeCompare(right.label);
    });
  }, [uiLanguage, enabledProviderRows, usageLogs]);

  const goToPage = (pageToLoad) => {
    if (loading || pageToLoad < 1 || pageToLoad > (pagination.totalPages || 1)) return;
    fetchUsageLogs(pageToLoad, pagination.pageSize);
  };

  return (
    <div className={`flex min-w-0 flex-col gap-5 sm:gap-6 ${textColor}`}>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h2 className="text-2xl font-bold">{uiText("Usage")}</h2>
          <p className={`text-sm ${secondaryTextColor}`}>
            {isStandaloneDeployment
              ? uiText("Track generative requests by request type and provider.")
              : uiText("Track API calls, task totals, and stage-level credit distribution.")}
          </p>
        </div>
        <SecondaryButton
          onClick={() => fetchUsageLogs(pagination.page, pagination.pageSize)}
          isPending={loading}
          className="w-full sm:w-auto"
        >
          <FaSync className={`mr-2 ${loading ? "animate-spin" : ""}`} />{uiText("Refresh")}</SecondaryButton>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {!isStandaloneDeployment && (
          <div className={`rounded-lg border ${borderColor} ${cardBgColor} p-4`}>
            <div className="flex items-center gap-3">
              <div className="shrink-0 rounded-full bg-rose-500/10 p-3 text-rose-400">
                <FaBolt />
              </div>
              <div>
                <p className={`text-xs uppercase tracking-wide ${secondaryTextColor}`}>{uiText("Credits consumed (page)")}</p>
                <p className="text-2xl font-bold">
                  {numberFormatter.format(Math.round(totalCreditsUsed))}
                </p>
              </div>
            </div>
          </div>
        )}

        <div className={`rounded-lg border ${borderColor} ${cardBgColor} p-4`}>
          <div className="flex items-center gap-3">
            <div className="shrink-0 rounded-full bg-indigo-500/10 p-3 text-indigo-400">
              <FaDatabase />
            </div>
            <div>
              <p className={`text-xs uppercase tracking-wide ${secondaryTextColor}`}>{uiText("API calls (page)")}</p>
              <p className="text-2xl font-bold">{usageLogs.length}</p>
            </div>
          </div>
        </div>

        {isStandaloneDeployment && (
          <div className={`rounded-lg border ${borderColor} ${cardBgColor} p-4`}>
            <div className="flex items-center gap-3">
              <div className="shrink-0 rounded-full bg-cyan-500/10 p-3 text-cyan-400">
                <FaPlug />
              </div>
              <div>
                <p className={`text-xs uppercase tracking-wide ${secondaryTextColor}`}>{uiText("Enabled providers")}</p>
                <p className="text-2xl font-bold">{enabledProviderRows.length}</p>
              </div>
            </div>
          </div>
        )}

        <div className={`rounded-lg border ${borderColor} ${cardBgColor} p-4`}>
          <div className="flex items-center gap-3">
            <div className="shrink-0 rounded-full bg-emerald-500/10 p-3 text-emerald-400">
              <FaClock />
            </div>
            <div>
              <p className={`text-xs uppercase tracking-wide ${secondaryTextColor}`}>{uiText("Last activity")}</p>
              <p className="text-base font-semibold">
                {lastActivity ? formatDate(lastActivity) : uiText("No usage yet")}
              </p>
            </div>
          </div>
        </div>
      </div>

      {isStandaloneDeployment && (
        <div className={`min-w-0 rounded-lg border ${borderColor} ${cardBgColor} overflow-hidden`}>
          <div className={`flex flex-col gap-2 px-4 py-3 border-b sm:flex-row sm:items-center sm:justify-between ${borderColor} ${headerBg}`}>
            <div>
              <p className="text-lg font-semibold">{uiText("API calls by provider")}</p>
              <p className={`text-xs ${secondaryTextColor}`}>{uiText("Counts are for generative requests on the current usage-log page.")}</p>
            </div>
            {isLoadingDeploymentProviders && (
              <div className="flex items-center gap-2 text-sm">
                <FaSync className="animate-spin" />
                <span>{uiText("Loading providers...")}</span>
              </div>
            )}
          </div>

          {deploymentProviderError && (
            <div className="border-b border-red-500/20 px-4 py-3 text-sm text-red-500">
              {deploymentProviderError}
            </div>
          )}

          {providerCallStats.length === 0 ? (
            <div className="p-6 text-center">
              <p className="text-lg font-semibold">{uiText("No provider usage yet")}</p>
              <p className={`text-sm ${secondaryTextColor}`}>{uiText("Generative requests will be grouped by provider when usage is recorded.")}</p>
            </div>
          ) : (
            <div className="grid gap-3 p-4 sm:grid-cols-2 lg:grid-cols-3">
              {providerCallStats.map((provider) => (
                <div key={provider.key} className={`rounded-lg border ${borderColor} ${mutedBg} p-4`}>
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold">{provider.label}</p>
                      <p className={`truncate text-xs ${secondaryTextColor}`}>
                        {provider.isConfigured ? uiText("Enabled provider") : uiText("Observed in usage")}
                      </p>
                    </div>
                    <p className="shrink-0 text-2xl font-bold">{numberFormatter.format(provider.count)}</p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {error && <p role="alert" className="text-sm text-red-500">{error}</p>}

      <label className={`flex items-center gap-2 text-sm ${secondaryTextColor}`}>{uiText("Rows per page")}<select
          value={pagination.pageSize}
          disabled={loading}
          onChange={(event) => fetchUsageLogs(1, Number(event.target.value))}
          className={`app-field rounded-lg border ${borderColor} px-3 py-2 disabled:opacity-50`}
        >
          {[10, 25, 50, 100].map((size) => <option key={size} value={size}>{size}</option>)}
        </select>
      </label>
      <UsagePagination
        label={uiText("Usage pagination above table")}
        pagination={pagination}
        itemCount={usageLogs.length}
        loading={loading}
        onPageChange={goToPage}
      />

      <div aria-busy={loading} className={`min-w-0 rounded-lg border ${borderColor} ${cardBgColor} overflow-hidden`}>
        <div className={`flex flex-col gap-2 px-4 py-3 border-b sm:flex-row sm:items-center sm:justify-between ${borderColor} ${headerBg}`}>
          <div>
            <p className="text-lg font-semibold">{uiText("Usage log")}</p>
            <p className={`text-xs ${secondaryTextColor}`}>
              {isStandaloneDeployment
                ? uiText("Showing generative request audit logs (page {value0}) with {value1} per page.", { value0: pagination.page || 1, value1: pagination.pageSize })
                : uiText("Showing API charges and grouped task stage charges (page {value0}) with {value1} per page.", { value0: pagination.page || 1, value1: pagination.pageSize })}
            </p>
          </div>
          {loading && (
            <div className="flex items-center gap-2 text-sm">
              <FaSync className="animate-spin" />
              <span>{uiText("Loading...")}</span>
            </div>
          )}
        </div>

        {usageLogs.length === 0 && !loading && !error ? (
          <div className="p-6 text-center">
            <p className="text-lg font-semibold">{uiText("No usage yet")}</p>
            <p className={`text-sm ${secondaryTextColor}`}>
              {isStandaloneDeployment
                ? uiText("Generative requests will appear here with request type and provider details.")
                : uiText("Calls you make with your API key will appear here with credit details.")}
            </p>
          </div>
        ) : (
          <div className="max-w-full overflow-x-auto">
            <table className={isStandaloneDeployment ? "min-w-[900px] text-sm" : "min-w-[920px] text-sm"}>
              <thead className={headerBg}>
                {isStandaloneDeployment ? (
                  <tr>
                    <th className="px-4 py-3 text-left">{uiText("Request type")}</th>
                    <th className="px-4 py-3 text-left">{uiText("Provider")}</th>
                    <th className="px-4 py-3 text-left">{uiText("Model / job")}</th>
                    <th className="px-4 py-3 text-left">{uiText("Status")}</th>
                    <th className="px-4 py-3 text-left">{uiText("Time")}</th>
                  </tr>
                ) : (
                  <tr>
                    <th className="px-4 py-3 text-left">{uiText("Endpoint")}</th>
                    <th className="px-4 py-3 text-left">{uiText("Credits consumed")}</th>
                    <th className="px-4 py-3 text-left">{uiText("Details")}</th>
                    <th className="px-4 py-3 text-left">{uiText("Balance")}</th>
                    <th className="px-4 py-3 text-left">{uiText("Time")}</th>
                  </tr>
                )}
              </thead>
              <tbody>
                {usageLogs.map((item, index) => {
                  const providerValue = resolveUsageProviderValue(item);
                  const providerLabel = providerValue
                    ? formatDeploymentProviderLabel(providerValue)
                    : uiText("Unknown provider");
                  const requestTypeLabel = formatSourceLabel(getUsageRequestType(item));
                  const subRows = getUsageSubRows(item);

                  return (
                    <Fragment key={item.id || index}>
                      <tr
                        className={`border-t ${borderColor} ${
                          index % 2 === 0 ? mutedBg : ""
                        }`}
                      >
                        {isStandaloneDeployment ? (
                          <>
                            <td className="px-4 py-3 font-medium">{requestTypeLabel}</td>
                            <td className="px-4 py-3 font-medium">{providerLabel}</td>
                            <td className={`px-4 py-3 ${secondaryTextColor}`}>
                              {formatStandaloneModelJob(item)}
                            </td>
                            <td className={`px-4 py-3 ${secondaryTextColor}`}>
                              {formatStandaloneStatus(item)}
                            </td>
                            <td className={`px-4 py-3 ${secondaryTextColor}`}>
                              {formatDate(item.createdAt)}
                            </td>
                          </>
                        ) : (
                          <>
                            <td className="px-4 py-3 font-medium">
                              {formatSourceLabel(item.source)}
                              {subRows.length > 0 && (
                                <span className={`ml-2 text-xs font-normal ${secondaryTextColor}`}>{uiText("grouped")}</span>
                              )}
                            </td>
                            <td className="px-4 py-3">
                              <span className="font-semibold text-rose-400">
                                -{formatCredits(item.credits)}
                              </span>
                            </td>
                            <td className={`px-4 py-3 ${secondaryTextColor}`}>
                              {formatHostedDetails(item)}
                            </td>
                            <td className="px-4 py-3">
                              {item.balanceAfter === null || item.balanceAfter === undefined
                                ? "—"
                                : numberFormatter.format(item.balanceAfter)}
                            </td>
                            <td className={`px-4 py-3 ${secondaryTextColor}`}>
                              {formatDate(item.createdAt)}
                            </td>
                          </>
                        )}
                      </tr>
                      {!isStandaloneDeployment && subRows.map((subRow) => (
                        <tr
                          key={`${item.id || index}-${subRow.id}`}
                          className={`border-t ${borderColor} ${
                            colorMode === "dark" ? "bg-[#151720]/55" : "bg-slate-50/70"
                          }`}
                        >
                          <td className="px-4 py-2 pl-8">
                            <div className="text-xs uppercase tracking-wide text-slate-400">{uiText("Stage")}</div>
                            <div className="font-medium">{formatStageLabel(subRow)}</div>
                          </td>
                          <td className="px-4 py-2">
                            <span className="font-semibold text-rose-400">
                              -{formatCredits(subRow.credits)}
                            </span>
                          </td>
                          <td className={`px-4 py-2 ${secondaryTextColor}`}>
                            {formatMetadataSummary(subRow.metadata)}
                          </td>
                          <td className="px-4 py-2">
                            {subRow.balanceAfter === null || subRow.balanceAfter === undefined
                              ? "—"
                              : numberFormatter.format(subRow.balanceAfter)}
                          </td>
                          <td className={`px-4 py-2 ${secondaryTextColor}`}>
                            {formatDate(subRow.createdAt)}
                          </td>
                        </tr>
                      ))}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <UsagePagination
        label={uiText("Usage pagination below table")}
        pagination={pagination}
        itemCount={usageLogs.length}
        loading={loading}
        onPageChange={goToPage}
      />
    </div>
  );
}
