import { useEffect, useMemo, useState } from "react";
import { DragDropContext, Draggable, Droppable } from "react-beautiful-dnd";
import { FaExclamationTriangle, FaGripLines } from "react-icons/fa";
import { toast } from "react-toastify";

import { useColorMode } from "../../contexts/ColorMode.jsx";
import { useModelAdapterPreferences } from "../../hooks/useModelAdapterPreferences.js";
import {
  areModelAdapterPreferencesEqual,
  countModelAdapterModels,
  reorderAdapterPreference,
  resetModelAdapterPreferences,
  updateModelAdapterPreference,
} from "../../utils/modelAdapterPreferences.mjs";
import SecondaryButton from "../common/SecondaryButton.tsx";
import CustomTextToImageAdaptersEditor from "./CustomTextToImageAdaptersEditor.jsx";

function getErrorMessage(error, fallbackMessage) {
  return (
    error?.response?.data?.error ||
    error?.response?.data?.message ||
    error?.message ||
    fallbackMessage
  );
}

function formatUpdatedAt(updatedAt) {
  if (!updatedAt) {
    return "";
  }
  const date = new Date(updatedAt);
  return Number.isNaN(date.getTime()) ? "" : date.toLocaleString();
}

function ProviderAdapterPriorityEditor({ enabled = false }) {
  const { colorMode } = useColorMode();
  const {
    stages: serverStages,
    updatedAt,
    isLoading,
    isSaving,
    error,
    reload,
    savePreferences,
  } = useModelAdapterPreferences({ enabled });
  const [savedStages, setSavedStages] = useState([]);
  const [draftStages, setDraftStages] = useState([]);

  useEffect(() => {
    setSavedStages(serverStages);
    setDraftStages(serverStages);
  }, [serverStages]);

  const modelCount = useMemo(
    () => countModelAdapterModels(draftStages),
    [draftStages],
  );
  const defaultStages = useMemo(
    () => resetModelAdapterPreferences(draftStages),
    [draftStages],
  );
  const hasUnsavedChanges = useMemo(
    () => !areModelAdapterPreferencesEqual(draftStages, savedStages),
    [draftStages, savedStages],
  );
  const differsFromDefaults = useMemo(
    () => !areModelAdapterPreferencesEqual(draftStages, defaultStages),
    [defaultStages, draftStages],
  );

  const secondaryTextColor =
    colorMode === "dark" ? "text-slate-400" : "text-slate-600";
  const borderColor =
    colorMode === "dark" ? "border-[#3a4050]" : "border-slate-200";
  const stageSurface =
    colorMode === "dark" ? "bg-[#151720]" : "bg-slate-50";
  const modelSurface =
    colorMode === "dark" ? "bg-[#181b24]" : "bg-white";
  const adapterSurface =
    colorMode === "dark"
      ? "bg-[#20232e] hover:bg-[#292d3a]"
      : "bg-slate-50 hover:bg-slate-100";
  const draggingSurface =
    colorMode === "dark"
      ? "bg-[#292d3a] border-rose-400/50 shadow-[0_10px_28px_rgba(0,0,0,0.35)]"
      : "bg-rose-50 border-rose-200 shadow-lg";
  const primaryBadge =
    colorMode === "dark"
      ? "bg-emerald-400/10 text-emerald-200 border-emerald-400/30"
      : "bg-emerald-50 text-emerald-700 border-emerald-200";
  const fallbackBadge =
    colorMode === "dark"
      ? "bg-slate-700/40 text-slate-300 border-slate-600"
      : "bg-slate-100 text-slate-600 border-slate-200";

  const handleDragEnd = (modelKey, result) => {
    if (!result.destination) {
      return;
    }

    setDraftStages((currentStages) => {
      const currentModel = currentStages
        .flatMap((stage) => stage.models || [])
        .find((model) => model.modelKey === modelKey);
      if (!currentModel) {
        return currentStages;
      }

      const nextPreference = reorderAdapterPreference(
        currentModel.preference,
        result.source.index,
        result.destination.index,
      );
      return updateModelAdapterPreference(
        currentStages,
        modelKey,
        nextPreference,
      );
    });
  };

  const handleSave = async () => {
    try {
      const savedData = await savePreferences(draftStages);
      setSavedStages(savedData.stages);
      setDraftStages(savedData.stages);
      toast.success("Model adapter preferences saved.", {
        position: "bottom-center",
      });
    } catch (saveError) {
      toast.error(
        getErrorMessage(
          saveError,
          "Unable to save model adapter preferences.",
        ),
        { position: "bottom-center" },
      );
    }
  };

  const handleReset = () => {
    setDraftStages(defaultStages);
    toast.info("Default adapter order restored. Save to apply it.", {
      position: "bottom-center",
    });
  };

  const handleRetry = () => {
    reload().catch(() => undefined);
  };

  if (!enabled) {
    return null;
  }

  if (isLoading && modelCount === 0) {
    return (
      <div className="space-y-4" aria-live="polite" aria-busy="true">
        <div>
          <h3 className="text-lg font-semibold">Model Adapters</h3>
          <p className={`text-sm ${secondaryTextColor}`}>
            Loading adapters configured for this installation...
          </p>
        </div>
        {[0, 1, 2].map((item) => (
          <div
            key={item}
            className={`animate-pulse rounded-xl border ${borderColor} ${stageSurface} p-4`}
          >
            <div
              className={`h-4 w-32 rounded ${
                colorMode === "dark" ? "bg-slate-700" : "bg-slate-200"
              }`}
            />
            <div
              className={`mt-4 h-16 rounded-lg ${
                colorMode === "dark" ? "bg-slate-800" : "bg-white"
              }`}
            />
          </div>
        ))}
      </div>
    );
  }

  if (error && modelCount === 0) {
    return (
      <div
        className={`rounded-xl border ${borderColor} ${stageSurface} p-5`}
        role="alert"
      >
        <div className="flex items-start gap-3">
          <FaExclamationTriangle className="mt-1 shrink-0 text-amber-500" />
          <div className="min-w-0 flex-1">
            <h3 className="font-semibold">Unable to load model adapters</h3>
            <p className={`mt-1 text-sm ${secondaryTextColor}`}>
              {getErrorMessage(
                error,
                "The adapter configuration could not be loaded.",
              )}
            </p>
            <SecondaryButton
              type="button"
              onClick={handleRetry}
              className="mt-4 !m-0"
            >
              Try Again
            </SecondaryButton>
          </div>
        </div>
      </div>
    );
  }

  if (modelCount === 0) {
    return (
      <div className={`rounded-xl border ${borderColor} ${stageSurface} p-5`}>
        <h3 className="font-semibold">No model adapters available</h3>
        <p className={`mt-1 text-sm ${secondaryTextColor}`}>
          Configure an inference, image, or video provider in the standalone
          setup wizard to make its supported models available here.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0">
          <h3 className="text-lg font-semibold">Model Adapters</h3>
          <p className={`mt-1 max-w-3xl text-sm ${secondaryTextColor}`}>
            Drag installed adapters into the order they should be attempted.
            The first adapter is used initially; later adapters are tried in
            order when Text to Video, Image List to Video, or Studio retries a
            supported model.
          </p>
          {formatUpdatedAt(updatedAt) ? (
            <p className={`mt-2 text-xs ${secondaryTextColor}`}>
              Last saved {formatUpdatedAt(updatedAt)}
            </p>
          ) : null}
        </div>

        <div className="grid shrink-0 gap-2 sm:flex sm:flex-wrap lg:justify-end">
          <SecondaryButton
            type="button"
            onClick={handleReset}
            disabled={isSaving || !differsFromDefaults}
            className="w-full sm:w-auto"
          >
            Reset to Defaults
          </SecondaryButton>
          <SecondaryButton
            type="button"
            onClick={handleSave}
            isPending={isSaving}
            disabled={!hasUnsavedChanges}
            className="w-full sm:w-auto"
          >
            Save Preference Order
          </SecondaryButton>
        </div>
      </div>

      {error ? (
        <div
          className={`flex items-start gap-3 rounded-xl border border-amber-400/40 px-4 py-3 ${
            colorMode === "dark"
              ? "bg-amber-400/10 text-amber-100"
              : "bg-amber-50 text-amber-900"
          }`}
          role="alert"
        >
          <FaExclamationTriangle className="mt-1 shrink-0" />
          <p className="text-sm">
            {getErrorMessage(
              error,
              "The latest model adapter request did not complete.",
            )}
          </p>
        </div>
      ) : null}

      {draftStages.map((stage) => (
        <section
          key={stage.key}
          className={`rounded-xl border ${borderColor} ${stageSurface} p-4 sm:p-5`}
        >
          <div className="mb-4 flex items-center justify-between gap-3">
            <div>
              <h4 className="font-semibold">{stage.label}</h4>
              <p className={`text-xs ${secondaryTextColor}`}>
                {stage.models.length} available model
                {stage.models.length === 1 ? "" : "s"}
              </p>
            </div>
          </div>

          {stage.models.length === 0 ? (
            <div
              className={`rounded-lg border border-dashed ${borderColor} p-4 text-sm ${secondaryTextColor}`}
            >
              No models are available for this stage.
            </div>
          ) : (
            <div className="grid gap-4 xl:grid-cols-2">
              {stage.models.map((model) => (
                <div
                  key={model.modelKey}
                  className={`min-w-0 rounded-xl border ${borderColor} ${modelSurface} p-4`}
                >
                  <div className="mb-3">
                    <div className="font-semibold">{model.label}</div>
                    <div
                      className={`break-all text-xs font-mono ${secondaryTextColor}`}
                    >
                      {model.modelKey}
                    </div>
                  </div>

                  {model.availableAdapters.length === 0 ? (
                    <div
                      className={`rounded-lg border border-dashed ${borderColor} p-3 text-sm ${secondaryTextColor}`}
                    >
                      No configured adapter is currently available.
                    </div>
                  ) : (
                    <DragDropContext
                      onDragEnd={(result) =>
                        handleDragEnd(model.modelKey, result)
                      }
                    >
                      <Droppable
                        droppableId={`model-adapters:${stage.key}:${model.modelKey}`}
                        direction="vertical"
                      >
                        {(dropProvided, dropSnapshot) => (
                          <div
                            ref={dropProvided.innerRef}
                            {...dropProvided.droppableProps}
                            className={`space-y-2 rounded-lg transition-colors ${
                              dropSnapshot.isDraggingOver
                                ? colorMode === "dark"
                                  ? "bg-rose-400/5"
                                  : "bg-rose-50/70"
                                : ""
                            }`}
                          >
                            {model.preference.map((adapterKey, index) => {
                              const adapter =
                                model.availableAdapters.find(
                                  (candidate) =>
                                    candidate.key === adapterKey,
                                ) || {
                                  key: adapterKey,
                                  label: adapterKey,
                                };
                              const dragDisabled =
                                isSaving || model.preference.length < 2;

                              return (
                                <Draggable
                                  key={adapter.key}
                                  draggableId={`model-adapter:${stage.key}:${model.modelKey}:${adapter.key}`}
                                  index={index}
                                  isDragDisabled={dragDisabled}
                                >
                                  {(dragProvided, dragSnapshot) => (
                                    <div
                                      ref={dragProvided.innerRef}
                                      {...dragProvided.draggableProps}
                                      style={dragProvided.draggableProps.style}
                                      className={`flex min-w-0 items-center gap-3 rounded-lg border px-3 py-3 transition-colors ${
                                        dragSnapshot.isDragging
                                          ? draggingSurface
                                          : `${borderColor} ${adapterSurface}`
                                      }`}
                                    >
                                      <button
                                        type="button"
                                        {...dragProvided.dragHandleProps}
                                        className={`inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md ${
                                          dragDisabled
                                            ? "cursor-default opacity-40"
                                            : "cursor-grab active:cursor-grabbing"
                                        }`}
                                        aria-label={`Move ${adapter.label} for ${model.label}`}
                                        disabled={dragDisabled}
                                      >
                                        <FaGripLines />
                                      </button>
                                      <div className="min-w-0 flex-1">
                                        <div className="truncate text-sm font-semibold">
                                          {adapter.label}
                                        </div>
                                        <div
                                          className={`truncate text-xs ${secondaryTextColor}`}
                                        >
                                          {adapter.key}
                                        </div>
                                      </div>
                                      <span
                                        className={`shrink-0 rounded-full border px-2 py-1 text-[11px] font-semibold ${
                                          index === 0
                                            ? primaryBadge
                                            : fallbackBadge
                                        }`}
                                      >
                                        {index === 0
                                          ? "Primary"
                                          : `Fallback ${index}`}
                                      </span>
                                    </div>
                                  )}
                                </Draggable>
                              );
                            })}
                            {dropProvided.placeholder}
                          </div>
                        )}
                      </Droppable>
                    </DragDropContext>
                  )}
                </div>
              ))}
            </div>
          )}
        </section>
      ))}

      <div
        className={`sticky bottom-0 flex flex-col gap-3 rounded-xl border ${borderColor} ${modelSurface} p-3 shadow-lg sm:flex-row sm:items-center sm:justify-between`}
      >
        <p className={`text-sm ${secondaryTextColor}`} aria-live="polite">
          {hasUnsavedChanges
            ? "You have unsaved adapter order changes."
            : "Adapter preference order is up to date."}
        </p>
        <SecondaryButton
          type="button"
          onClick={handleSave}
          isPending={isSaving}
          disabled={!hasUnsavedChanges}
          className="w-full sm:w-auto"
        >
          Save Preference Order
        </SecondaryButton>
      </div>
    </div>
  );
}

export default function ModelAdaptersPanelContent({
  enabled = false,
  preferencesEnabled = false,
}) {
  if (!enabled) {
    return null;
  }

  return (
    <div className="space-y-6">
      <CustomTextToImageAdaptersEditor />
      <ProviderAdapterPriorityEditor enabled={preferencesEnabled} />
    </div>
  );
}
