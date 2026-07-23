import { useEffect, useState } from "react";

import { getHeaders } from "../utils/web.jsx";
import {
  extractDeploymentModelAvailability,
  fetchDeploymentProviderConfig,
  hasSubtitleGenerationProvider,
} from "../utils/deploymentProviders.js";
import { IS_STANDALONE_DEPLOYMENT } from "../utils/environment.jsx";

const PROCESSOR_API_URL = import.meta.env.VITE_PROCESSOR_API || "";

const EMPTY_AVAILABILITY = Object.freeze({
  textToVideoImageModelValues: [],
  textToVideoVideoModelValues: [],
  imageListToVideoImageModelValues: [],
  imageListToVideoVideoModelValues: [],
  imageModelValues: [],
  imageEditModelValues: [],
  videoModelValues: [],
  hasSubtitleGenerationCredentials: false,
  error: null,
});

const availabilityCache = {
  availability: null,
  promise: null,
};

async function loadDeploymentModelAvailability() {
  if (!IS_STANDALONE_DEPLOYMENT) {
    return EMPTY_AVAILABILITY;
  }

  if (availabilityCache.availability) {
    return availabilityCache.availability;
  }

  if (!availabilityCache.promise) {
    availabilityCache.promise = fetchDeploymentProviderConfig(PROCESSOR_API_URL, getHeaders())
      .then((payload) => {
        const availability = {
          ...extractDeploymentModelAvailability(payload),
          hasSubtitleGenerationCredentials: hasSubtitleGenerationProvider(payload),
          error: null,
        };
        availabilityCache.availability = availability;
        return availability;
      })
      .catch((error) => {
        const availability = {
          ...EMPTY_AVAILABILITY,
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

export function useDeploymentModelAvailability() {
  const [availability, setAvailability] = useState(
    IS_STANDALONE_DEPLOYMENT
      ? availabilityCache.availability || EMPTY_AVAILABILITY
      : EMPTY_AVAILABILITY
  );
  const [isLoading, setIsLoading] = useState(IS_STANDALONE_DEPLOYMENT && !availabilityCache.availability);

  useEffect(() => {
    let isMounted = true;

    setIsLoading(IS_STANDALONE_DEPLOYMENT && !availabilityCache.availability);
    loadDeploymentModelAvailability()
      .then((nextAvailability) => {
        if (isMounted) {
          setAvailability(nextAvailability || EMPTY_AVAILABILITY);
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

  return {
    isStandaloneDeployment: IS_STANDALONE_DEPLOYMENT,
    isLoading,
    ...availability,
    hasSubtitleGenerationCredentials: !IS_STANDALONE_DEPLOYMENT ||
      availability.hasSubtitleGenerationCredentials === true,
  };
}
