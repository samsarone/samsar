import { useCallback, useEffect, useState } from "react";
import axios from "axios";

import { IS_STANDALONE_DEPLOYMENT } from "../utils/environment.jsx";
import { refreshModelAvailabilityCaches } from "../utils/modelAvailabilityRefresh.mjs";
import { getHeaders } from "../utils/web.jsx";
import {
  buildModelProviderPriority,
  normalizeModelAdapterResponse,
} from "../utils/modelAdapterPreferences.mjs";

const PROCESSOR_SERVER = import.meta.env.VITE_PROCESSOR_API || "";
const MODEL_ADAPTERS_ENDPOINT = `${PROCESSOR_SERVER}/users/model_adapters`;
const EMPTY_MODEL_ADAPTER_DATA = Object.freeze({
  stages: [],
  updatedAt: null,
});

function getRequestConfig(extraConfig = {}) {
  return {
    ...(getHeaders() || {}),
    ...extraConfig,
  };
}

function isCancelledRequest(error) {
  return (
    axios.isCancel(error) ||
    error?.code === "ERR_CANCELED" ||
    error?.name === "CanceledError"
  );
}

export function useModelAdapterPreferences({ enabled = false } = {}) {
  const [data, setData] = useState(EMPTY_MODEL_ADAPTER_DATA);
  const [isLoading, setIsLoading] = useState(enabled);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState(null);

  const loadPreferences = useCallback(async ({ signal } = {}) => {
    if (!enabled) {
      setData(EMPTY_MODEL_ADAPTER_DATA);
      setIsLoading(false);
      setError(null);
      return EMPTY_MODEL_ADAPTER_DATA;
    }

    setIsLoading(true);
    setError(null);
    try {
      const response = await axios.get(
        MODEL_ADAPTERS_ENDPOINT,
        getRequestConfig(signal ? { signal } : {}),
      );
      const normalizedData = normalizeModelAdapterResponse(response.data);
      setData(normalizedData);
      return normalizedData;
    } catch (requestError) {
      if (!isCancelledRequest(requestError)) {
        setError(requestError);
      }
      throw requestError;
    } finally {
      if (!signal?.aborted) {
        setIsLoading(false);
      }
    }
  }, [enabled]);

  useEffect(() => {
    if (!enabled) {
      setData(EMPTY_MODEL_ADAPTER_DATA);
      setIsLoading(false);
      setIsSaving(false);
      setError(null);
      return undefined;
    }

    const controller = new AbortController();
    loadPreferences({ signal: controller.signal }).catch((requestError) => {
      if (!isCancelledRequest(requestError)) {
        // The hook exposes the captured error to the panel.
      }
    });

    return () => {
      controller.abort();
    };
  }, [enabled, loadPreferences]);

  const savePreferences = useCallback(async (stages) => {
    if (!enabled) {
      throw new Error("Model adapter settings are unavailable.");
    }

    setIsSaving(true);
    setError(null);
    try {
      const response = await axios.put(
        MODEL_ADAPTERS_ENDPOINT,
        {
          modelProviderPriority: buildModelProviderPriority(stages),
        },
        getRequestConfig(),
      );
      const normalizedData = normalizeModelAdapterResponse(response.data);
      setData(normalizedData);
      if (IS_STANDALONE_DEPLOYMENT) {
        await refreshModelAvailabilityCaches();
      }
      return normalizedData;
    } catch (requestError) {
      setError(requestError);
      throw requestError;
    } finally {
      setIsSaving(false);
    }
  }, [enabled]);

  return {
    ...data,
    isLoading,
    isSaving,
    error,
    reload: loadPreferences,
    savePreferences,
  };
}
