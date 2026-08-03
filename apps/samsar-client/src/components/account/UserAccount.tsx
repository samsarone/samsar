import { useEffect, useRef, useState } from "react";
import { ToastContainer, toast } from "react-toastify";
import "react-toastify/dist/ReactToastify.css";
import { FaBars, FaChevronCircleLeft } from "react-icons/fa";
import { useLocation, useNavigate } from "react-router-dom";
import axios from "axios";

import { useColorMode } from "../../contexts/ColorMode.jsx";
import { useUser } from "../../contexts/UserContext.jsx";
import SecondaryButton from "../common/SecondaryButton.tsx";
import { getHeaders } from "../../utils/web.jsx";
import MusicPanelContent from "./MusicPanelContent.jsx";
import ImagePanelContent from "./ImagePanelContent.jsx";
import SettingsPanelContent from "./SettingsPanelContent.jsx";
import BillingPanelContent from "./BillingPanelContent.jsx";
import BillingAccessGate from "./BillingAccessGate.jsx";
import ToggleButton from "../common/ToggleButton.tsx";
import SceneLibraryHome from "../library/aivideo/SceneLibraryHome.jsx";
import OverflowContainer from "../common/OverflowContainer.tsx";
import APIKeysPanelContent from "./APIKeysPanelContent.jsx";
import UsagePanelContent from "./UsagePanelContent.jsx";
import ModelAdaptersPanelContent from "./ModelAdaptersPanelContent.jsx";
import ModelAdapterSelect from "../common/ModelAdapterSelect.jsx";
import SingleSelect from "../common/SingleSelect.jsx";
import { IS_STANDALONE_DEPLOYMENT } from "../../utils/environment.jsx";
import { useDeploymentModelAvailability } from "../../hooks/useDeploymentModelAvailability.js";
import { useInferenceModelAvailability } from "../../hooks/useInferenceModelAvailability.js";
import {
  MODEL_ADAPTERS_ACCOUNT_PANEL_KEY,
  canManageModelAdapters,
  isLegacyModelAdaptersSettingsPath,
  isModelAdaptersAccountPath,
} from "../../utils/modelAdapterPreferences.mjs";
import {
  normalizeDeploymentInferenceModelValue,
  resolveAllowedInferenceModelOption,
} from "../../utils/deploymentProviders.js";

import { INFERENCE_MODEL_TYPES, ASSISTANT_MODEL_TYPES } from "../../constants/Types.ts";

const PROCESSOR_SERVER = import.meta.env.VITE_PROCESSOR_API;
const DEFAULT_TEXT_MODEL = "gpt-5.6-sol";
const VIDEO_FPS_OPTIONS = [
  { value: 24, label: "24 FPS" },
  { value: 16, label: "16 FPS" },
  { value: 30, label: "30 FPS" },
];

function getVideoFpsOption(value) {
  return VIDEO_FPS_OPTIONS.find((option) => option.value === Number(value)) || VIDEO_FPS_OPTIONS[0];
}

function normalizeInferenceModelValue(value) {
  return normalizeDeploymentInferenceModelValue(value) || DEFAULT_TEXT_MODEL;
}

function getInferenceModelOption(value, options = INFERENCE_MODEL_TYPES) {
  const modelOptions = Array.isArray(options) ? options : INFERENCE_MODEL_TYPES;
  return resolveAllowedInferenceModelOption(value, modelOptions, DEFAULT_TEXT_MODEL);
}

function getAssistantModelOption(value, options = ASSISTANT_MODEL_TYPES) {
  const modelOptions = Array.isArray(options) ? options : ASSISTANT_MODEL_TYPES;
  return resolveAllowedInferenceModelOption(value, modelOptions, DEFAULT_TEXT_MODEL);
}

export default function UserAccount() {
  const { colorMode } = useColorMode();
  const { user, resetUser, getUserAPI, setUser, userFetching, userInitiated } = useUser();
  const navigate = useNavigate();
  const location = useLocation();

  const textColor = colorMode === "dark" ? "text-slate-100" : "text-slate-900";
  const bgColor = colorMode === "dark" ? "bg-[#0c0d12]" : "bg-[#f7f9fc]";
  const secondaryTextColor = colorMode === "dark" ? "text-slate-400" : "text-slate-500";
  const cardBgColor = colorMode === "dark" ? "bg-[#181b24] shadow-[0_16px_40px_rgba(0,0,0,0.35)]" : "bg-white shadow-sm";
  const borderColor = colorMode === "dark" ? "border-[#3a4050]" : "border-slate-200";
  const mutedBg = colorMode === "dark" ? "bg-[#20232e]" : "bg-slate-50";
  const isStandaloneDeployment = IS_STANDALONE_DEPLOYMENT;
  const canManageInstallationModelAdapters = canManageModelAdapters({
    isStandaloneDeployment,
    isAdminUser: user?.isAdminUser === true,
  });
  const {
    isStandaloneDeployment: isStandaloneModelFilteringEnabled,
    isLoading: isInferenceModelAvailabilityLoading,
    inferenceModelOptions,
    assistantModelOptions,
    hasConfiguredInferenceModels,
  } = useInferenceModelAvailability();
  const { primaryAdapterByModel } = useDeploymentModelAvailability();
  const areStandaloneModelSelectsDisabled =
    isStandaloneModelFilteringEnabled &&
    (isInferenceModelAvailabilityLoading || !hasConfiguredInferenceModels);
  const standaloneModelAvailabilityMessage = isStandaloneModelFilteringEnabled
    ? isInferenceModelAvailabilityLoading
      ? "Loading configured inference models..."
      : hasConfiguredInferenceModels
        ? "Only models supported by your configured standalone providers are shown."
        : "Configure OpenAI, Google Cloud, Alibaba Cloud, Kimi, OpenRouter, or a Samsar API key in setup to enable inference and assistant models."
    : "";

  const validPanels = [
    "account",
    "images",
    "sounds",
    "scenes",
    "videos",
    "apiKeys",
    "usage",
    "billing",
    "settings",
    ...(isStandaloneDeployment
      ? [MODEL_ADAPTERS_ACCOUNT_PANEL_KEY]
      : []),
  ];

  const resolvePanelFromPath = () => {
    const segments = location.pathname.split("/").filter(Boolean);
    const panel = segments[1] || "account";
    return validPanels.includes(panel) ? panel : "account";
  };

  const [displayPanel, setDisplayPanel] = useState(resolvePanelFromPath());
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [, setHasApiKeys] = useState<boolean | null>(null);

  const [notifyOnCompletion, setNotifyOnCompletion] = useState(false);
  const [inferenceModel, setInferenceModel] = useState(
    getInferenceModelOption(DEFAULT_TEXT_MODEL)
  );
  const [assistantModel, setAssistantModel] = useState(
    getAssistantModelOption(DEFAULT_TEXT_MODEL)
  );
  const [videoFps, setVideoFps] = useState(VIDEO_FPS_OPTIONS[0]);
  const pendingModelPreferenceSyncKeyRef = useRef("");

  const syncUserDetailsSilently = (payload) => {
    if (!payload || Object.keys(payload).length === 0) return;
    axios
      .post(`${PROCESSOR_SERVER}/users/update`, payload, getHeaders())
      .then((res) => {
        if (res.data) {
          setUser(res.data);
        }
        getUserAPI();
      })
      .catch(() => undefined);
  };

  useEffect(() => {
    if (!user) return;

    const nextInferenceModel = getInferenceModelOption(user.selectedInferenceModel, inferenceModelOptions);
    const nextAssistantModel = getAssistantModelOption(user.selectedAssistantModel, assistantModelOptions);
    setInferenceModel(nextInferenceModel);
    setAssistantModel(nextAssistantModel);
    setNotifyOnCompletion(!!user.selectedNotifyOnCompletion);
    setVideoFps(getVideoFpsOption(user.videoFramesPerSecond));
    const canReconcileModelPreferences =
      !isStandaloneModelFilteringEnabled ||
      (!isInferenceModelAvailabilityLoading && hasConfiguredInferenceModels);
    if (canReconcileModelPreferences) {
      const modelPreferencePayload: Record<string, string> = {};
      if (
        nextInferenceModel?.value &&
        normalizeInferenceModelValue(user.selectedInferenceModel) !==
          normalizeInferenceModelValue(nextInferenceModel.value)
      ) {
        modelPreferencePayload.selectedInferenceModel = nextInferenceModel.value;
      }
      if (
        nextAssistantModel?.value &&
        normalizeInferenceModelValue(user.selectedAssistantModel) !==
          normalizeInferenceModelValue(nextAssistantModel.value)
      ) {
        modelPreferencePayload.selectedAssistantModel = nextAssistantModel.value;
      }

      const modelPreferenceSyncKey = JSON.stringify(modelPreferencePayload);
      if (Object.keys(modelPreferencePayload).length === 0) {
        pendingModelPreferenceSyncKeyRef.current = "";
      } else if (pendingModelPreferenceSyncKeyRef.current !== modelPreferenceSyncKey) {
        pendingModelPreferenceSyncKeyRef.current = modelPreferenceSyncKey;
        syncUserDetailsSilently(modelPreferencePayload);
      }
    }
  }, [
    assistantModelOptions,
    hasConfiguredInferenceModels,
    inferenceModelOptions,
    isStandaloneModelFilteringEnabled,
    isInferenceModelAvailabilityLoading,
    user,
  ]);

  useEffect(() => {
    setDisplayPanel(resolvePanelFromPath());
  }, [isStandaloneDeployment, location.pathname]);

  useEffect(() => {
    if (!user) return;

    if (isLegacyModelAdaptersSettingsPath(location.pathname)) {
      navigate(
        isStandaloneDeployment
          ? `/account/${MODEL_ADAPTERS_ACCOUNT_PANEL_KEY}`
          : "/account/settings",
        { replace: true },
      );
      return;
    }

    if (
      isModelAdaptersAccountPath(location.pathname) &&
      !isStandaloneDeployment
    ) {
      navigate("/account", { replace: true });
    }
  }, [
    isStandaloneDeployment,
    location.pathname,
    navigate,
    user,
  ]);

  useEffect(() => {
    let isCancelled = false;

    if (!user?._id) {
      setHasApiKeys(null);
      return undefined;
    }

    const fetchAPIKeyPresence = async () => {
      try {
        const response = await axios.get(`${PROCESSOR_SERVER}/users/api_keys`, getHeaders());
        if (!isCancelled) {
          setHasApiKeys((response.data.apiKeys || []).length > 0);
        }
      } catch {
        if (!isCancelled) {
          setHasApiKeys(null);
        }
      }
    };

    fetchAPIKeyPresence();

    return () => {
      isCancelled = true;
    };
  }, [user?._id]);

  if (!user) {
    if (displayPanel === "billing") {
      if (!userInitiated || userFetching) {
        return (
          <OverflowContainer>
            <div className="pt-[50px] min-h-screen" />
          </OverflowContainer>
        );
      }
      return (
        <OverflowContainer>
          <BillingAccessGate />
        </OverflowContainer>
      );
    }
    return <span />;
  }

  const updateUserDetails = (payload) => {
    axios
      .post(`${PROCESSOR_SERVER}/users/update`, payload, getHeaders())
      .then((res) => {
        toast.success("User details updated!", { position: "bottom-center" });
        if (res.data) {
          setUser(res.data);
        }
        getUserAPI();
      })
      .catch(() => toast.error("Failed to update user details", { position: "bottom-center" }));
  };

  const handleNotifyOnCompletionChange = (e) => {
    const newVal = e.target.checked;
    setNotifyOnCompletion(newVal);
    updateUserDetails({ selectedNotifyOnCompletion: newVal });
  };

  const handleInferenceModelChange = (newVal) => {
    const nextOption = getInferenceModelOption(newVal?.value, inferenceModelOptions);
    if (!nextOption) return;
    setInferenceModel(nextOption);
    updateUserDetails({ selectedInferenceModel: nextOption.value });
  };

  const handleAssistantModelChange = (newVal) => {
    const nextOption = getAssistantModelOption(newVal?.value, assistantModelOptions);
    if (!nextOption) return;
    setAssistantModel(nextOption);
    updateUserDetails({ selectedAssistantModel: nextOption.value });
  };

  const handleVideoFpsChange = (newVal) => {
    setVideoFps(newVal);
    updateUserDetails({ videoFramesPerSecond: newVal.value });
  };

  const deleteAllGenerationsForUser = async () => {
    try {
      await axios.post(`${PROCESSOR_SERVER}/users/delete_generations`, {}, getHeaders());
      toast.success("All generations deleted!", { position: "bottom-center" });
    } catch (err) {
      toast.error("Failed to delete generations", { position: "bottom-center" });
      throw err;
    }
  };

  const deleteAllProjectsForUser = async () => {
    try {
      await axios.post(`${PROCESSOR_SERVER}/users/delete_projects`, {}, getHeaders());
      toast.success("All projects deleted!", { position: "bottom-center" });
    } catch (err) {
      toast.error("Failed to delete projects", { position: "bottom-center" });
      throw err;
    }
  };

  const deleteAccountForUser = async () => {
    try {
      await axios.post(`${PROCESSOR_SERVER}/users/delete_user`, {}, getHeaders());
      toast.success("Account deleted!", { position: "bottom-center" });
      resetUser();
      navigate("/");
    } catch (err) {
      toast.error("Failed to delete account", { position: "bottom-center" });
      throw err;
    }
  };

  const logoutUser = () => {
    resetUser();
    navigate("/");
    toast.success("Logged out successfully!", { position: "bottom-center" });
  };

  const goToPanel = (panel) => {
    const targetPath = panel === "account" ? "/account" : `/account/${panel}`;
    setDisplayPanel(panel);
    setSidebarOpen(false);
    if (location.pathname !== targetPath) {
      navigate(targetPath);
    }
  };

  const navItemBase = "w-full text-left mb-2 px-3 py-2 rounded-lg transition-colors";
  const navItemActive =
    colorMode === "dark"
      ? "bg-[#292d3a] border border-[#ff4655]/55 text-[#ffd4d8]"
      : "bg-white border border-rose-100 text-rose-700 shadow-sm";
  const navItemIdle =
    colorMode === "dark"
      ? "border border-transparent text-slate-300 hover:bg-[#181b24]"
      : "border border-transparent text-slate-600 hover:bg-slate-100";

  const NavLink = ({ panel, label }) => (
    <li className="list-none">
      <button
        className={`${navItemBase} ${displayPanel === panel ? navItemActive : navItemIdle}`}
        onClick={() => goToPanel(panel)}
      >
        {label}
      </button>
    </li>
  );

  const accountNavItems = [
    { panel: "account", label: "Account" },
    {
      panel: "apiKeys",
      label: "API Key",
    },
    { panel: "billing", label: "Billing" },
    ...(isStandaloneDeployment
      ? [{
          panel: MODEL_ADAPTERS_ACCOUNT_PANEL_KEY,
          label: "Custom Adapters",
        }]
      : []),
    { panel: "settings", label: "Settings" },
    { panel: "images", label: "Images" },
    { panel: "sounds", label: "Sounds" },
    { panel: "scenes", label: "Scenes" },
    { panel: "videos", label: "Videos" },
    { panel: "usage", label: "Usage" },
  ];

  const pageLabels = {
    account: "Account Information",
    images: "Image Library",
    sounds: "Sound Library",
    scenes: "Scene Library",
    videos: "Video Library",
    apiKeys: "API Keys",
    usage: "Usage Logs",
    billing: "Billing Information",
    [MODEL_ADAPTERS_ACCOUNT_PANEL_KEY]: "Custom Adapters",
    settings: "Settings",
  };

  const accountType = user.isPremiumUser ? "Premium" : "Basic";
  const nextChargeLabel = user.isPremiumUser
    ? user.nextCreditRefill || "Next charge scheduled with your subscription"
    : "No upcoming charge";
  const autoRechargeLabel = user.autoRechargeEnabled ? "Enabled" : "Disabled";

  const emailNotificationBlock = user.isEmailVerified ? (
    <label
      className={`flex items-center gap-3 rounded-xl border ${borderColor} px-4 py-3 ${
        colorMode === "dark" ? "bg-neutral-900/70" : "bg-white"
      }`}
    >
      <input
        type="checkbox"
        checked={notifyOnCompletion}
        onChange={handleNotifyOnCompletionChange}
        className="h-4 w-4 accent-indigo-500"
      />
      <div>
        <p className="text-sm font-semibold">Email notifications</p>
        <p className={`text-xs ${secondaryTextColor}`}>Send an email when renders finish.</p>
      </div>
    </label>
  ) : (
    <div className={`rounded-xl border ${borderColor} px-4 py-3 ${mutedBg}`}>
      <p className="text-sm font-semibold">Verify your email to enable notifications</p>
      <p className={`text-xs ${secondaryTextColor}`}>
        We&apos;ll notify you when renders complete once your email is verified.
      </p>
    </div>
  );

  return (
    <OverflowContainer>
      <ToastContainer />
      <div className={`pt-[50px] min-h-screen flex flex-col ${bgColor} ${textColor}`}>
        {sidebarOpen && (
          <div className="fixed inset-0 z-40 flex" aria-modal="true" role="dialog">
            <div className="fixed inset-0 bg-black/40" onClick={() => setSidebarOpen(false)} />
            <nav className={`relative z-50 w-[min(18rem,85vw)] p-5 sm:p-6 ${bgColor} shadow-[0_16px_40px_rgba(0,0,0,0.45)] border-r ${borderColor} overflow-y-auto`}>
              <button
                className={`absolute top-4 right-4 flex h-8 w-8 items-center justify-center rounded-lg border ${borderColor}`}
                onClick={() => setSidebarOpen(false)}
                aria-label="Close navigation"
              >
                X
              </button>
              <ul>
                {accountNavItems.map((item) => (
                  <NavLink key={item.panel} panel={item.panel} label={item.label} />
                ))}
              </ul>
            </nav>
          </div>
        )}

        <div className="flex flex-1 min-w-0">
          <nav className={`hidden md:block w-48 shrink-0 p-4 ${bgColor} shadow-sm border-r ${borderColor}`}>
            <ul>
              {accountNavItems.map((item) => (
                <NavLink key={item.panel} panel={item.panel} label={item.label} />
              ))}
            </ul>
          </nav>

          <div className={`min-w-0 flex-1 flex flex-col ${bgColor} ${textColor}`}>
            <div className={`flex flex-wrap items-center gap-3 p-3 sm:p-4 border-b ${borderColor}`}>
              <button
                className={`md:hidden flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border ${borderColor}`}
                onClick={() => setSidebarOpen(true)}
                aria-label="Open navigation"
              >
                <FaBars size={20} />
              </button>

              <div onClick={() => navigate("/")} className="cursor-pointer flex shrink-0 items-center gap-2">
                <FaChevronCircleLeft className="mr-2" />
                <span>Back</span>
              </div>

              <h2 className="min-w-0 flex-1 truncate text-center text-lg font-bold sm:text-xl">
                {pageLabels[displayPanel]}
              </h2>
            </div>

            <div className="min-w-0 flex-1 overflow-y-auto overflow-x-hidden p-3 sm:p-6">
              {displayPanel === "account" && (
                <div className="flex min-h-full min-w-0 flex-col">
                  <div className="max-w-5xl w-full mx-auto space-y-4 sm:space-y-6">
                    <div
                      className={`rounded-lg border ${borderColor} ${cardBgColor} p-4 shadow-sm sm:p-6`}
                    >
                      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                        <div className="flex min-w-0 items-center gap-4">
                          {user.profilePicture && (
                            <img
                              src={user.profilePicture}
                              alt="Profile"
                              className="h-14 w-14 shrink-0 rounded-full object-cover sm:h-16 sm:w-16"
                            />
                          )}
                          <div className="min-w-0">
                            <p className={`text-xs uppercase tracking-wide ${secondaryTextColor}`}>
                              Signed in as
                            </p>
                            <h2 className="break-words text-xl font-bold sm:text-2xl">{user.username}</h2>
                            <p className={`break-all text-sm ${secondaryTextColor}`}>{user.email}</p>
                          </div>
                        </div>
                        {!isStandaloneDeployment && (
                          <div className="text-left sm:text-right">
                            <p className={`text-xs uppercase tracking-wide ${secondaryTextColor}`}>
                              Plan
                            </p>
                            <p className="text-lg font-semibold">{accountType}</p>
                            {user.isPremiumUser && (
                              <p className={`text-xs ${secondaryTextColor}`}>{nextChargeLabel}</p>
                            )}
                          </div>
                        )}
                      </div>
                    </div>

                    {!isStandaloneDeployment && (
                      <div
                        className={`md:hidden rounded-lg border ${borderColor} ${cardBgColor} p-4 shadow-sm`}
                      >
                        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                          <div>
                            <p className={`text-xs uppercase tracking-wide ${secondaryTextColor}`}>
                              Credits remaining
                            </p>
                            <p className="text-3xl font-bold">{user.generationCredits || 0}</p>
                            <p className={`text-sm ${secondaryTextColor}`}>
                              Add credits from Billing when your balance runs low.
                            </p>
                          </div>
                          <SecondaryButton onClick={() => goToPanel("billing")} className="w-full sm:w-auto">
                            Purchase credits
                          </SecondaryButton>
                        </div>
                      </div>
                    )}

                    <div
                      className={`rounded-lg border ${borderColor} ${cardBgColor} p-4 shadow-sm space-y-5 sm:p-6 sm:space-y-6`}
                    >
                      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                        <div>
                          <h3 className="text-lg font-semibold">Preferences</h3>
                          <p className={`text-sm ${secondaryTextColor}`}>
                            Quick controls for your workspace.
                          </p>
                        </div>
                        <div className="flex items-center gap-3 sm:justify-end">
                          <span className="text-sm font-semibold">Dark Mode</span>
                          <ToggleButton />
                        </div>
                      </div>

                      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                        <div className="space-y-2">
                          <p className="text-sm font-semibold">Assistant model</p>
                          <ModelAdapterSelect
                            options={assistantModelOptions}
                            value={assistantModel}
                            onChange={handleAssistantModelChange}
                            primaryAdapterByModel={primaryAdapterByModel}
                            isStandaloneDeployment={isStandaloneModelFilteringEnabled}
                            isDisabled={areStandaloneModelSelectsDisabled}
                            placeholder={areStandaloneModelSelectsDisabled ? "No model configured" : undefined}
                          />
                        </div>
                        <div className="space-y-2">
                          <p className="text-sm font-semibold">Inference model</p>
                          <ModelAdapterSelect
                            options={inferenceModelOptions}
                            value={inferenceModel}
                            onChange={handleInferenceModelChange}
                            primaryAdapterByModel={primaryAdapterByModel}
                            isStandaloneDeployment={isStandaloneModelFilteringEnabled}
                            isDisabled={areStandaloneModelSelectsDisabled}
                            placeholder={areStandaloneModelSelectsDisabled ? "No model configured" : undefined}
                          />
                        </div>
                        <div className="space-y-2">
                          <p className="text-sm font-semibold">Final render FPS</p>
                          <SingleSelect
                            options={VIDEO_FPS_OPTIONS}
                            value={videoFps}
                            onChange={handleVideoFpsChange}
                            isSearchable={false}
                          />
                          <p className={`text-xs ${secondaryTextColor}`}>
                            Default render frame rate for new video sessions.
                          </p>
                        </div>
                      </div>
                      {standaloneModelAvailabilityMessage ? (
                        <p className={`text-xs ${secondaryTextColor}`}>
                          {standaloneModelAvailabilityMessage}
                        </p>
                      ) : null}

                      {!isStandaloneDeployment && emailNotificationBlock}
                    </div>

                    <div
                      className={`rounded-lg border ${borderColor} ${cardBgColor} p-4 shadow-sm space-y-4 sm:p-6`}
                    >
                      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                        <div>
                          <h3 className="text-lg font-semibold">Usage & Billing</h3>
                          <p className={`text-sm ${secondaryTextColor}`}>
                            {isStandaloneDeployment
                              ? "Credits are charged provider side."
                              : "Track credits and billing status."}
                          </p>
                        </div>
                        <SecondaryButton onClick={() => goToPanel("billing")} className="w-full sm:w-auto">
                          {isStandaloneDeployment ? "View billing" : "Purchase credits"}
                        </SecondaryButton>
                      </div>

                      {isStandaloneDeployment ? (
                        <div className="grid gap-4 sm:grid-cols-2">
                          <div className={`rounded-xl border ${borderColor} p-4 ${mutedBg}`}>
                            <p className={`text-xs uppercase tracking-wide ${secondaryTextColor}`}>
                              Credits
                            </p>
                            <p className="text-base font-semibold">Charged provider side</p>
                          </div>
                          <div className={`rounded-xl border ${borderColor} p-4 ${mutedBg}`}>
                            <p className={`text-xs uppercase tracking-wide ${secondaryTextColor}`}>
                              Recharge
                            </p>
                            <p className="text-base font-semibold">Managed by providers</p>
                          </div>
                        </div>
                      ) : (
                        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                          <div className={`rounded-xl border ${borderColor} p-4 ${mutedBg}`}>
                            <p className={`text-xs uppercase tracking-wide ${secondaryTextColor}`}>
                              Credits remaining
                            </p>
                            <p className="text-2xl font-bold">{user.generationCredits || 0}</p>
                          </div>
                          <div className={`rounded-xl border ${borderColor} p-4 ${mutedBg}`}>
                            <p className={`text-xs uppercase tracking-wide ${secondaryTextColor}`}>
                              Next charge
                            </p>
                            <p className="text-base font-semibold">
                              {user.isPremiumUser ? nextChargeLabel : "Not scheduled"}
                            </p>
                          </div>
                          <div className={`rounded-xl border ${borderColor} p-4 ${mutedBg}`}>
                            <p className={`text-xs uppercase tracking-wide ${secondaryTextColor}`}>
                              Auto-recharge
                            </p>
                            <p className="text-base font-semibold">{autoRechargeLabel}</p>
                          </div>
                        </div>
                      )}
                    </div>
                  </div>

                  <div className="sticky bottom-0 bg-inherit pt-4 mt-4 sm:pt-6 sm:mt-6">
                    <SecondaryButton onClick={logoutUser} className="w-full">
                      Logout
                    </SecondaryButton>
                  </div>
                </div>
              )}

              {displayPanel === "images" && <ImagePanelContent />}
              {displayPanel === "sounds" && <MusicPanelContent />}
              {displayPanel === "billing" && <BillingPanelContent />}
              {isStandaloneDeployment &&
                displayPanel === MODEL_ADAPTERS_ACCOUNT_PANEL_KEY && (
                  <ModelAdaptersPanelContent
                    enabled
                    preferencesEnabled={canManageInstallationModelAdapters}
                  />
                )}
              {displayPanel === "settings" && (
                <SettingsPanelContent
                  logoutUser={logoutUser}
                  updateUserDetails={updateUserDetails}
                  user={user}
                  deleteAllProjectsForUser={deleteAllProjectsForUser}
                  deleteAllGenerationsForUser={deleteAllGenerationsForUser}
                  deleteAccountForUser={deleteAccountForUser}
                />
              )}
              {displayPanel === "apiKeys" && (
                <APIKeysPanelContent onAPIKeyPresenceChange={setHasApiKeys} />
              )}
              {displayPanel === "usage" && <UsagePanelContent />}
              {displayPanel === "scenes" && <SceneLibraryHome hideSelectButton />}
              {displayPanel === "videos" && <SceneLibraryHome hideSelectButton />}
            </div>
          </div>
        </div>
      </div>
    </OverflowContainer>
  );
}
