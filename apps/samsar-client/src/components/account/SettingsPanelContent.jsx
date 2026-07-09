import { useEffect, useMemo, useRef, useState } from "react";
import { FaChevronDown, FaChevronRight, FaPause, FaPlay } from "react-icons/fa";
import { useLocation, useNavigate } from "react-router-dom";
import axios from "axios";
import { toast } from "react-toastify";

import SecondaryButton from "../common/SecondaryButton.tsx";
import { useColorMode } from "../../contexts/ColorMode.jsx";
import { useUser } from "../../contexts/UserContext.jsx";
import { useLocalization } from "../../contexts/LocalizationContext.jsx";
import { useAlertDialog } from "../../contexts/AlertDialogContext.jsx";
import { getHeaders } from "../../utils/web.jsx";
import { SUPPORTED_LANGUAGES } from "../../constants/supportedLanguages.js";
import {
  getFontOptionsForLanguage,
  mergeFontPreferencesWithDefaults,
} from "../../constants/fontPreferences.js";
import {
  AGENT_SPEAKER_GROUPS,
  buildSpeakerOptionsPayload,
  normalizeSpeakerOptionsState,
} from "../../constants/speakers/agentSpeakers.js";
import {
  fetchGoogleTTSPreviewBlobUrl,
  useGoogleTTSSpeakers,
} from "../../hooks/useGoogleTTSSpeakers.js";
import { useAudioProviderAvailability } from "../../hooks/useAudioProviderAvailability.js";
import {
  filterMusicProvidersForAudioAvailability,
  filterSpeakerGroupsForAudioAvailability,
} from "../../constants/audioProviderAvailability.js";

const BACKING_TRACK_MODEL_OPTIONS = [
  { value: "ELEVENLABS_MUSIC", label: "ElevenLabs" },
  { value: "LYRIA3", label: "Lyria 3" },
  { value: "CUSTOM_TEXT_TO_MUSIC", label: "Custom Text to Music" },
];

function normalizeBackingTrackModelValue(value) {
  return value === "LYRIA2" ? "LYRIA3" : value || "ELEVENLABS_MUSIC";
}

const SETTINGS_TABS = [
  { key: "general", label: "General" },
  { key: "fonts", label: "Fonts" },
  { key: "agent", label: "Agent" },
  { key: "security", label: "Security" },
  { key: "danger", label: "Danger" },
];

const SETTINGS_TAB_KEYS = SETTINGS_TABS.map((tab) => tab.key);
const CUSTOM_ADAPTER_FIELDS = [
  "api_key",
  "base_url",
  "text_to_image",
  "text_to_image_authorization",
  "text_to_video",
  "text_to_video_authorization",
  "image_to_video",
  "image_to_video_authorization",
  "text_to_speech",
  "text_to_speech_authorization",
  "text_to_music",
  "text_to_music_authorization",
  "text_to_sound_effect",
  "text_to_sound_effect_authorization",
];
const CUSTOM_ENDPOINT_OPERATION_OPTIONS = [
  { key: "image_to_video", label: "Image to video" },
  { key: "text_to_image", label: "Text to image" },
  { key: "text_to_video", label: "Text to video" },
  { key: "text_to_speech", label: "Text to speech" },
  { key: "text_to_music", label: "Text to music" },
  { key: "text_to_sound_effect", label: "Text to sound effect" },
];
const CUSTOM_ENDPOINT_OPERATION_KEYS = new Set(
  CUSTOM_ENDPOINT_OPERATION_OPTIONS.map((option) => option.key)
);
const DEFAULT_CUSTOM_ENDPOINT_BASE_URL = "https://queue.fal.run";
const DEFAULT_HAPPY_HORSE_ENDPOINT = "alibaba/happy-horse/v1.1/image-to-video";

function resolveSettingsTabFromPath(pathname) {
  const segments = pathname.split("/").filter(Boolean);
  const requestedTab = segments[2];
  return SETTINGS_TAB_KEYS.includes(requestedTab) ? requestedTab : "general";
}

function getSettingsTabPath(tabKey) {
  return tabKey === "general" ? "/account/settings" : `/account/settings/${tabKey}`;
}

function createCustomEndpointId() {
  return `custom_endpoint_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function createEmptyCustomEndpoint(overrides = {}) {
  return {
    id: createCustomEndpointId(),
    name: "",
    operation: "image_to_video",
    base_url: DEFAULT_CUSTOM_ENDPOINT_BASE_URL,
    api_key: "",
    endpoint: DEFAULT_HAPPY_HORSE_ENDPOINT,
    provider: "fal",
    ...overrides,
  };
}

function normalizeAuthorizationMode(value) {
  return value === "deployed" ? "deployed" : "native";
}

function normalizeCustomEndpointForForm(endpoint, index = 0) {
  const source = endpoint && typeof endpoint === "object" ? endpoint : {};
  const rawOperation =
    typeof source.operation === "string" ? source.operation.trim() : "image_to_video";
  const operation = CUSTOM_ENDPOINT_OPERATION_KEYS.has(rawOperation)
    ? rawOperation
    : "image_to_video";
  const fallbackId =
    typeof source.id === "string" && source.id.trim()
      ? source.id.trim()
      : `custom_endpoint_${index + 1}`;

  return {
    id: fallbackId,
    name: typeof source.name === "string" ? source.name : "",
    operation,
    base_url:
      typeof source.base_url === "string"
        ? source.base_url
        : typeof source.baseUrl === "string"
          ? source.baseUrl
          : "",
    api_key:
      typeof source.api_key === "string"
        ? source.api_key
        : typeof source.apiKey === "string"
          ? source.apiKey
          : "",
    has_api_key: source.has_api_key === true || source.hasApiKey === true,
    endpoint:
      typeof source.endpoint === "string"
        ? source.endpoint
        : typeof source.path === "string"
          ? source.path
          : typeof source.route === "string"
            ? source.route
            : typeof source.url === "string"
              ? source.url
              : "",
    provider: typeof source.provider === "string" && source.provider.trim()
      ? source.provider.trim()
      : "fal",
    authorization: normalizeAuthorizationMode(source.authorization),
  };
}

function normalizeCustomEndpointsForForm(customAdapters) {
  const source = customAdapters && typeof customAdapters === "object" ? customAdapters : {};
  const configuredEndpoints = Array.isArray(source.custom_endpoints)
    ? source.custom_endpoints
    : Array.isArray(source.customEndpoints)
      ? source.customEndpoints
      : [];

  const endpointRows = configuredEndpoints
    .map((endpoint, index) => normalizeCustomEndpointForForm(endpoint, index))
    .filter((endpoint) => endpoint.base_url || endpoint.endpoint || endpoint.api_key || endpoint.name);

  if (endpointRows.length > 0) {
    return endpointRows;
  }

  const legacyBaseUrl = typeof source.base_url === "string" ? source.base_url : "";
  const legacyApiKey = typeof source.api_key === "string" ? source.api_key : "";
  const legacyRows = CUSTOM_ENDPOINT_OPERATION_OPTIONS
    .map((operation) => {
      const endpoint = typeof source[operation.key] === "string" ? source[operation.key] : "";
      if (!endpoint.trim()) {
        return null;
      }
      return normalizeCustomEndpointForForm({
        id: `legacy_${operation.key}`,
        name: operation.label,
        operation: operation.key,
        base_url: legacyBaseUrl,
        api_key: legacyApiKey,
        endpoint,
        provider: "fal",
      });
    })
    .filter(Boolean);

  return legacyRows.length > 0 ? legacyRows : [createEmptyCustomEndpoint()];
}

function normalizeCustomAdaptersForForm(customAdapters) {
  const source = customAdapters && typeof customAdapters === "object" ? customAdapters : {};
  const normalized = CUSTOM_ADAPTER_FIELDS.reduce((acc, field) => {
    acc[field] = typeof source[field] === "string" ? source[field] : "";
    return acc;
  }, {});
  normalized.custom_endpoints = normalizeCustomEndpointsForForm(source);
  return normalized;
}

function buildCustomAdaptersPayload(customAdapters) {
  const endpointRows = Array.isArray(customAdapters.custom_endpoints)
    ? customAdapters.custom_endpoints
    : [];
  const customEndpoints = [];

  for (let index = 0; index < endpointRows.length; index += 1) {
    const row = endpointRows[index] || {};
    const hasAnyValue = [
      row.name,
      row.base_url,
      row.api_key,
      row.endpoint,
    ].some((value) => typeof value === "string" && value.trim());

    if (!hasAnyValue) {
      continue;
    }

    const operation = typeof row.operation === "string" ? row.operation.trim() : "";
    if (!CUSTOM_ENDPOINT_OPERATION_KEYS.has(operation)) {
      return { error: `Endpoint ${index + 1} has an unsupported operation.` };
    }

    const baseUrl = row.base_url?.trim();
    const endpoint = row.endpoint?.trim();
    if (!baseUrl) {
      return { error: `Base URL is required for endpoint ${index + 1}.` };
    }
    if (!endpoint) {
      return { error: `Model endpoint is required for endpoint ${index + 1}.` };
    }
    if (!row.api_key?.trim() && row.has_api_key !== true) {
      return { error: `API key is required for endpoint ${index + 1}.` };
    }

    customEndpoints.push({
      id: row.id?.trim() || `custom_endpoint_${index + 1}`,
      name: row.name?.trim() || endpoint,
      provider: row.provider?.trim() || "fal",
      operation,
      base_url: baseUrl,
      ...(row.authorization === "deployed" ? { authorization: "deployed" } : {}),
      ...(row.api_key?.trim() ? { api_key: row.api_key.trim() } : {}),
      ...(row.has_api_key === true ? { has_api_key: true } : {}),
      endpoint,
    });
  }

  if (customEndpoints.length > 0) {
    return {
      customAdapters: {
        custom_endpoints: customEndpoints,
      },
    };
  }

  const payload = CUSTOM_ADAPTER_FIELDS.reduce((acc, field) => {
    const value = customAdapters[field]?.trim();
    if (value) {
      acc[field] = value;
    }
    return acc;
  }, {});

  if (Object.keys(payload).length === 0) {
    return { customAdapters: null };
  }

  if (!payload.base_url) {
    return { error: "Base URL is required for custom configuration." };
  }

  return { customAdapters: payload };
}

export default function SettingsPanelContent(props) {
  const {
    logoutUser,
    updateUserDetails,
    deleteAllProjectsForUser,
    deleteAllGenerationsForUser,
    deleteAccountForUser,
  } = props;
  const { colorMode } = useColorMode();
  const { openAlertDialog, closeAlertDialog } = useAlertDialog();
  const { user } = useUser();
  const { t, setLanguage } = useLocalization();
  const navigate = useNavigate();
  const location = useLocation();

  const textColor = colorMode === "dark" ? "text-slate-100" : "text-slate-900";
  const cardBgColor = colorMode === "dark" ? "bg-[#0f1629]" : "bg-white";
  const secondaryTextColor = colorMode === "dark" ? "text-slate-400" : "text-slate-600";
  const borderColor = colorMode === "dark" ? "border-[#1f2a3d]" : "border-slate-200";
  const inputBgColor = colorMode === "dark" ? "bg-[#0b1224]" : "bg-white";
  const mutedBg = colorMode === "dark" ? "bg-[#111a2f]" : "bg-slate-50";
  const PROCESSOR_SERVER = import.meta.env.VITE_PROCESSOR_API;

  const [activeTab, setActiveTab] = useState(() => resolveSettingsTabFromPath(location.pathname));
  const [username, setUsername] = useState(user.username || "");
  const [preferredLanguage, setPreferredLanguage] = useState(user.preferredLanguage || "en");
  const [backingTrackModel, setBackingTrackModel] = useState(
    normalizeBackingTrackModelValue(user.backingTrackModel)
  );
  const [fontPreferences, setFontPreferences] = useState(() =>
    mergeFontPreferencesWithDefaults(user?.fontPreferences)
  );
  const [speakerOptions, setSpeakerOptions] = useState(() =>
    normalizeSpeakerOptionsState(user?.speakerOptions)
  );
  const [customAdapters, setCustomAdapters] = useState(() =>
    normalizeCustomAdaptersForForm(user?.custom_adapters)
  );
  const [expandedSpeakerProvider, setExpandedSpeakerProvider] = useState("OPENAI");
  const [currentlyPlayingSpeaker, setCurrentlyPlayingSpeaker] = useState(null);
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmNewPassword, setConfirmNewPassword] = useState("");

  const audioPreviewRef = useRef(null);
  const audioPreviewObjectUrlRef = useRef(null);
  const {
    googleSpeakers,
    isLoading: googleSpeakersLoading,
    error: googleSpeakersError,
    source: googleSpeakersSource,
  } = useGoogleTTSSpeakers();
  const { audioAvailability } = useAudioProviderAvailability();
  const availableBackingTrackModelOptions = useMemo(
    () => filterMusicProvidersForAudioAvailability(
      BACKING_TRACK_MODEL_OPTIONS.map((option) => ({ ...option, key: option.value, name: option.label })),
      audioAvailability
    ).map((option) => ({ value: option.value, label: option.label })),
    [audioAvailability]
  );
  const speakerGroups = useMemo(() => (
    filterSpeakerGroupsForAudioAvailability(AGENT_SPEAKER_GROUPS.map((group) => (
      group.key === "GOOGLE"
        ? { ...group, speakers: googleSpeakers }
        : group
    )), audioAvailability)
  ), [audioAvailability, googleSpeakers]);

  useEffect(() => {
    if (
      availableBackingTrackModelOptions.length > 0 &&
      !availableBackingTrackModelOptions.some((option) => option.value === backingTrackModel)
    ) {
      setBackingTrackModel(availableBackingTrackModelOptions[0].value);
    }
  }, [availableBackingTrackModelOptions, backingTrackModel]);

  useEffect(() => {
    if (!user) return;

    setUsername(user.username || "");
    setPreferredLanguage(user.preferredLanguage || "en");
    setBackingTrackModel(normalizeBackingTrackModelValue(user.backingTrackModel));
    setFontPreferences(mergeFontPreferencesWithDefaults(user.fontPreferences));
    setSpeakerOptions(normalizeSpeakerOptionsState(user.speakerOptions));
    setCustomAdapters(normalizeCustomAdaptersForForm(user.custom_adapters));
  }, [user]);

  useEffect(() => {
    setActiveTab(resolveSettingsTabFromPath(location.pathname));
  }, [location.pathname]);

  useEffect(() => {
    return () => {
      if (audioPreviewRef.current) {
        audioPreviewRef.current.pause();
        audioPreviewRef.current = null;
      }
      if (audioPreviewObjectUrlRef.current) {
        URL.revokeObjectURL(audioPreviewObjectUrlRef.current);
        audioPreviewObjectUrlRef.current = null;
      }
    };
  }, []);

  const stopSpeakerPreview = () => {
    if (audioPreviewRef.current) {
      audioPreviewRef.current.pause();
      audioPreviewRef.current.currentTime = 0;
      audioPreviewRef.current = null;
    }
    if (audioPreviewObjectUrlRef.current) {
      URL.revokeObjectURL(audioPreviewObjectUrlRef.current);
      audioPreviewObjectUrlRef.current = null;
    }
    setCurrentlyPlayingSpeaker(null);
  };

  const toggleSpeakerPreview = async (speaker) => {
    if (!speaker?.previewURL && !speaker?.previewRequiresAuth) {
      toast.error("Preview unavailable for this speaker.", {
        position: "bottom-center",
      });
      return;
    }

    if (
      currentlyPlayingSpeaker?.value === speaker.value &&
      currentlyPlayingSpeaker?.provider === speaker.provider
    ) {
      stopSpeakerPreview();
      return;
    }

    stopSpeakerPreview();

    try {
      const previewUrl = speaker.previewRequiresAuth
        ? await fetchGoogleTTSPreviewBlobUrl(speaker)
        : speaker.previewURL;
      if (speaker.previewRequiresAuth) {
        audioPreviewObjectUrlRef.current = previewUrl;
      }
      const audio = new Audio(previewUrl);
      audioPreviewRef.current = audio;
      setCurrentlyPlayingSpeaker(speaker);
      audio.onended = () => {
        audioPreviewRef.current = null;
        if (audioPreviewObjectUrlRef.current) {
          URL.revokeObjectURL(audioPreviewObjectUrlRef.current);
          audioPreviewObjectUrlRef.current = null;
        }
        setCurrentlyPlayingSpeaker(null);
      };
      await audio.play();
    } catch  {
      audioPreviewRef.current = null;
      if (audioPreviewObjectUrlRef.current) {
        URL.revokeObjectURL(audioPreviewObjectUrlRef.current);
        audioPreviewObjectUrlRef.current = null;
      }
      setCurrentlyPlayingSpeaker(null);
      toast.error("Unable to play speaker preview.", {
        position: "bottom-center",
      });
    }
  };

  const handleUpdateUserDetails = (evt) => {
    evt.preventDefault();

    const updatedDetails = {
      username,
      preferredLanguage,
      backingTrackModel,
    };

    updateUserDetails(updatedDetails);
  };

  const handleSettingsTabClick = (tabKey) => {
    const targetPath = getSettingsTabPath(tabKey);
    setActiveTab(tabKey);
    if (location.pathname !== targetPath) {
      navigate(targetPath);
    }
  };

  const handleCustomEndpointFieldChange = (index, field, value) => {
    setCustomAdapters((prev) => {
      const currentEndpoints = Array.isArray(prev.custom_endpoints)
        ? prev.custom_endpoints
        : [];
      return {
        ...prev,
        custom_endpoints: currentEndpoints.map((endpoint, endpointIndex) =>
          endpointIndex === index ? { ...endpoint, [field]: value } : endpoint
        ),
      };
    });
  };

  const handleAddCustomEndpoint = () => {
    setCustomAdapters((prev) => ({
      ...prev,
      custom_endpoints: [
        ...(Array.isArray(prev.custom_endpoints) ? prev.custom_endpoints : []),
        createEmptyCustomEndpoint(),
      ],
    }));
  };

  const handleRemoveCustomEndpoint = (index) => {
    setCustomAdapters((prev) => {
      const currentEndpoints = Array.isArray(prev.custom_endpoints)
        ? prev.custom_endpoints
        : [];
      const nextEndpoints = currentEndpoints.filter((_, endpointIndex) => endpointIndex !== index);
      return {
        ...prev,
        custom_endpoints: nextEndpoints.length > 0 ? nextEndpoints : [createEmptyCustomEndpoint()],
      };
    });
  };

  const handleUpdateCustomAdapters = (evt) => {
    evt.preventDefault();

    const { customAdapters: payload, error } = buildCustomAdaptersPayload(customAdapters);
    if (error) {
      toast.error(error, {
        position: "bottom-center",
      });
      return;
    }

    updateUserDetails({ custom_adapters: payload });
  };

  const handleClearCustomAdapters = () => {
    setCustomAdapters(normalizeCustomAdaptersForForm(null));
    updateUserDetails({ custom_adapters: null });
  };

  const handleFontPreferenceChange = (languageCode, key, value) => {
    setFontPreferences((prev) => {
      const current = prev && typeof prev === "object" ? prev : {};
      const currentPrefs = current[languageCode] || {};
      return {
        ...current,
        [languageCode]: {
          ...currentPrefs,
          [key]: value,
        },
      };
    });
  };

  const handleUpdateFontPreferences = (evt) => {
    evt.preventDefault();
    updateUserDetails({ fontPreferences });
  };

  const handleSpeakerProviderSelection = (group) => {
    setSpeakerOptions((prev) => {
      const nextEnabled = !prev[group.allowKey];
      return {
        ...prev,
        [group.allowKey]: nextEnabled,
        [group.selectionKey]: nextEnabled
          ? group.speakers.map((speaker) => speaker.value)
          : [],
      };
    });
  };

  const handleSpeakerSelectionChange = (selectionKey, speakerValue) => {
    setSpeakerOptions((prev) => {
      const currentSelections = Array.isArray(prev[selectionKey]) ? prev[selectionKey] : [];
      const exists = currentSelections.includes(speakerValue);
      return {
        ...prev,
        [selectionKey]: exists
          ? currentSelections.filter((value) => value !== speakerValue)
          : [...currentSelections, speakerValue],
      };
    });
  };

  const handleSpeakerProviderExpand = (providerKey) => {
    setExpandedSpeakerProvider((current) => (current === providerKey ? null : providerKey));
  };

  const handleUpdateSpeakerOptions = (evt) => {
    evt.preventDefault();
    updateUserDetails({
      speakerOptions: buildSpeakerOptionsPayload(speakerOptions, speakerGroups),
    });
  };

  const handleUpdatePassword = () => {
    if (newPassword !== confirmNewPassword) {
      toast.error(t("account.passwordMismatch"), {
        position: "bottom-center",
      });
      return;
    }

    axios
      .post(
        `${PROCESSOR_SERVER}/users/update_password`,
        { currentPassword, newPassword },
        getHeaders()
      )
      .then(() => {
        toast.success(t("account.passwordUpdateSuccess"), {
          position: "bottom-center",
        });
        setCurrentPassword("");
        setNewPassword("");
        setConfirmNewPassword("");
      })
      .catch(() => {
        toast.error(t("account.passwordUpdateFail"), {
          position: "bottom-center",
        });
      });
  };

  const openDangerConfirmation = (actionKey) => {
    const actionMap = {
      projects: {
        title: t("account.deleteAllProjects"),
        description: t("account.confirmDeleteProjects"),
        confirmLabel: t("common.yes"),
        onConfirm: deleteAllProjectsForUser,
      },
      generations: {
        title: t("account.deleteAllGenerations"),
        description: t("account.confirmDeleteGenerations"),
        confirmLabel: t("common.yes"),
        onConfirm: deleteAllGenerationsForUser,
      },
      account: {
        title: t("account.deleteMyAccount"),
        description: t("account.confirmDeleteAccount"),
        confirmLabel: t("common.yes"),
        onConfirm: deleteAccountForUser,
      },
    };

    const actionConfig = actionMap[actionKey];
    if (!actionConfig) return;

    openAlertDialog(
      <DangerConfirmDialog
        colorMode={colorMode}
        title={actionConfig.title}
        description={actionConfig.description}
        confirmLabel={actionConfig.confirmLabel}
        cancelLabel={t("common.no")}
        onCancel={closeAlertDialog}
        onConfirm={actionConfig.onConfirm}
      />
    );
  };

  const formInputClasses = `border ${borderColor} rounded px-4 py-2 w-full ${inputBgColor} ${textColor}`;

  return (
    <div className={`min-w-0 rounded-lg shadow-sm border ${borderColor} ${cardBgColor} ${textColor} p-4 space-y-5 sm:p-6 sm:space-y-6`}>
      <div className="space-y-3">
        <div>
          <h2 className="text-xl font-semibold">Settings</h2>
          <p className={`text-sm ${secondaryTextColor}`}>
            Manage your workspace defaults, agent voices, and account security.
          </p>
        </div>
        <div className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1 sm:mx-0 sm:flex-wrap sm:overflow-visible sm:px-0 sm:pb-0">
          {SETTINGS_TABS.map((tab) => (
            <SettingsTabButton
              key={tab.key}
              label={tab.label}
              isActive={activeTab === tab.key}
              colorMode={colorMode}
              onClick={() => handleSettingsTabClick(tab.key)}
            />
          ))}
        </div>
      </div>

      {activeTab === "general" && (
        <form onSubmit={handleUpdateUserDetails}>
          <div className="space-y-4">
            <h3 className="text-lg font-semibold">{t("account.updateSettingsTitle")}</h3>
            <div className="grid grid-cols-1 md:grid-cols-3 w-full gap-4">
              <div>
                <label className={`block text-sm mb-1 ${secondaryTextColor}`}>Username</label>
                <input
                  type="text"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  className={formInputClasses}
                />
              </div>
              <div>
                <label className={`block text-sm mb-1 ${secondaryTextColor}`}>
                  {t("account.preferredLanguageLabel")}
                </label>
                <select
                  value={preferredLanguage}
                  onChange={(e) => {
                    setPreferredLanguage(e.target.value);
                    setLanguage(e.target.value);
                  }}
                  className={formInputClasses}
                >
                  {SUPPORTED_LANGUAGES.map((lang) => (
                    <option key={lang.code} value={lang.code}>
                      {lang.nativeName}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className={`block text-sm mb-1 ${secondaryTextColor}`}>
                  Express backing track
                </label>
                <select
                  value={backingTrackModel}
                  onChange={(e) => setBackingTrackModel(e.target.value)}
                  className={formInputClasses}
                >
                  {availableBackingTrackModelOptions.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <div className="block">
              <SecondaryButton className="w-full sm:w-auto" type="submit">
                {t("account.updateButton")}
              </SecondaryButton>
            </div>
          </div>
        </form>
      )}

      {activeTab === "custom" && (
        <form onSubmit={handleUpdateCustomAdapters}>
          <div className="space-y-4">
            <div>
              <h3 className="text-lg font-semibold">Custom FAL-compatible endpoints</h3>
            </div>
            <div className="space-y-4">
              {(Array.isArray(customAdapters.custom_endpoints)
                ? customAdapters.custom_endpoints
                : []
              ).map((endpoint, index) => (
                <div
                  key={endpoint.id || index}
                  className={`rounded-lg border ${borderColor} ${mutedBg} p-4 space-y-4`}
                >
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                      <div className="text-sm font-semibold">Endpoint {index + 1}</div>
                    </div>
                    <button
                      type="button"
                      onClick={() => handleRemoveCustomEndpoint(index)}
                      className={`rounded px-3 py-2 text-sm border sm:py-1 ${borderColor} ${inputBgColor}`}
                    >
                      Remove
                    </button>
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 w-full gap-4">
                    <div>
                      <label className={`block text-sm mb-1 ${secondaryTextColor}`}>Name</label>
                      <input
                        type="text"
                        value={endpoint.name}
                        placeholder="Happy Horse 1.1"
                        onChange={(e) =>
                          handleCustomEndpointFieldChange(index, "name", e.target.value)
                        }
                        className={formInputClasses}
                      />
                    </div>
                    <div>
                      <label className={`block text-sm mb-1 ${secondaryTextColor}`}>
                        Pipeline stage
                      </label>
                      <select
                        value={endpoint.operation}
                        onChange={(e) =>
                          handleCustomEndpointFieldChange(index, "operation", e.target.value)
                        }
                        className={formInputClasses}
                      >
                        {CUSTOM_ENDPOINT_OPERATION_OPTIONS.map((option) => (
                          <option key={option.key} value={option.key}>
                            {option.label}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className={`block text-sm mb-1 ${secondaryTextColor}`}>
                        FAL base URL
                      </label>
                      <input
                        type="url"
                        value={endpoint.base_url}
                        placeholder={DEFAULT_CUSTOM_ENDPOINT_BASE_URL}
                        onChange={(e) =>
                          handleCustomEndpointFieldChange(index, "base_url", e.target.value)
                        }
                        className={formInputClasses}
                      />
                    </div>
                    <div>
                      <label className={`block text-sm mb-1 ${secondaryTextColor}`}>API key</label>
                      <input
                        type="password"
                        value={endpoint.api_key}
                        placeholder={endpoint.has_api_key ? "Saved on server" : ""}
                        onChange={(e) =>
                          handleCustomEndpointFieldChange(index, "api_key", e.target.value)
                        }
                        className={formInputClasses}
                        autoComplete="off"
                      />
                    </div>
                    <div className="md:col-span-2">
                      <label className={`block text-sm mb-1 ${secondaryTextColor}`}>
                        Model endpoint
                      </label>
                      <input
                        type="text"
                        value={endpoint.endpoint}
                        placeholder={DEFAULT_HAPPY_HORSE_ENDPOINT}
                        onChange={(e) =>
                          handleCustomEndpointFieldChange(index, "endpoint", e.target.value)
                        }
                        className={formInputClasses}
                      />
                    </div>
                  </div>
                </div>
              ))}
            </div>
            <div className="grid gap-3 sm:flex sm:flex-wrap">
              <SecondaryButton type="button" onClick={handleAddCustomEndpoint} className="w-full sm:w-auto">
                Add Endpoint
              </SecondaryButton>
              <SecondaryButton type="submit" className="w-full sm:w-auto">Save Custom Configuration</SecondaryButton>
              <SecondaryButton type="button" onClick={handleClearCustomAdapters} className="w-full sm:w-auto">
                Clear Configuration
              </SecondaryButton>
            </div>
          </div>
        </form>
      )}

      {activeTab === "fonts" && (
        <form onSubmit={handleUpdateFontPreferences}>
          <div className="space-y-4">
            <h3 className="text-lg font-semibold">Express Generation Fonts</h3>
            <p className={`text-sm ${secondaryTextColor}`}>
              Set the default subtitle and narrator fonts for each language.
            </p>
            <div className="space-y-3">
              {SUPPORTED_LANGUAGES.map((language) => {
                const fontOptions = getFontOptionsForLanguage(language.code);
                const preferences = fontPreferences?.[language.code] || {};
                return (
                  <div
                    key={language.code}
                    className={`grid grid-cols-1 md:grid-cols-3 gap-4 rounded-xl border ${borderColor} p-4`}
                  >
                    <div>
                      <div className="text-sm font-semibold">{language.nativeName}</div>
                      <div className={`text-xs ${secondaryTextColor}`}>{language.name}</div>
                    </div>
                    <div>
                      <label className={`block text-sm mb-1 ${secondaryTextColor}`}>
                        Subtitle font
                      </label>
                      <select
                        value={preferences.expressGenerationTextFont || fontOptions[0]}
                        onChange={(e) =>
                          handleFontPreferenceChange(
                            language.code,
                            "expressGenerationTextFont",
                            e.target.value
                          )
                        }
                        className={formInputClasses}
                      >
                        {fontOptions.map((font) => (
                          <option key={font} value={font}>
                            {font}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className={`block text-sm mb-1 ${secondaryTextColor}`}>
                        Narrator font
                      </label>
                      <select
                        value={preferences.expressGenerationSpeakerFont || fontOptions[0]}
                        onChange={(e) =>
                          handleFontPreferenceChange(
                            language.code,
                            "expressGenerationSpeakerFont",
                            e.target.value
                          )
                        }
                        className={formInputClasses}
                      >
                        {fontOptions.map((font) => (
                          <option key={font} value={font}>
                            {font}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>
                );
              })}
            </div>
            <div className="block">
              <SecondaryButton type="submit" className="w-full sm:w-auto">Save Font Preferences</SecondaryButton>
            </div>
          </div>
        </form>
      )}

      {activeTab === "agent" && (
        <form onSubmit={handleUpdateSpeakerOptions}>
          <div className="space-y-4">
            <div>
              <h3 className="text-lg font-semibold">Speakers</h3>
              <p className={`text-sm ${secondaryTextColor}`}>
                Choose fallback TTS providers and preferred voices for agent-created speech.
                Sanskrit and Latin continue to use the legacy OpenAI speaker assignment.
              </p>
            </div>

            <div className="space-y-3">
              {speakerGroups.map((group) => (
                <SpeakerProviderCard
                  key={group.key}
                  group={group}
                  colorMode={colorMode}
                  borderColor={borderColor}
                  mutedBg={mutedBg}
                  secondaryTextColor={secondaryTextColor}
                  speakerOptions={speakerOptions}
                  isExpanded={expandedSpeakerProvider === group.key}
                  isLoading={group.key === "GOOGLE" && googleSpeakersLoading}
                  error={group.key === "GOOGLE" ? googleSpeakersError : null}
                  source={group.key === "GOOGLE" ? googleSpeakersSource : null}
                  currentlyPlayingSpeaker={currentlyPlayingSpeaker}
                  onToggleProvider={() => handleSpeakerProviderSelection(group)}
                  onToggleExpand={() => handleSpeakerProviderExpand(group.key)}
                  onToggleSpeaker={(speakerValue) =>
                    handleSpeakerSelectionChange(group.selectionKey, speakerValue)
                  }
                  onTogglePreview={toggleSpeakerPreview}
                />
              ))}
            </div>

            <div className="block">
              <SecondaryButton type="submit" className="w-full sm:w-auto">Save Speaker Preferences</SecondaryButton>
            </div>
          </div>
        </form>
      )}

      {activeTab === "security" && (
        <div className="space-y-6">
          <div className="space-y-4">
            <h3 className="text-xl font-semibold">{t("account.updatePasswordTitle")}</h3>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <input
                type="password"
                placeholder={t("account.currentPassword")}
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
                className={formInputClasses}
              />
              <input
                type="password"
                placeholder={t("account.newPassword")}
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                className={formInputClasses}
              />
              <input
                type="password"
                placeholder={t("account.confirmNewPassword")}
                value={confirmNewPassword}
                onChange={(e) => setConfirmNewPassword(e.target.value)}
                className={formInputClasses}
              />
            </div>
            <div className="mt-4">
              <SecondaryButton onClick={handleUpdatePassword} className="w-full sm:w-auto">
                {t("account.updatePassword")}
              </SecondaryButton>
            </div>
          </div>

          <div>
            <SecondaryButton onClick={logoutUser} className="w-full sm:w-auto">{t("account.logout")}</SecondaryButton>
          </div>
        </div>
      )}

      {activeTab === "danger" && (
        <div className={`pt-2 space-y-3`}>
          <h3 className="text-xl font-semibold text-red-600">{t("account.dangerZoneTitle")}</h3>
          <p className="text-sm text-red-500">{t("account.dangerZoneDescription")}</p>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <SecondaryButton
              onClick={() => openDangerConfirmation("projects")}
              className="w-full bg-red-600 hover:bg-red-700 text-white"
            >
              {t("account.deleteAllProjects")}
            </SecondaryButton>
            <SecondaryButton
              onClick={() => openDangerConfirmation("generations")}
              className="w-full bg-red-600 hover:bg-red-700 text-white"
            >
              {t("account.deleteAllGenerations")}
            </SecondaryButton>
            <SecondaryButton
              onClick={() => openDangerConfirmation("account")}
              className="w-full bg-red-600 hover:bg-red-700 text-white"
            >
              {t("account.deleteMyAccount")}
            </SecondaryButton>
          </div>
        </div>
      )}
    </div>
  );
}

function SettingsTabButton({ label, isActive, onClick, colorMode }) {
  const activeClasses =
    colorMode === "dark"
      ? "bg-[#16213a] text-rose-200 border border-rose-400/40"
      : "bg-rose-50 text-rose-700 border border-rose-100";
  const idleClasses =
    colorMode === "dark"
      ? "bg-[#0b1224] text-slate-300 border border-[#1f2a3d] hover:bg-[#16213a]"
      : "bg-white text-slate-600 border border-slate-200 hover:bg-slate-50";

  return (
    <button
      type="button"
      onClick={onClick}
      className={`shrink-0 whitespace-nowrap px-3 py-2 rounded-lg text-sm font-medium transition-colors ${isActive ? activeClasses : idleClasses}`}
    >
      {label}
    </button>
  );
}

function SpeakerProviderCard({
  group,
  colorMode,
  borderColor,
  mutedBg,
  secondaryTextColor,
  speakerOptions,
  isExpanded,
  isLoading = false,
  error = null,
  source = null,
  currentlyPlayingSpeaker,
  onToggleProvider,
  onToggleExpand,
  onToggleSpeaker,
  onTogglePreview,
}) {
  const selectedSpeakers = Array.isArray(speakerOptions?.[group.selectionKey])
    ? speakerOptions[group.selectionKey]
    : [];
  const providerEnabled = Boolean(speakerOptions?.[group.allowKey]);
  const speakers = Array.isArray(group.speakers) ? group.speakers : [];
  const isUsingGoogleCache = source === "cache" || source === "client-cache";
  const emptyStateText = isLoading
    ? "Loading Google voices..."
    : error
      ? "Google voices are unavailable. Check processor Google credentials and try again."
      : "No speakers are available for this provider.";

  return (
    <div className={`rounded-xl border ${borderColor} ${mutedBg} p-4 space-y-3`}>
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div className="flex items-start gap-3">
          <input
            type="checkbox"
            checked={providerEnabled}
            onChange={onToggleProvider}
            className="mt-1 h-4 w-4 accent-rose-500"
          />
          <div>
            <div className="text-sm font-semibold">{group.label}</div>
            <div className={`text-xs ${secondaryTextColor}`}>
              Limit fallback speaker assignment to this provider when individual selections are
              exhausted.
            </div>
            <div className={`text-xs ${secondaryTextColor} mt-1`}>
              {selectedSpeakers.length} preferred speaker{selectedSpeakers.length === 1 ? "" : "s"} selected
              {isUsingGoogleCache ? " | Google cache" : ""}
            </div>
          </div>
        </div>

        <button
          type="button"
          onClick={onToggleExpand}
          className={`inline-flex items-center gap-2 rounded-lg px-3 py-2 text-sm border ${borderColor} ${
            colorMode === "dark" ? "bg-[#0b1224] hover:bg-[#16213a]" : "bg-white hover:bg-slate-50"
          }`}
        >
          {isExpanded ? <FaChevronDown /> : <FaChevronRight />}
          {isExpanded ? "Hide Speakers" : "Choose Speakers"}
        </button>
      </div>

      {isExpanded && (
        <div className="grid gap-2">
          {speakers.length === 0 && (
            <div
              className={`rounded-lg border ${borderColor} px-3 py-3 text-sm ${secondaryTextColor} ${
                colorMode === "dark" ? "bg-[#0b1224]" : "bg-white"
              }`}
            >
              {emptyStateText}
            </div>
          )}
          {speakers.map((speaker) => {
            const isSelected = selectedSpeakers.includes(speaker.value);
            const isPlaying =
              currentlyPlayingSpeaker?.provider === speaker.provider &&
              currentlyPlayingSpeaker?.value === speaker.value;

            return (
              <div
                key={`${speaker.provider}:${speaker.value}`}
                className={`rounded-lg border ${borderColor} px-3 py-3 ${
                  colorMode === "dark" ? "bg-[#0b1224]" : "bg-white"
                }`}
              >
                <div className="flex items-center gap-3">
                  <input
                    type="checkbox"
                    checked={isSelected}
                    onChange={() => onToggleSpeaker(speaker.value)}
                    className="h-4 w-4 accent-rose-500"
                  />
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-semibold">{speaker.label}</div>
                    <div className={`text-xs ${secondaryTextColor}`}>
                      {speaker.genderLabel}
                      {speaker.languageCode ? ` | ${speaker.languageCode}` : ""}
                      {speaker.accent ? ` | ${speaker.accent}` : ""}
                      {speaker.description ? ` | ${speaker.description}` : ""}
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => onTogglePreview(speaker)}
                    className={`inline-flex h-9 w-9 items-center justify-center rounded-full border ${borderColor} ${
                      colorMode === "dark" ? "bg-[#16213a] hover:bg-[#1d2b49]" : "bg-slate-50 hover:bg-slate-100"
                    }`}
                    aria-label={isPlaying ? `Pause ${speaker.label}` : `Play ${speaker.label}`}
                  >
                    {isPlaying ? <FaPause /> : <FaPlay />}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function DangerConfirmDialog({
  title,
  description,
  confirmLabel,
  cancelLabel = "Cancel",
  onConfirm,
  onCancel,
  colorMode,
}) {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const isMountedRef = useRef(true);

  useEffect(() => {
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  const surfaceClasses =
    colorMode === "dark"
      ? "bg-[#0f1629] text-slate-100 border border-[#1f2a3d]"
      : "bg-white text-slate-900 border border-slate-200";
  const mutedText = colorMode === "dark" ? "text-slate-400" : "text-slate-600";
  const iconBg =
    colorMode === "dark"
      ? "bg-red-500/10 text-red-200 border border-red-500/30"
      : "bg-red-50 text-red-600 border border-red-100";

  const handleConfirm = async () => {
    if (isSubmitting) return;
    setIsSubmitting(true);
    try {
      if (onConfirm) {
        await onConfirm();
      }
      if (onCancel) {
        onCancel();
      }
    } catch  {
      // Existing toast flows surface errors to the user.
    } finally {
      if (isMountedRef.current) {
        setIsSubmitting(false);
      }
    }
  };

  return (
    <div className={`rounded-2xl p-6 shadow-xl ${surfaceClasses}`}>
      <div className="flex gap-4">
        <div className={`flex h-12 w-12 items-center justify-center rounded-full ${iconBg}`}>
          <span className="text-xl font-bold">!</span>
        </div>
        <div className="space-y-2">
          <h3 className="text-xl font-semibold leading-tight">{title}</h3>
          <p className={`text-sm leading-relaxed ${mutedText}`}>{description}</p>
        </div>
      </div>
      <div className="mt-6 flex justify-end gap-3">
        <button
          className={`px-4 py-2 rounded-lg border ${mutedText} ${
            colorMode === "dark"
              ? "border-[#1f2a3d] hover:bg-[#0b1224]"
              : "border-slate-200 hover:bg-slate-50"
          }`}
          onClick={onCancel}
          disabled={isSubmitting}
        >
          {cancelLabel}
        </button>
        <button
          className="px-4 py-2 rounded-lg bg-red-600 text-white hover:bg-red-700 disabled:opacity-60 disabled:cursor-not-allowed"
          onClick={handleConfirm}
          disabled={isSubmitting}
        >
          {isSubmitting ? "Working..." : confirmLabel}
        </button>
      </div>
    </div>
  );
}
