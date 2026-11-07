import { useUiLanguage } from '../../hooks/useUiLanguage.js';
import { translateText as uiText, formatUiDate } from '../../utils/localization.js';
import { useEffect, useMemo, useRef, useState } from 'react';
import axios from 'axios';
import TextareaAutosize from 'react-textarea-autosize';
import {
  MdChatBubbleOutline,
  MdCloseFullscreen,
  MdDeleteOutline,
  MdOpenInFull,
} from 'react-icons/md';
import { FaCopy } from 'react-icons/fa';

import { useColorMode } from '../../contexts/ColorMode.jsx';
import { useUser } from "../../contexts/UserContext.jsx";
import CommonButton from '../common/CommonButton.tsx';
import ModelAdapterSelect from "../common/ModelAdapterSelect.jsx";
import { ASSISTANT_MODEL_TYPES } from "../../constants/Types.ts";
import { getHeaders } from "../../utils/web.jsx";
import { useDeploymentModelAvailability } from "../../hooks/useDeploymentModelAvailability.js";
import { useInferenceModelAvailability } from "../../hooks/useInferenceModelAvailability.js";
import {
  normalizeDeploymentInferenceModelValue,
  resolveAllowedInferenceModelOption,
} from "../../utils/deploymentProviders.js";

const PROCESSOR_SERVER = import.meta.env.VITE_PROCESSOR_API;
const DEFAULT_TEXT_MODEL = 'gpt-6-astra';
const ASSISTANT_SIDEBAR_SAFE_GAP_PX = 24;

function normalizeMessageText(content) {
  if (typeof content === 'string') {
    return content;
  }

  if (Array.isArray(content)) {
    return content
      .map((item) => normalizeMessageText(item))
      .filter(Boolean)
      .join('\n\n');
  }

  if (content && typeof content === 'object') {
    if (content.type === 'input_image' || content.type === 'image_url') {
      return '';
    }
    if (content.type === 'input_text' && typeof content.text === 'string') {
      return content.text;
    }
    if (content.type === 'output_text' && typeof content.text === 'string') {
      return content.text;
    }
    if (typeof content.text === 'string') {
      return content.text;
    }
    if (typeof content.text?.value === 'string') {
      return content.text.value;
    }
    if (typeof content.content === 'string') {
      return content.content;
    }
    if (Array.isArray(content.content)) {
      return normalizeMessageText(content.content);
    }
    if (typeof content.output_text === 'string') {
      return content.output_text;
    }
  }

  return '';
}

function hasMessageImageAttachment(content) {
  if (Array.isArray(content)) {
    return content.some((item) => hasMessageImageAttachment(item));
  }

  if (!content || typeof content !== 'object') {
    return false;
  }

  if (content.type === 'input_image' || content.type === 'image_url') {
    return true;
  }

  if (Array.isArray(content.content)) {
    return hasMessageImageAttachment(content.content);
  }

  return false;
}

function renderMessageContent(messageText) {
  const parts = [];
  const boldPattern = /\*\*(.*?)\*\*|\[([^\]\n]+)\]\((https:\/\/[^\s)]+)\)/g;
  let lastIndex = 0;
  let match;

  while ((match = boldPattern.exec(messageText)) !== null) {
    if (match.index > lastIndex) {
      parts.push(messageText.slice(lastIndex, match.index));
    }
    if (match[1] !== undefined) {
      parts.push(<strong key={`bold-${match.index}`} className="font-semibold">{match[1]}</strong>);
    } else {
      let allowed = false;
      try { allowed = ['docs.samsar.one', 'samsar.one'].includes(new URL(match[3]).hostname); } catch { /* Render invalid links as text. */ }
      parts.push(allowed ? <a key={`source-${match.index}`} href={match[3]} target="_blank" rel="noopener noreferrer" className="underline">{match[2]}</a> : match[0]);
    }
    lastIndex = match.index + match[0].length;
  }

  if (lastIndex < messageText.length) {
    parts.push(messageText.slice(lastIndex));
  }

  // Keep literal newlines and indentation for the message's whitespace-pre-wrap.
  return parts;
}

export default function AssistantHome(props) {
  useUiLanguage();
  const {
    submitAssistantQuery,
    sessionMessages = [],
    isAssistantQueryGenerating = false,
    sessionId,
    workspace,
    onOpen,
    onSessionMessagesChange,
    onSessionDetailsChange,
    onAssistantQueryGeneratingChange,
    onDeleteMessage,
    onResetMessages,
    onSessionCleared,
    getFrameImageData,
    currentLayerId,
    onSceneActionApplied,
    canUndoCanvasHistory = false,
    canRedoCanvasHistory = false,
    onUndoCanvasHistory,
    onRedoCanvasHistory,
  } = props;

  const { colorMode } = useColorMode();
  const { user, getUserAPI } = useUser();
  const {
    isStandaloneDeployment,
    isLoading: isInferenceModelAvailabilityLoading,
    assistantModelOptions,
    hasConfiguredInferenceModels,
  } = useInferenceModelAvailability();
  const { primaryAdapterByModel } = useDeploymentModelAvailability();
  const messagesEndRef = useRef(null);
  const launcherRef = useRef(null);
  const panelRef = useRef(null);
  const [isOpen, setIsOpen] = useState(false);
  const [isExpanded, setIsExpanded] = useState(false);
  const activeSessionRef = useRef(sessionId);
  activeSessionRef.current = sessionId;
  const interactionVersionRef = useRef(0);
  const [userInput, setUserInput] = useState('');
  const [assistantModel, setAssistantModel] = useState(
    ASSISTANT_MODEL_TYPES.find((model) => model.value === DEFAULT_TEXT_MODEL) || ASSISTANT_MODEL_TYPES[0]
  );
  const pendingAssistantModelSyncRef = useRef('');
  const [deletingMessageId, setDeletingMessageId] = useState(null);
  const [isResetting, setIsResetting] = useState(false);
  const [isResetConfirmVisible, setIsResetConfirmVisible] = useState(false);
  const [resetError, setResetError] = useState('');
  const [includeFrameImage, setIncludeFrameImage] = useState(false);
  const [isPreparingFrameImage, setIsPreparingFrameImage] = useState(false);
  const [applyingSceneActionId, setApplyingSceneActionId] = useState(null);
  const isAssistantModelUnavailable =
    isStandaloneDeployment &&
    (isInferenceModelAvailabilityLoading || !hasConfiguredInferenceModels);

  async function updateUserAssistantModel(newModelValue) {
    try {
      const headers = getHeaders();
      await axios.post(`${PROCESSOR_SERVER}/users/update`, { selectedAssistantModel: newModelValue }, headers);
      getUserAPI();
    } catch  {
    }
  }

  useEffect(() => {
    if (!user) return;
    const userAssistantModel = user.selectedAssistantModel || DEFAULT_TEXT_MODEL;
    const userAssistantModelOption = resolveAllowedInferenceModelOption(
      userAssistantModel,
      assistantModelOptions,
      DEFAULT_TEXT_MODEL,
    );
    setAssistantModel(userAssistantModelOption);

    const canReconcileAssistantModel =
      !isStandaloneDeployment ||
      (!isInferenceModelAvailabilityLoading && hasConfiguredInferenceModels);
    const normalizedUserAssistantModel = normalizeDeploymentInferenceModelValue(userAssistantModel);
    const normalizedOptionAssistantModel = normalizeDeploymentInferenceModelValue(
      userAssistantModelOption?.value,
    );
    if (canReconcileAssistantModel && userAssistantModelOption?.value) {
      if (normalizedOptionAssistantModel === normalizedUserAssistantModel) {
        pendingAssistantModelSyncRef.current = '';
      } else if (pendingAssistantModelSyncRef.current !== userAssistantModelOption.value) {
        pendingAssistantModelSyncRef.current = userAssistantModelOption.value;
        updateUserAssistantModel(userAssistantModelOption.value);
      }
    }
  }, [
    assistantModelOptions,
    hasConfiguredInferenceModels,
    isStandaloneDeployment,
    isInferenceModelAvailabilityLoading,
    user,
  ]);

  useEffect(() => {
    if (!isOpen) return;
    const timer = setTimeout(() => {
      if (messagesEndRef.current) {
        messagesEndRef.current.scrollIntoView({ behavior: 'smooth', block: 'end' });
      }
    }, 80);

    return () => clearTimeout(timer);
  }, [isOpen, sessionMessages, isExpanded]);

  useEffect(() => {
    return () => {
      if (typeof document !== 'undefined') {
        document.documentElement?.style?.removeProperty('--assistant-sidebar-safe-bottom');
      }
    };
  }, []);

  const handleAssistantModelChange = (newValue) => {
    if (!newValue?.value) return;
    setAssistantModel(newValue);
    updateUserAssistantModel(newValue.value);
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    const normalizedInput = userInput.trim();
    if (!normalizedInput || isAssistantQueryGenerating || isPreparingFrameImage || isAssistantModelUnavailable || isResetting || isResetConfirmVisible) return;
    const interactionVersion = interactionVersionRef.current;
    const submittedSessionId = sessionId;

    let requestOptions;
    if (includeFrameImage && typeof getFrameImageData === 'function') {
      try {
        setIsPreparingFrameImage(true);
        const frameImage = await getFrameImageData();
        if (!frameImage?.dataUrl) {
          window.alert(uiText("Unable to capture the current frame image."));
          return;
        }
        requestOptions = { frameImage };
      } catch  {
        window.alert(uiText("Unable to capture the current frame image."));
        return;
      } finally {
        if (interactionVersion === interactionVersionRef.current && submittedSessionId === activeSessionRef.current) {
          setIsPreparingFrameImage(false);
        }
      }
    }

    if (interactionVersion !== interactionVersionRef.current || submittedSessionId !== activeSessionRef.current) return;
    submitAssistantQuery(normalizedInput, requestOptions);
    setUserInput('');
    setIsOpen(true);
  };

  const handleDeleteMessage = async (messageId) => {
    if (!messageId) return;
    const confirmed = window.confirm(uiText("Delete this assistant exchange from the current session?"));
    if (!confirmed) return;

    try {
      setDeletingMessageId(messageId);
      if (onDeleteMessage) {
        await onDeleteMessage(messageId);
        return;
      }

      if (!sessionId) return;

      const headers = getHeaders();
      if (!headers) {
        setResetError(uiText("Sign in to reset the assistant session."));
        return;
      }
      const response = await axios.post(
        `${PROCESSOR_SERVER}/assistants/delete_session_message`,
        { id: sessionId, messageId, ...(workspace ? { workspace } : {}) },
        headers
      );
      onSessionMessagesChange?.(response?.data?.sessionDetails?.sessionMessages || []);
      onAssistantQueryGeneratingChange?.(Boolean(response?.data?.sessionDetails?.sessionMessageGenerationPending));
    } finally {
      setDeletingMessageId(null);
    }
  };

  const applyResetSessionState = (sessionDetails) => {
    interactionVersionRef.current += 1;
    onSessionCleared?.(sessionDetails);
    setUserInput('');
    setIncludeFrameImage(false);
    setIsPreparingFrameImage(false);
    const nextMessages = Array.isArray(sessionDetails?.sessionMessages)
      ? sessionDetails.sessionMessages
      : [];

    onSessionMessagesChange?.(nextMessages);
    onAssistantQueryGeneratingChange?.(Boolean(sessionDetails?.sessionMessageGenerationPending));
    if (sessionDetails && typeof sessionDetails === 'object') {
      onSessionDetailsChange?.(sessionDetails);
    }
  };

  const handleResetRequest = () => {
    if (!onResetMessages && !sessionId) return;
    setResetError('');
    setIsResetConfirmVisible(true);
  };

  const handleCancelReset = () => {
    if (isResetting) return;
    setResetError('');
    setIsResetConfirmVisible(false);
  };

  const handleResetMessages = async () => {
    if (!onResetMessages && !sessionId) return;

    const clearingSessionId = sessionId;
    try {
      setIsResetting(true);
      setResetError('');
      if (onResetMessages) {
        const resetResponse = await onResetMessages();
        const sessionDetails = resetResponse?.data?.sessionDetails || resetResponse?.sessionDetails || null;
        if (activeSessionRef.current !== clearingSessionId) return;
        applyResetSessionState(sessionDetails);
        setIsResetConfirmVisible(false);
        return;
      }

      const headers = getHeaders();
      if (!headers) throw new Error(uiText("Sign in to clear the assistant session."));
      const response = await axios.post(
        `${PROCESSOR_SERVER}/assistants/reset_session_messages`,
        { id: sessionId, ...(workspace ? { workspace } : {}) },
        headers
      );
      if (activeSessionRef.current !== clearingSessionId) return;
      applyResetSessionState(response?.data?.sessionDetails || null);
      setUserInput('');
      setIsResetConfirmVisible(false);
    } catch (error) {
      if (activeSessionRef.current === clearingSessionId) {
        setResetError(error?.response?.data?.error || error?.message || uiText("Unable to clear the assistant session."));
      }
    } finally {
      setIsResetting(false);
    }
  };

  const copyToClipboard = async (text) => {
    try {
      await navigator.clipboard.writeText(text);
    } catch  {
    }
  };

  const handleSceneActionClick = async (actionId) => {
    if (!actionId || !sessionId || !currentLayerId || applyingSceneActionId) {
      return;
    }

    const headers = getHeaders();
    if (!headers) return;

    try {
      setApplyingSceneActionId(actionId);
      const response = await axios.post(
        `${PROCESSOR_SERVER}/assistants/apply_scene_action`,
        {
          id: sessionId,
          layerId: currentLayerId,
          actionId,
        },
        headers
      );
      const responseData = response?.data || {};
      onSessionMessagesChange?.(responseData?.sessionDetails?.sessionMessages || []);
      onAssistantQueryGeneratingChange?.(false);
      onSceneActionApplied?.(responseData);
    } catch (error) {
      window.alert(error?.response?.data?.error || uiText("Unable to apply scene action."));
    } finally {
      setApplyingSceneActionId(null);
    }
  };

  const messageList = useMemo(
    () =>
      (sessionMessages || []).map((message, index) => ({
        ...message,
        clientKey: `${message?.id || 'message'}-${message?.role || 'unknown'}-${index}`,
        normalizedText: normalizeMessageText(message?.content),
        hasImageAttachment: hasMessageImageAttachment(message?.content),
        sceneActions: Array.isArray(message?.sceneActions) ? message.sceneActions : [],
        sceneActionApplied: message?.sceneActionApplied || null,
      })),
    [sessionMessages]
  );

  const hasConversationActivity =
    messageList.length > 0 || isAssistantQueryGenerating || isPreparingFrameImage;
  const shouldShowWelcomeOptions = isOpen && !hasConversationActivity;
  const shouldShowConversationArea = isExpanded || hasConversationActivity || shouldShowWelcomeOptions;

  useEffect(() => {
    if (typeof document === 'undefined' || typeof window === 'undefined') {
      return undefined;
    }

    const rootStyle = document.documentElement?.style;
    if (!rootStyle) {
      return undefined;
    }

    let frameId = null;
    let resizeObserver = null;

    const updateSidebarSafeBottom = () => {
      const activeElement = isOpen ? panelRef.current : launcherRef.current;
      if (!activeElement) {
        rootStyle.setProperty('--assistant-sidebar-safe-bottom', '0px');
        return;
      }

      const rect = activeElement.getBoundingClientRect();
      const overlayHeight = Math.max(
        0,
        Math.ceil(window.innerHeight - rect.top + ASSISTANT_SIDEBAR_SAFE_GAP_PX)
      );

      rootStyle.setProperty('--assistant-sidebar-safe-bottom', `${overlayHeight}px`);
    };

    const scheduleSidebarSafeBottomUpdate = () => {
      if (frameId !== null) {
        window.cancelAnimationFrame(frameId);
      }

      frameId = window.requestAnimationFrame(() => {
        frameId = null;
        updateSidebarSafeBottom();
      });
    };

    scheduleSidebarSafeBottomUpdate();
    window.addEventListener('resize', scheduleSidebarSafeBottomUpdate);

    const activeElement = isOpen ? panelRef.current : launcherRef.current;
    if (activeElement && typeof ResizeObserver !== 'undefined') {
      resizeObserver = new ResizeObserver(() => {
        scheduleSidebarSafeBottomUpdate();
      });
      resizeObserver.observe(activeElement);
    }

    return () => {
      if (frameId !== null) {
        window.cancelAnimationFrame(frameId);
      }
      window.removeEventListener('resize', scheduleSidebarSafeBottomUpdate);
      resizeObserver?.disconnect();
    };
  }, [hasConversationActivity, isExpanded, isOpen, userInput]);

  const launcherShell =
    `border border-line-strong bg-surface text-fg ${colorMode === 'dark' ? 'shadow-[0_18px_38px_rgba(0,0,0,0.45)]' : 'shadow-[0_16px_34px_rgba(15,23,42,0.18)]'}`;
  const panelShell =
    'border border-line bg-surface-sunken text-left text-fg';
  const subtleText = "text-fg-tertiary";
  const headerButtonShell =
    `border border-line text-fg-secondary ${colorMode === 'dark' ? 'bg-[#181b24] hover:bg-[#292d3a]' : 'bg-slate-100 hover:bg-slate-200'}`;
  const inputShell =
    `border border-line-control text-fg ${colorMode === 'dark' ? 'bg-[#181b24] focus:border-[#f6c453] focus:ring-2 focus:ring-[#f6c453]/20' : 'bg-slate-50'}`;
  const resetConfirmShell =
    `border border-line text-fg ${colorMode === 'dark' ? 'bg-[#181b24]' : 'bg-slate-50'}`;
  const resetConfirmButtonShell =
    `border border-line-strong bg-surface-raised hover:bg-surface-hover ${colorMode === 'dark' ? 'text-slate-100' : 'text-slate-800'}`;
  const panelDimensions = isExpanded
    ? 'fixed inset-4 md:inset-6'
    : hasConversationActivity || shouldShowWelcomeOptions
    ? 'fixed bottom-20 right-4 w-[min(92vw,420px)] h-[min(72vh,680px)]'
    : 'fixed bottom-20 right-4 w-[min(92vw,420px)]';
  const assistantOverlayZIndex = 2000;
  const canIncludeFrameImage = typeof getFrameImageData === 'function';
  const assistantInputPlaceholder = uiText("Ask about this session...");

  useEffect(() => {
    interactionVersionRef.current += 1;
    setUserInput('');
    setIncludeFrameImage(false);
    setIsPreparingFrameImage(false);
    setIsResetConfirmVisible(false);
    setResetError('');
  }, [sessionId]);

  return (
    <div className="fixed bottom-4 right-4 z-40" style={{ zIndex: assistantOverlayZIndex }}>
      <button
        ref={launcherRef}
        type="button"
        onClick={() => { if (!isOpen) onOpen?.(); setIsOpen((current) => !current); }}
        className={`group inline-flex items-center gap-3 rounded-full px-4 py-3 transition ${launcherShell}`}
      >
        <span className="flex h-10 w-10 items-center justify-center rounded-full bg-gradient-to-br from-[#ff4655] to-[#f6c453] text-[#080a10] shadow-[0_10px_24px_rgba(255,70,85,0.22)]">
          <MdChatBubbleOutline className="text-[22px]" />
        </span>
        <span className="flex flex-col items-start leading-none">
          <span className="text-sm font-semibold">{uiText("Assistant")}</span>
        </span>
      </button>

      {isOpen ? (
        <div
          ref={panelRef}
          className={panelDimensions}
          style={{ zIndex: assistantOverlayZIndex }}
        >
          <div
            className={`flex ${isExpanded || hasConversationActivity || shouldShowWelcomeOptions ? 'h-full' : ''} flex-col overflow-hidden rounded-3xl shadow-[0_28px_80px_rgba(15,23,42,0.3)] ${panelShell}`}
          >
            <header className="shrink-0 border-b border-line px-4 py-2.5">
              <div className="flex items-center justify-between gap-2">
                <div className="min-w-0 flex-1" title={assistantModel?.label}>
                  <ModelAdapterSelect
                    aria-label={uiText("Assistant model")}
                    options={assistantModelOptions}
                    value={assistantModel}
                    onChange={handleAssistantModelChange}
                    primaryAdapterByModel={primaryAdapterByModel}
                    isStandaloneDeployment={isStandaloneDeployment}
                    isDisabled={isAssistantModelUnavailable || isResetting}
                    isSearchable={false}
                    compactLayout
                    truncateLabels
                    placeholder={isAssistantModelUnavailable ? uiText("No model configured") : undefined}
                    styles={{
                      control: () => ({ backgroundColor: 'transparent', borderWidth: 0, fontSize: 14, cursor: 'pointer' }),
                      singleValue: () => ({ fontWeight: 600 }),
                      valueContainer: () => ({ paddingLeft: 0 }),
                      menu: () => ({ width: 'max(100%, min(20rem, calc(100vw - 2rem)))' }),
                    }}
                  />
                </div>

                <div className="flex shrink-0 items-center gap-1">
                  <button
                    type="button"
                    onClick={handleResetRequest}
                    disabled={(!onResetMessages && !sessionId) || isResetting || Boolean(applyingSceneActionId) || Boolean(deletingMessageId)}
                    className={`inline-flex h-8 w-8 items-center justify-center rounded-lg transition disabled:opacity-50 ${headerButtonShell}`}
                    aria-label={uiText("Clear session")}
                    title={uiText("Clear session")}
                  >
                    <MdDeleteOutline className="text-[16px]" />
                  </button>
                  <button
                    type="button"
                    onClick={() => setIsExpanded((current) => !current)}
                    className={`inline-flex h-8 w-8 items-center justify-center rounded-lg transition ${headerButtonShell}`}
                    aria-label={isExpanded ? uiText("Switch to condensed view") : uiText("Expand assistant")}
                    title={isExpanded ? uiText("Switch to condensed view") : uiText("Expand assistant")}
                  >
                    {isExpanded ? (
                      <MdCloseFullscreen className="text-[18px]" />
                    ) : (
                      <MdOpenInFull className="text-[18px]" />
                    )}
                  </button>
                  <button
                    type="button"
                    onClick={() => setIsOpen(false)}
                    className={`inline-flex h-8 w-8 items-center justify-center rounded-lg transition ${headerButtonShell}`}
                    aria-label={uiText("Collapse assistant")}
                    title={uiText("Collapse assistant")}
                  >
                    <span aria-hidden="true" className="block h-0.5 w-3.5 rounded-full bg-current" />
                  </button>
                </div>
              </div>
            </header>

            {shouldShowConversationArea ? (
              <div role="log" aria-label={uiText("Assistant conversation")} className="mx-auto box-border min-h-0 w-full max-w-3xl flex-1 overflow-y-auto px-4 py-4">
                {messageList.length > 0 ? (
                <div className="space-y-3">
                  {messageList.map((message) => {
                    const isUserMessage = message.role === 'user';
                    const bubbleShell = isUserMessage
                      ? 'border border-line-strong bg-surface-muted'
                      : `border border-line ${colorMode === 'dark' ? 'bg-[#0c0d12]' : 'bg-white'}`;

                    return (
                      <div
                        key={message.clientKey}
                        className={`flex ${isUserMessage ? 'justify-end' : 'justify-start'}`}
                      >
                        <div className={`w-full max-w-[92%] rounded-2xl px-3 py-3 ${bubbleShell}`}>
                          <div className="mb-1 flex items-center justify-between gap-2 text-caption">
                            <div className="font-medium text-fg-tertiary" title={message.timestamp ? formatUiDate(message.timestamp, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : undefined}>
                              {isUserMessage ? uiText("User") : uiText("Assistant")}
                            </div>
                            <div className="flex items-center gap-1.5">
                              <button
                                type="button"
                                onClick={() => copyToClipboard(message.normalizedText)}
                                className="inline-flex h-7 w-7 items-center justify-center rounded-md text-fg-tertiary transition hover:bg-surface-hover hover:text-fg"
                                aria-label={uiText("Copy message")}
                                title={uiText("Copy message")}
                              >
                                <FaCopy className="text-caption" />
                              </button>
                              {onDeleteMessage || sessionId ? (
                                <button
                                  type="button"
                                  onClick={() => handleDeleteMessage(message.id)}
                                  disabled={deletingMessageId === message.id || isResetting || isResetConfirmVisible}
                                  className="inline-flex h-7 w-7 items-center justify-center rounded-md text-fg-tertiary transition hover:bg-surface-hover hover:text-fg disabled:opacity-50"
                                  aria-label={uiText("Delete this exchange")}
                                  title={uiText("Delete this exchange")}
                                >
                                  <MdDeleteOutline className="text-[14px]" />
                                </button>
                              ) : null}
                            </div>
                          </div>
                          {isUserMessage && message.hasImageAttachment ? (
                            <div className="mb-2">
                              <span
                                className={`inline-flex items-center rounded-full border px-2 py-0.5 text-caption font-medium border-line-strong bg-surface-raised ${colorMode === 'dark' ? 'text-slate-300' : 'text-slate-500'}`}
                              >{uiText("Frame image")}</span>
                            </div>
                          ) : null}
                          <div className="text-sm leading-6 break-words whitespace-pre-wrap">
                            {renderMessageContent(message.normalizedText)}
                          </div>
                          {message.assistantStreamStatus === 'interrupted' ? (
                            <div role="status" className="mt-2 text-xs text-fg-tertiary">{uiText("Response interrupted")}</div>
                          ) : null}
                          {message.sceneActions.length > 0 ? (
                            <div className="mt-3 grid gap-2">
                              {message.sceneActions.map((action) => {
                                const isApplying = applyingSceneActionId === action.id;
                                return (
                                  <button
                                    key={action.id}
                                    type="button"
                                    onClick={() => handleSceneActionClick(action.id)}
                                    disabled={!currentLayerId || Boolean(applyingSceneActionId) || isResetting || isResetConfirmVisible}
                                    className={`rounded-xl border px-3 py-2 text-left text-xs transition disabled:cursor-not-allowed disabled:opacity-50 border-line bg-surface-muted hover:bg-surface-hover ${colorMode === 'dark' ? 'hover:border-[#f6c453]/50' : ''}`}
                                    title={!currentLayerId ? uiText("Select a layer before applying a scene action") : action.description}
                                  >
                                    <span className="block font-semibold">{isApplying ? uiText("Applying...") : action.label}</span>
                                    <span className={subtleText}>{action.description}</span>
                                  </button>
                                );
                              })}
                            </div>
                          ) : null}
                          {message.sceneActionApplied ? (
                            <div className="mt-3 flex flex-wrap gap-2">
                              <button
                                type="button"
                                onClick={onUndoCanvasHistory}
                                disabled={!canUndoCanvasHistory}
                                className={`rounded-full px-3 py-1.5 text-xs font-medium transition disabled:cursor-not-allowed disabled:opacity-50 ${headerButtonShell}`}
                              >{uiText("Undo")}</button>
                              <button
                                type="button"
                                onClick={onRedoCanvasHistory}
                                disabled={!canRedoCanvasHistory}
                                className={`rounded-full px-3 py-1.5 text-xs font-medium transition disabled:cursor-not-allowed disabled:opacity-50 ${headerButtonShell}`}
                              >{uiText("Redo")}</button>
                            </div>
                          ) : null}
                        </div>
                      </div>
                    );
                  })}
                  <div ref={messagesEndRef} />
                </div>
              ) : (
                  <div className="flex h-full min-h-[64px] items-center justify-center px-4 text-center text-sm text-fg-tertiary">
                    {isAssistantQueryGenerating ? uiText("Thinking...") : uiText("How can I help with your session?")}
                  </div>
                )}
              </div>
            ) : null}

            <form onSubmit={handleSubmit} className="mx-auto box-border max-h-[65%] w-full max-w-3xl shrink-0 overflow-y-auto border-t border-line px-4 py-3">
              {isResetConfirmVisible ? (
                <div role="alertdialog" aria-label={uiText("Clear assistant session?")} className={`mb-3 rounded-xl px-3 py-3 text-sm ${resetConfirmShell}`}>
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <div className="min-w-0">
                      <div className="font-semibold">{uiText("Clear assistant session?")}</div>
                      <div className={`mt-1 text-xs leading-5 ${subtleText}`}>{uiText("Delete all assistant messages and stop pending replies? Your project stays unchanged.")}</div>
                      {resetError ? (
                        <div role="alert" className="mt-2 text-xs font-medium text-red-500">{resetError}</div>
                      ) : null}
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      <button
                        type="button"
                        onClick={handleResetMessages}
                        disabled={isResetting}
                        className={`inline-flex h-9 min-w-[56px] items-center justify-center rounded-full px-4 text-xs font-semibold transition disabled:cursor-not-allowed disabled:opacity-50 ${resetConfirmButtonShell}`}
                      >
                        {isResetting ? uiText("Clearing...") : uiText("Clear messages")}
                      </button>
                      <button
                        type="button"
                        onClick={handleCancelReset}
                        disabled={isResetting}
                        className={`inline-flex h-9 min-w-[52px] items-center justify-center rounded-full px-4 text-xs font-semibold transition disabled:cursor-not-allowed disabled:opacity-50 ${resetConfirmButtonShell}`}
                      >{uiText("Cancel")}</button>
                    </div>
                  </div>
                </div>
              ) : null}
              {isStandaloneDeployment && !isInferenceModelAvailabilityLoading && !hasConfiguredInferenceModels ? (
                <div className="mb-3 rounded-2xl border border-amber-400/30 bg-amber-400/10 px-3 py-2 text-xs font-medium text-amber-600 dark:text-amber-200">{uiText("Configure OpenAI, Google Cloud, Alibaba Cloud, OpenRouter, or a Samsar API key in setup to use the assistant.")}</div>
              ) : null}
              <TextareaAutosize
                value={userInput}
                onChange={(event) => setUserInput(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' && !event.shiftKey) {
                    event.preventDefault();
                    handleSubmit(event);
                  }
                }}
                className={`mb-3 w-full resize-none rounded-2xl px-3 py-3 focus:outline-none ${inputShell}`}
                minRows={2}
                maxRows={5}
                aria-label={uiText("Message assistant")}
                disabled={isResetting || isResetConfirmVisible}
                placeholder={assistantInputPlaceholder}
              />
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  {canIncludeFrameImage ? (
                    <label
                      className={`inline-flex cursor-pointer items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-medium transition border-line text-fg-secondary ${colorMode === 'dark' ? 'bg-[#181b24] hover:border-[#f6c453]/50' : 'bg-slate-50'}`}
                    >
                      <input
                        type="checkbox"
                        checked={includeFrameImage}
                        onChange={(event) => setIncludeFrameImage(event.target.checked)}
                        disabled={isAssistantQueryGenerating || isPreparingFrameImage || isResetting || isResetConfirmVisible}
                        className="h-3.5 w-3.5 rounded border-slate-300 accent-[#ff4655]"
                      />
                      <span>{uiText("Include frame image")}</span>
                    </label>
                  ) : null}
                </div>
                <CommonButton
                  type="submit"
                  isPending={isAssistantQueryGenerating || isPreparingFrameImage}
                  isDisabled={isAssistantModelUnavailable || isResetting || isResetConfirmVisible || !userInput.trim()}
                  extraClasses="!m-0 min-w-[72px] shrink-0"
                >{uiText("Send")}</CommonButton>
              </div>
            </form>
          </div>
        </div>
      ) : null}
    </div>
  );
}
