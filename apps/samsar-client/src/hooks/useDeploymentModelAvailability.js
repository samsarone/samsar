import { useEffect, useState } from "react";

import { getHeaders } from "../utils/web.jsx";
import {
  extractDeploymentModelAvailability,
  fetchDeploymentProviderConfig,
  hasSubtitleGenerationProvider,
} from "../utils/deploymentProviders.js";

const PROCESSOR_API_URL = import.meta.env.VITE_PROCESSOR_API || "";
const IS_DOCKER_INSTALL = import.meta.env.VITE_DOCKER_INSTALL === "true";

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
  if (!IS_DOCKER_INSTALL) {
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
    IS_DOCKER_INSTALL
      ? availabilityCache.availability || EMPTY_AVAILABILITY
      : EMPTY_AVAILABILITY
  );
  const [isLoading, setIsLoading] = useState(IS_DOCKER_INSTALL && !availabilityCache.availability);

  useEffect(() => {
    let isMounted = true;

    setIsLoading(IS_DOCKER_INSTALL && !availabilityCache.availability);
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
    isDockerInstall: IS_DOCKER_INSTALL,
    isLoading,
    ...availability,
    hasSubtitleGenerationCredentials: !IS_DOCKER_INSTALL ||
      availability.hasSubtitleGenerationCredentials === true,
  };
}
