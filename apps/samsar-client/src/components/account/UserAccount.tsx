import { useEffect, useState } from "react";
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
import SingleSelect from "../common/SingleSelect.jsx";
import { getSessionType } from "../../utils/environment.jsx";
import { useInferenceModelAvailability } from "../../hooks/useInferenceModelAvailability.js";

import { INFERENCE_MODEL_TYPES, ASSISTANT_MODEL_TYPES } from "../../constants/Types.ts";

const PROCESSOR_SERVER = import.meta.env.VITE_PROCESSOR_API;
const DEFAULT_TEXT_MODEL = "gpt-5.5";
const VIDEO_FPS_OPTIONS = [
  { value: 24, label: "24 FPS" },
  { value: 16, label: "16 FPS" },
  { value: 30, label: "30 FPS" },
];

function getVideoFpsOption(value) {
  return VIDEO_FPS_OPTIONS.find((option) => option.value === Number(value)) || VIDEO_FPS_OPTIONS[0];
}

function normalizeInferenceModelValue(value) {
  if (typeof value !== "string") {
    return DEFAULT_TEXT_MODEL;
  }
  const normalized = value.trim().toLowerCase();
  if (
    normalized === "gemini-3.1-pro" ||
    normalized === "gemini-3.1-pro-preview" ||
    normalized === "gemini-3-pro" ||
    normalized === "gemini-3-pro-preview" ||
    normalized === "gemini 3.1 pro" ||
    normalized === "gemini 3.1 pro preview" ||
    normalized === "gemini 3 pro" ||
    normalized === "gemini 3 pro preview" ||
    normalized === "gemini31pro" ||
    normalized === "gemini31propreview" ||
    normalized === "gemini3pro" ||
    normalized === "gemini3propreview"
  ) {
    return "gemini-3.1-pro";
  }
  if (
    normalized === DEFAULT_TEXT_MODEL ||
    normalized.startsWith(`${DEFAULT_TEXT_MODEL}-`) ||
    normalized === "gpt 5.5" ||
    normalized === "gpt55"
  ) {
    return DEFAULT_TEXT_MODEL;
  }
  return DEFAULT_TEXT_MODEL;
}

function getInferenceModelOption(value, options = INFERENCE_MODEL_TYPES) {
  const modelOptions = Array.isArray(options) ? options : INFERENCE_MODEL_TYPES;
  if (modelOptions.length === 0) return null;
  const normalizedValue = normalizeInferenceModelValue(value);
  return (
    modelOptions.find((m) => m.value === normalizedValue) ||
    modelOptions.find((m) => m.value === DEFAULT_TEXT_MODEL) ||
    modelOptions[0]
  );
}

function getAssistantModelOption(value, options = ASSISTANT_MODEL_TYPES) {
  const modelOptions = Array.isArray(options) ? options : ASSISTANT_MODEL_TYPES;
  if (modelOptions.length === 0) return null;
  const normalizedValue = normalizeInferenceModelValue(value);
  return (
    modelOptions.find((m) => m.value === normalizedValue) ||
    modelOptions.find((m) => m.value === DEFAULT_TEXT_MODEL) ||
    modelOptions[0]
  );
}

export default function UserAccount() {
  const { colorMode } = useColorMode();
  const { user, resetUser, getUserAPI, setUser, userFetching, userInitiated } = useUser();
  const navigate = useNavigate();
  const location = useLocation();

  const textColor = colorMode === "dark" ? "text-slate-100" : "text-slate-900";
  const bgColor = colorMode === "dark" ? "bg-[#0b1021]" : "bg-[#f7f9fc]";
  const secondaryTextColor = colorMode === "dark" ? "text-slate-400" : "text-slate-500";
  const cardBgColor = colorMode === "dark" ? "bg-[#0f1629] shadow-[0_16px_40px_rgba(0,0,0,0.35)]" : "bg-white shadow-sm";
  const borderColor = colorMode === "dark" ? "border-[#1f2a3d]" : "border-slate-200";
  const mutedBg = colorMode === "dark" ? "bg-[#111a2f]" : "bg-slate-50";
  const isDockerInstall = getSessionType() === "docker";
  const {
    isDockerInstall: isDockerModelFilteringEnabled,
    isLoading: isInferenceModelAvailabilityLoading,
    inferenceModelOptions,
    assistantModelOptions,
    hasConfiguredInferenceModels,
  } = useInferenceModelAvailability();
  const areDockerModelSelectsDisabled =
    isDockerModelFilteringEnabled &&
    (isInferenceModelAvailabilityLoading || !hasConfiguredInferenceModels);
  const dockerModelAvailabilityMessage = isDockerModelFilteringEnabled
    ? isInferenceModelAvailabilityLoading
      ? "Loading configured inference models..."
      : hasConfiguredInferenceModels
        ? "Only models supported by your configured Docker providers are shown."
        : "Configure OpenAI, Google Cloud, or a Samsar API key in setup to enable inference and assistant models."
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
  ];

  const resolvePanelFromPath = () => {
    const segments = location.pathname.split("/").filter(Boolean);
    const panel = segments[1] || "account";
    return validPanels.includes(panel) ? panel : "account";
  };

  const [displayPanel, setDisplayPanel] = useState(resolvePanelFromPath());
  const [sidebarOpen, setSidebarOpen] = useState(false);

  const [notifyOnCompletion, setNotifyOnCompletion] = useState(false);
  const [inferenceModel, setInferenceModel] = useState(
    getInferenceModelOption(DEFAULT_TEXT_MODEL)
  );
  const [assistantModel, setAssistantModel] = useState(
    getAssistantModelOption(DEFAULT_TEXT_MODEL)
  );
  const [videoFps, setVideoFps] = useState(VIDEO_FPS_OPTIONS[0]);

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
    if (
      isDockerModelFilteringEnabled &&
      !isInferenceModelAvailabilityLoading &&
      hasConfiguredInferenceModels
    ) {
      const modelPreferencePayload: Record<string, string> = {};
      if (
        nextInferenceModel?.value &&
        normalizeInferenceModelValue(user.selectedInferenceModel) !== nextInferenceModel.value
      ) {
        modelPreferencePayload.selectedInferenceModel = nextInferenceModel.value;
      }
      if (
        nextAssistantModel?.value &&
        normalizeInferenceModelValue(user.selectedAssistantModel) !== nextAssistantModel.value
      ) {
        modelPreferencePayload.selectedAssistantModel = nextAssistantModel.value;
      }
      syncUserDetailsSilently(modelPreferencePayload);
    }
  }, [assistantModelOptions, inferenceModelOptions, user]);

  useEffect(() => {
    setDisplayPanel(resolvePanelFromPath());
  }, [location.pathname]);

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
      ? "bg-[#16213a] border border-rose-400/40 text-rose-200 shadow-[0_0_0_1px_rgba(248,113,113,0.16)]"
      : "bg-white border border-rose-100 text-rose-700 shadow-sm";
  const navItemIdle =
    colorMode === "dark"
      ? "border border-transparent text-slate-300 hover:bg-[#0f1629]"
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
    { panel: "billing", label: "Billing" },
    { panel: "settings", label: "Settings" },
    { panel: "images", label: "Images" },
    { panel: "sounds", label: "Sounds" },
    { panel: "scenes", label: "Scenes" },
    { panel: "videos", label: "Videos" },
    { panel: "apiKeys", label: "API Keys" },
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
                        {!isDockerInstall && (
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

                    {!isDockerInstall && (
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
                          <SingleSelect
                            options={assistantModelOptions}
                            value={assistantModel}
                            onChange={handleAssistantModelChange}
                            isDisabled={areDockerModelSelectsDisabled}
                            placeholder={areDockerModelSelectsDisabled ? "No model configured" : undefined}
                          />
                        </div>
                        <div className="space-y-2">
                          <p className="text-sm font-semibold">Inference model</p>
                          <SingleSelect
                            options={inferenceModelOptions}
                            value={inferenceModel}
                            onChange={handleInferenceModelChange}
                            isDisabled={areDockerModelSelectsDisabled}
                            placeholder={areDockerModelSelectsDisabled ? "No model configured" : undefined}
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
                      {dockerModelAvailabilityMessage ? (
                        <p className={`text-xs ${secondaryTextColor}`}>
                          {dockerModelAvailabilityMessage}
                        </p>
                      ) : null}

                      {!isDockerInstall && emailNotificationBlock}
                    </div>

                    <div
                      className={`rounded-lg border ${borderColor} ${cardBgColor} p-4 shadow-sm space-y-4 sm:p-6`}
                    >
                      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                        <div>
                          <h3 className="text-lg font-semibold">Usage & Billing</h3>
                          <p className={`text-sm ${secondaryTextColor}`}>
                            {isDockerInstall
                              ? "Credits are charged provider side."
                              : "Track credits and billing status."}
                          </p>
                        </div>
                        <SecondaryButton onClick={() => goToPanel("billing")} className="w-full sm:w-auto">
                          {isDockerInstall ? "View billing" : "Purchase credits"}
                        </SecondaryButton>
                      </div>

                      {isDockerInstall ? (
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
              {displayPanel === "apiKeys" && <APIKeysPanelContent />}
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
