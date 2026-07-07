import { Fragment, useEffect, useMemo, useState } from "react";
import axios from "axios";
import dayjs from "dayjs";
import { FaBolt, FaClock, FaDatabase, FaPlug, FaSync } from "react-icons/fa";
import { toast } from "react-toastify";

import SecondaryButton from "../common/SecondaryButton.tsx";
import { useColorMode } from "../../contexts/ColorMode.jsx";
import { getHeaders } from "../../utils/web.jsx";
import { getSessionType } from "../../utils/environment.jsx";
import {
  extractDeploymentProviders,
  fetchDeploymentProviderConfig,
  formatDeploymentProviderLabel,
  normalizeDeploymentProviderKey,
} from "../../utils/deploymentProviders.js";

const PROCESSOR_SERVER = import.meta.env.VITE_PROCESSOR_API;
const numberFormatter = new Intl.NumberFormat("en-US");

const SOURCE_LABELS = {
  chat_enhance: "Chat Enhance",
  image_update_set: "Image list to set",
  image_remove_branding: "Image text removal",
  image_enhance: "Image upscale",
  image_list_to_video: "Image list to video",
  text_to_image: "Text to image",
  image_to_video: "Image to video",
  text_to_video: "Text to video",
  text_to_speech: "Text to speech",
  text_to_music: "Text to music",
  text_to_sound_effect: "Text to sound effect",
  lip_sync: "Lip sync",
  transcription: "Transcription",
  narrative_inference: "Narrative inference",
  vision_inference: "Vision inference",
  subtitle_accent_inference: "Subtitle accent inference",
};

const formatSourceLabel = (source) => {
  if (!source) return "Unknown";
  if (SOURCE_LABELS[source]) return SOURCE_LABELS[source];
  return source
    .split("_")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
};

const formatMetadataSummary = (metadata) => {
  if (!metadata || typeof metadata !== "object") return "—";
  const parts = [];

  if (metadata.duration) parts.push(`Duration: ${metadata.duration}s`);
  if (metadata.durationSeconds) parts.push(`Duration: ${metadata.durationSeconds}s`);
  if (metadata.stageCount) parts.push(`${metadata.stageCount} stages`);
  if (metadata.imageCount) parts.push(`Images: ${metadata.imageCount}`);
  if (metadata.targetImageCount) parts.push(`Targets: ${metadata.targetImageCount}`);
  if (metadata.aspectRatio) parts.push(`Aspect ratio: ${metadata.aspectRatio}`);
  if (metadata.resolution) parts.push(`Resolution: ${metadata.resolution}`);
  if (metadata.sessionId) parts.push(`Session: ${metadata.sessionId}`);
  if (metadata.videoGenerationModel) parts.push(`Model: ${metadata.videoGenerationModel}`);
  if (metadata.pricing?.model) parts.push(`Model: ${metadata.pricing.model}`);
  if (metadata.pricing?.mode) parts.push(`Mode: ${metadata.pricing.mode}`);

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

const formatDockerModelJob = (item = {}) => {
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

const formatDockerStatus = (item = {}) => {
  const metadata = item.metadata && typeof item.metadata === "object" ? item.metadata : {};
  return item.status || metadata.status || "requested";
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
  const parsed = dayjs(value);
  return parsed.isValid() ? parsed.format("MMM D, YYYY h:mm A") : value;
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

export default function UsagePanelContent() {
  const { colorMode } = useColorMode();
  const isDockerInstall = getSessionType() === "docker";

  const [usageLogs, setUsageLogs] = useState([]);
  const [pagination, setPagination] = useState({
    page: 1,
    pageSize: 25,
    totalPages: 1,
    hasNextPage: false,
    hasPreviousPage: false,
  });
  const [loading, setLoading] = useState(false);
  const [deploymentProviders, setDeploymentProviders] = useState([]);
  const [isLoadingDeploymentProviders, setIsLoadingDeploymentProviders] = useState(false);
  const [deploymentProviderError, setDeploymentProviderError] = useState("");

  const textColor = colorMode === "dark" ? "text-slate-100" : "text-slate-900";
  const secondaryTextColor = colorMode === "dark" ? "text-slate-400" : "text-slate-500";
  const cardBgColor = colorMode === "dark" ? "bg-[#0f1629]" : "bg-white";
  const borderColor = colorMode === "dark" ? "border-[#1f2a3d]" : "border-slate-200";
  const mutedBg = colorMode === "dark" ? "bg-[#111a2f]" : "bg-slate-50";
  const headerBg = colorMode === "dark" ? "bg-[#0b1224]" : "bg-slate-100";

  const fetchUsageLogs = async (pageToLoad = 1) => {
    setLoading(true);
    try {
      const headers = getHeaders() || {};
      const response = await axios.get(`${PROCESSOR_SERVER}/users/usage/logs`, {
        ...headers,
        params: { page: pageToLoad, pageSize: pagination.pageSize },
      });

      setUsageLogs(response.data?.items || []);
      setPagination((prev) => ({
        ...prev,
        ...(response.data?.pagination || {}),
      }));
    } catch  {
      toast.error("Failed to load usage logs", { position: "bottom-center" });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchUsageLogs(1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!isDockerInstall) return;

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
        setDeploymentProviderError("Unable to load enabled providers.");
      })
      .finally(() => {
        if (!isCancelled) {
          setIsLoadingDeploymentProviders(false);
        }
      });

    return () => {
      isCancelled = true;
    };
  }, [isDockerInstall]);

  const totalCreditsUsed = useMemo(
    () =>
      usageLogs.reduce(
        (sum, item) => sum + Math.max(0, Number.parseFloat(item.credits || 0)),
        0
      ),
    [usageLogs]
  );

  const lastActivity = usageLogs[0]?.createdAt;
  const disablePrev = loading || !pagination.hasPreviousPage;
  const disableNext = loading || !pagination.hasNextPage;
  const enabledProviderRows = useMemo(() => (
    deploymentProviders.map((provider) => ({
      key: normalizeDeploymentProviderKey(provider),
      raw: provider,
      label: formatDeploymentProviderLabel(provider),
    }))
  ), [deploymentProviders]);
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
        label: "Unknown provider",
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
  }, [enabledProviderRows, usageLogs]);

  const goToPage = (pageToLoad) => {
    if (pageToLoad < 1) return;
    fetchUsageLogs(pageToLoad);
  };

  return (
    <div className={`flex min-w-0 flex-col gap-5 sm:gap-6 ${textColor}`}>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h2 className="text-2xl font-bold">Usage</h2>
          <p className={`text-sm ${secondaryTextColor}`}>
            {isDockerInstall
              ? "Track generative requests by request type and provider."
              : "Track API calls, task totals, and stage-level credit distribution."}
          </p>
        </div>
        <SecondaryButton
          onClick={() => fetchUsageLogs(pagination.page)}
          isPending={loading}
          className="w-full sm:w-auto"
        >
          <FaSync className={`mr-2 ${loading ? "animate-spin" : ""}`} />
          Refresh
        </SecondaryButton>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {!isDockerInstall && (
          <div className={`rounded-lg border ${borderColor} ${cardBgColor} p-4`}>
            <div className="flex items-center gap-3">
              <div className="shrink-0 rounded-full bg-rose-500/10 p-3 text-rose-400">
                <FaBolt />
              </div>
              <div>
                <p className={`text-xs uppercase tracking-wide ${secondaryTextColor}`}>
                  Credits consumed (page)
                </p>
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
              <p className={`text-xs uppercase tracking-wide ${secondaryTextColor}`}>
                API calls (page)
              </p>
              <p className="text-2xl font-bold">{usageLogs.length}</p>
            </div>
          </div>
        </div>

        {isDockerInstall && (
          <div className={`rounded-lg border ${borderColor} ${cardBgColor} p-4`}>
            <div className="flex items-center gap-3">
              <div className="shrink-0 rounded-full bg-cyan-500/10 p-3 text-cyan-400">
                <FaPlug />
              </div>
              <div>
                <p className={`text-xs uppercase tracking-wide ${secondaryTextColor}`}>
                  Enabled providers
                </p>
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
              <p className={`text-xs uppercase tracking-wide ${secondaryTextColor}`}>
                Last activity
              </p>
              <p className="text-base font-semibold">
                {lastActivity ? formatDate(lastActivity) : "No usage yet"}
              </p>
            </div>
          </div>
        </div>
      </div>

      {isDockerInstall && (
        <div className={`min-w-0 rounded-lg border ${borderColor} ${cardBgColor} overflow-hidden`}>
          <div className={`flex flex-col gap-2 px-4 py-3 border-b sm:flex-row sm:items-center sm:justify-between ${borderColor} ${headerBg}`}>
            <div>
              <p className="text-lg font-semibold">API calls by provider</p>
              <p className={`text-xs ${secondaryTextColor}`}>
                Counts are for generative requests on the current usage-log page.
              </p>
            </div>
            {isLoadingDeploymentProviders && (
              <div className="flex items-center gap-2 text-sm">
                <FaSync className="animate-spin" />
                <span>Loading providers...</span>
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
              <p className="text-lg font-semibold">No provider usage yet</p>
              <p className={`text-sm ${secondaryTextColor}`}>
                Generative requests will be grouped by provider when usage is recorded.
              </p>
            </div>
          ) : (
            <div className="grid gap-3 p-4 sm:grid-cols-2 lg:grid-cols-3">
              {providerCallStats.map((provider) => (
                <div key={provider.key} className={`rounded-lg border ${borderColor} ${mutedBg} p-4`}>
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold">{provider.label}</p>
                      <p className={`truncate text-xs ${secondaryTextColor}`}>
                        {provider.isConfigured ? "Enabled provider" : "Observed in usage"}
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

      <div className={`min-w-0 rounded-lg border ${borderColor} ${cardBgColor} overflow-hidden`}>
        <div className={`flex flex-col gap-2 px-4 py-3 border-b sm:flex-row sm:items-center sm:justify-between ${borderColor} ${headerBg}`}>
          <div>
            <p className="text-lg font-semibold">Usage log</p>
            <p className={`text-xs ${secondaryTextColor}`}>
              {isDockerInstall
                ? `Showing generative request audit logs (page ${pagination.page || 1}) with ${pagination.pageSize} per page.`
                : `Showing API charges and grouped task stage charges (page ${pagination.page || 1}) with ${pagination.pageSize} per page.`}
            </p>
          </div>
          {loading && (
            <div className="flex items-center gap-2 text-sm">
              <FaSync className="animate-spin" />
              <span>Loading...</span>
            </div>
          )}
        </div>

        {usageLogs.length === 0 && !loading ? (
          <div className="p-6 text-center">
            <p className="text-lg font-semibold">No usage yet</p>
            <p className={`text-sm ${secondaryTextColor}`}>
              {isDockerInstall
                ? "Generative requests will appear here with request type and provider details."
                : "Calls you make with your API key will appear here with credit details."}
            </p>
          </div>
        ) : (
          <div className="max-w-full overflow-x-auto">
            <table className={isDockerInstall ? "min-w-[900px] text-sm" : "min-w-[920px] text-sm"}>
              <thead className={headerBg}>
                {isDockerInstall ? (
                  <tr>
                    <th className="px-4 py-3 text-left">Request type</th>
                    <th className="px-4 py-3 text-left">Provider</th>
                    <th className="px-4 py-3 text-left">Model / job</th>
                    <th className="px-4 py-3 text-left">Status</th>
                    <th className="px-4 py-3 text-left">Time</th>
                  </tr>
                ) : (
                  <tr>
                    <th className="px-4 py-3 text-left">Endpoint</th>
                    <th className="px-4 py-3 text-left">Credits consumed</th>
                    <th className="px-4 py-3 text-left">Details</th>
                    <th className="px-4 py-3 text-left">Balance</th>
                    <th className="px-4 py-3 text-left">Time</th>
                  </tr>
                )}
              </thead>
              <tbody>
                {usageLogs.map((item, index) => {
                  const providerValue = resolveUsageProviderValue(item);
                  const providerLabel = providerValue
                    ? formatDeploymentProviderLabel(providerValue)
                    : "Unknown provider";
                  const requestTypeLabel = formatSourceLabel(getUsageRequestType(item));
                  const subRows = getUsageSubRows(item);

                  return (
                    <Fragment key={item.id || index}>
                      <tr
                        className={`border-t ${borderColor} ${
                          index % 2 === 0 ? mutedBg : ""
                        }`}
                      >
                        {isDockerInstall ? (
                          <>
                            <td className="px-4 py-3 font-medium">{requestTypeLabel}</td>
                            <td className="px-4 py-3 font-medium">{providerLabel}</td>
                            <td className={`px-4 py-3 ${secondaryTextColor}`}>
                              {formatDockerModelJob(item)}
                            </td>
                            <td className={`px-4 py-3 ${secondaryTextColor}`}>
                              {formatDockerStatus(item)}
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
                                <span className={`ml-2 text-xs font-normal ${secondaryTextColor}`}>
                                  grouped
                                </span>
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
                      {!isDockerInstall && subRows.map((subRow) => (
                        <tr
                          key={`${item.id || index}-${subRow.id}`}
                          className={`border-t ${borderColor} ${
                            colorMode === "dark" ? "bg-[#0b1224]/55" : "bg-slate-50/70"
                          }`}
                        >
                          <td className="px-4 py-2 pl-8">
                            <div className="text-xs uppercase tracking-wide text-slate-400">Stage</div>
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

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <p className={`text-sm ${secondaryTextColor}`}>
          Page {pagination.page} of {pagination.totalPages || 1}
        </p>
        <div className="grid grid-cols-2 gap-2 sm:flex">
          <SecondaryButton
            onClick={() => {
              if (disablePrev) return;
              goToPage((pagination.page || 1) - 1);
            }}
            extraClasses={disablePrev ? "opacity-50 pointer-events-none" : ""}
            className="w-full sm:w-auto"
            isPending={loading && pagination.hasPreviousPage}
          >
            Previous
          </SecondaryButton>
          <SecondaryButton
            onClick={() => {
              if (disableNext) return;
              goToPage((pagination.page || 1) + 1);
            }}
            extraClasses={disableNext ? "opacity-50 pointer-events-none" : ""}
            className="w-full sm:w-auto"
            isPending={loading && pagination.hasNextPage}
          >
            Next
          </SecondaryButton>
        </div>
      </div>
    </div>
  );
}
