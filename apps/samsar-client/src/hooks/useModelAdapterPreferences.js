import { translateText as uiText } from "../utils/localization.js";
import { useCallback, useEffect, useRef, useState } from "react";
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
  const mountedRef = useRef(true);
  const loadRevisionRef = useRef(0);
  const saveRevisionRef = useRef(0);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      loadRevisionRef.current += 1;
      saveRevisionRef.current += 1;
    };
  }, []);

  const loadPreferences = useCallback(async ({ signal } = {}) => {
    const revision = ++loadRevisionRef.current;
    const isCurrentRequest = () => mountedRef.current &&
      loadRevisionRef.current === revision && !signal?.aborted;
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
      if (isCurrentRequest()) setData(normalizedData);
      return normalizedData;
    } catch (requestError) {
      if (isCurrentRequest() && !isCancelledRequest(requestError)) {
        setError(requestError);
      }
      throw requestError;
    } finally {
      if (isCurrentRequest()) {
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
      loadRevisionRef.current += 1;
      saveRevisionRef.current += 1;
      controller.abort();
    };
  }, [enabled, loadPreferences]);

  const savePreferences = useCallback(async (stages) => {
    if (!enabled) {
      throw new Error(uiText("Model adapter settings are unavailable."));
    }

    const revision = ++saveRevisionRef.current;
    const isCurrentRequest = () => mountedRef.current && saveRevisionRef.current === revision;
    // A read started before this save must not restore the previous preferences.
    loadRevisionRef.current += 1;
    setIsLoading(false);
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
      if (isCurrentRequest()) setData(normalizedData);
      if (isCurrentRequest() && IS_STANDALONE_DEPLOYMENT) {
        await refreshModelAvailabilityCaches();
      }
      return normalizedData;
    } catch (requestError) {
      if (isCurrentRequest()) setError(requestError);
      throw requestError;
    } finally {
      if (isCurrentRequest()) setIsSaving(false);
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
