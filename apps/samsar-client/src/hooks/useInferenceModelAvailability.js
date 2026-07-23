import { useEffect, useMemo, useState } from "react";

import { ASSISTANT_MODEL_TYPES, INFERENCE_MODEL_TYPES } from "../constants/Types.ts";
import { getHeaders } from "../utils/web.jsx";
import {
  extractDeploymentProviderEndpointTypes,
  extractDeploymentInferenceModelValues,
  extractDeploymentInferenceModelProviders,
  fetchDeploymentProviderConfig,
  filterHostedInferenceModelOptions,
  filterOptionsForDeploymentInferenceModels,
  labelOptionsForDeploymentInferenceProviders,
} from "../utils/deploymentProviders.js";
import { IS_STANDALONE_DEPLOYMENT } from "../utils/environment.jsx";

const PROCESSOR_API_URL = import.meta.env.VITE_PROCESSOR_API || "";
const HOSTED_INFERENCE_MODEL_OPTIONS = Object.freeze(
  filterHostedInferenceModelOptions(INFERENCE_MODEL_TYPES),
);
const HOSTED_ASSISTANT_MODEL_OPTIONS = Object.freeze(
  filterHostedInferenceModelOptions(ASSISTANT_MODEL_TYPES),
);
const HOSTED_INFERENCE_MODEL_VALUES = Object.freeze(
  HOSTED_INFERENCE_MODEL_OPTIONS.map((option) => option.value),
);
const EMPTY_STANDALONE_AVAILABILITY = Object.freeze({
  modelValues: [],
  modelProviders: {},
  providerEndpointTypes: {},
  error: null,
});
const DEFAULT_AVAILABILITY = Object.freeze({
  modelValues: HOSTED_INFERENCE_MODEL_VALUES,
  modelProviders: {},
  providerEndpointTypes: {},
  error: null,
});

const availabilityCache = {
  availability: null,
  promise: null,
};

async function loadInferenceModelAvailability() {
  if (!IS_STANDALONE_DEPLOYMENT) {
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
          providerEndpointTypes: extractDeploymentProviderEndpointTypes(payload),
          error: null,
        };
        availabilityCache.availability = availability;
        return availability;
      })
      .catch((error) => {
        const availability = {
          modelValues: [],
          modelProviders: {},
          providerEndpointTypes: {},
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
    IS_STANDALONE_DEPLOYMENT
      ? availabilityCache.availability || EMPTY_STANDALONE_AVAILABILITY
      : DEFAULT_AVAILABILITY
  );
  const [isLoading, setIsLoading] = useState(IS_STANDALONE_DEPLOYMENT && !availabilityCache.availability);

  useEffect(() => {
    let isMounted = true;

    setIsLoading(IS_STANDALONE_DEPLOYMENT && !availabilityCache.availability);
    loadInferenceModelAvailability()
      .then((nextAvailability) => {
        if (isMounted) {
          setAvailability(nextAvailability || EMPTY_STANDALONE_AVAILABILITY);
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

  const modelValues = IS_STANDALONE_DEPLOYMENT
    ? availability.modelValues || []
    : HOSTED_INFERENCE_MODEL_VALUES;
  const inferenceModelOptions = useMemo(
    () => (
      IS_STANDALONE_DEPLOYMENT
        ? labelOptionsForDeploymentInferenceProviders(
          filterOptionsForDeploymentInferenceModels(INFERENCE_MODEL_TYPES, modelValues),
          availability.modelProviders,
          availability.providerEndpointTypes,
        )
        : HOSTED_INFERENCE_MODEL_OPTIONS
    ),
    [availability.modelProviders, availability.providerEndpointTypes, modelValues]
  );
  const assistantModelOptions = useMemo(
    () => (
      IS_STANDALONE_DEPLOYMENT
        ? labelOptionsForDeploymentInferenceProviders(
          filterOptionsForDeploymentInferenceModels(ASSISTANT_MODEL_TYPES, modelValues),
          availability.modelProviders,
          availability.providerEndpointTypes,
        )
        : HOSTED_ASSISTANT_MODEL_OPTIONS
    ),
    [availability.modelProviders, availability.providerEndpointTypes, modelValues]
  );

  return {
    isStandaloneDeployment: IS_STANDALONE_DEPLOYMENT,
    isLoading,
    error: availability.error || null,
    modelValues,
    inferenceModelOptions,
    assistantModelOptions,
    hasConfiguredInferenceModels: !IS_STANDALONE_DEPLOYMENT || modelValues.length > 0,
  };
}
