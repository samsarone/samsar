import { useEffect, useMemo, useState } from "react";

import { ASSISTANT_MODEL_TYPES, INFERENCE_MODEL_TYPES } from "../constants/Types.ts";
import { getHeaders } from "../utils/web.jsx";
import {
  extractDeploymentInferenceModelValues,
  extractDeploymentInferenceModelProviders,
  fetchDeploymentProviderConfig,
  filterHostedInferenceModelOptions,
  filterOptionsForDeploymentInferenceModels,
  labelOptionsForDeploymentInferenceProviders,
} from "../utils/deploymentProviders.js";

const PROCESSOR_API_URL = import.meta.env.VITE_PROCESSOR_API || "";
const IS_DOCKER_INSTALL = import.meta.env.VITE_DOCKER_INSTALL === "true";
const HOSTED_INFERENCE_MODEL_OPTIONS = Object.freeze(
  filterHostedInferenceModelOptions(INFERENCE_MODEL_TYPES),
);
const HOSTED_ASSISTANT_MODEL_OPTIONS = Object.freeze(
  filterHostedInferenceModelOptions(ASSISTANT_MODEL_TYPES),
);
const HOSTED_INFERENCE_MODEL_VALUES = Object.freeze(
  HOSTED_INFERENCE_MODEL_OPTIONS.map((option) => option.value),
);
const EMPTY_DOCKER_AVAILABILITY = Object.freeze({
  modelValues: [],
  modelProviders: {},
  error: null,
});
const DEFAULT_AVAILABILITY = Object.freeze({
  modelValues: HOSTED_INFERENCE_MODEL_VALUES,
  modelProviders: {},
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
          modelProviders: extractDeploymentInferenceModelProviders(payload),
          error: null,
        };
        availabilityCache.availability = availability;
        return availability;
      })
      .catch((error) => {
        const availability = {
          modelValues: [],
          modelProviders: {},
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

  const modelValues = IS_DOCKER_INSTALL
    ? availability.modelValues || []
    : HOSTED_INFERENCE_MODEL_VALUES;
  const inferenceModelOptions = useMemo(
    () => (
      IS_DOCKER_INSTALL
        ? labelOptionsForDeploymentInferenceProviders(
          filterOptionsForDeploymentInferenceModels(INFERENCE_MODEL_TYPES, modelValues),
          availability.modelProviders,
        )
        : HOSTED_INFERENCE_MODEL_OPTIONS
    ),
    [availability.modelProviders, modelValues]
  );
  const assistantModelOptions = useMemo(
    () => (
      IS_DOCKER_INSTALL
        ? labelOptionsForDeploymentInferenceProviders(
          filterOptionsForDeploymentInferenceModels(ASSISTANT_MODEL_TYPES, modelValues),
          availability.modelProviders,
        )
        : HOSTED_ASSISTANT_MODEL_OPTIONS
    ),
    [availability.modelProviders, modelValues]
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
