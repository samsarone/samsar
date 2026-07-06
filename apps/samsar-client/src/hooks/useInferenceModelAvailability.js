import { useEffect, useMemo, useState } from "react";

import { ASSISTANT_MODEL_TYPES, INFERENCE_MODEL_TYPES } from "../constants/Types.ts";
import { getHeaders } from "../utils/web.jsx";
import {
  extractDeploymentInferenceModelValues,
  fetchDeploymentProviderConfig,
  filterOptionsForDeploymentInferenceModels,
} from "../utils/deploymentProviders.js";

const PROCESSOR_API_URL = import.meta.env.VITE_PROCESSOR_API || "";
const IS_DOCKER_INSTALL = import.meta.env.VITE_DOCKER_INSTALL === "true";
const ALL_INFERENCE_MODEL_VALUES = Object.freeze(INFERENCE_MODEL_TYPES.map((option) => option.value));
const EMPTY_DOCKER_AVAILABILITY = Object.freeze({
  modelValues: [],
  error: null,
});
const DEFAULT_AVAILABILITY = Object.freeze({
  modelValues: ALL_INFERENCE_MODEL_VALUES,
  error: null,
});

const availabilityCache = {
  availability: null,
  promise: null,
};

async function loadInferenceModelAvailability() {
  if (!IS_DOCKER_INSTALL) {
    return DEFAULT_AVAILABILITY;
  }

  if (availabilityCache.availability) {
    return availabilityCache.availability;
  }

  if (!availabilityCache.promise) {
    availabilityCache.promise = fetchDeploymentProviderConfig(PROCESSOR_API_URL, getHeaders())
      .then((payload) => {
        const availability = {
          modelValues: extractDeploymentInferenceModelValues(payload),
          error: null,
        };
        availabilityCache.availability = availability;
        return availability;
      })
      .catch((error) => {
        const availability = {
          modelValues: [],
          error,
        };
        availabilityCache.availability = availability;
        return availability;
      })
      .finally(() => {
        availabilityCache.promise = null;
      });
  }

  return availabilityCache.promise;
}

export function useInferenceModelAvailability() {
  const [availability, setAvailability] = useState(
    IS_DOCKER_INSTALL
      ? availabilityCache.availability || EMPTY_DOCKER_AVAILABILITY
      : DEFAULT_AVAILABILITY
  );
  const [isLoading, setIsLoading] = useState(IS_DOCKER_INSTALL && !availabilityCache.availability);

  useEffect(() => {
    let isMounted = true;

    setIsLoading(IS_DOCKER_INSTALL && !availabilityCache.availability);
    loadInferenceModelAvailability()
      .then((nextAvailability) => {
        if (isMounted) {
          setAvailability(nextAvailability || EMPTY_DOCKER_AVAILABILITY);
        }
      })
      .finally(() => {
        if (isMounted) {
          setIsLoading(false);
        }
      });

    return () => {
      isMounted = false;
    };
  }, []);

  const modelValues = IS_DOCKER_INSTALL ? availability.modelValues || [] : ALL_INFERENCE_MODEL_VALUES;
  const inferenceModelOptions = useMemo(
    () => (
      IS_DOCKER_INSTALL
        ? filterOptionsForDeploymentInferenceModels(INFERENCE_MODEL_TYPES, modelValues)
        : INFERENCE_MODEL_TYPES
    ),
    [modelValues]
  );
  const assistantModelOptions = useMemo(
    () => (
      IS_DOCKER_INSTALL
        ? filterOptionsForDeploymentInferenceModels(ASSISTANT_MODEL_TYPES, modelValues)
        : ASSISTANT_MODEL_TYPES
    ),
    [modelValues]
  );

  return {
    isDockerInstall: IS_DOCKER_INSTALL,
    isLoading,
    error: availability.error || null,
    modelValues,
    inferenceModelOptions,
    assistantModelOptions,
    hasConfiguredInferenceModels: !IS_DOCKER_INSTALL || modelValues.length > 0,
  };
}
