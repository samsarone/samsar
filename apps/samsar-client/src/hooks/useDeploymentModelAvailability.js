import { useEffect, useState } from "react";

import { getHeaders } from "../utils/web.jsx";
import {
  extractDeploymentModelAvailability,
  fetchDeploymentProviderConfig,
  hasSubtitleGenerationProvider,
} from "../utils/deploymentProviders.js";
import { IS_STANDALONE_DEPLOYMENT } from "../utils/environment.jsx";
import { subscribeToModelAvailabilityRefresh } from "../utils/modelAvailabilityRefresh.mjs";

const PROCESSOR_API_URL = import.meta.env.VITE_PROCESSOR_API || "";

const EMPTY_AVAILABILITY = Object.freeze({
  textToVideoImageModelValues: [],
  textToVideoVideoModelValues: [],
  imageListToVideoImageModelValues: [],
  imageListToVideoVideoModelValues: [],
  imageModelValues: [],
  imageEditModelValues: [],
  videoModelValues: [],
  primaryAdapterByModel: {},
  hasSubtitleGenerationCredentials: false,
  error: null,
});

const availabilityCache = {
  availability: null,
  promise: null,
  revision: 0,
};

async function loadDeploymentModelAvailability() {
  if (!IS_STANDALONE_DEPLOYMENT) {
    return EMPTY_AVAILABILITY;
  }

  if (availabilityCache.availability) {
    return availabilityCache.availability;
  }

  if (!availabilityCache.promise) {
    const revision = availabilityCache.revision;
    const request = fetchDeploymentProviderConfig(PROCESSOR_API_URL, getHeaders())
      .then((payload) => {
        const availability = {
          ...extractDeploymentModelAvailability(payload),
          hasSubtitleGenerationCredentials: hasSubtitleGenerationProvider(payload),
          error: null,
        };
        if (availabilityCache.revision === revision) {
          availabilityCache.availability = availability;
        }
        return availability;
      })
      .catch((error) => {
        const availability = {
          ...EMPTY_AVAILABILITY,
          error,
        };
        if (availabilityCache.revision === revision) {
          availabilityCache.availability = availability;
        }
        return availability;
      })
      .finally(() => {
        if (availabilityCache.promise === request) {
          availabilityCache.promise = null;
        }
      });
    availabilityCache.promise = request;
  }

  return availabilityCache.promise;
}

function refreshDeploymentModelAvailability() {
  availabilityCache.revision += 1;
  availabilityCache.availability = null;
  availabilityCache.promise = null;
  return loadDeploymentModelAvailability();
}

if (IS_STANDALONE_DEPLOYMENT) {
  subscribeToModelAvailabilityRefresh(refreshDeploymentModelAvailability);
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
    let requestRevision = 0;

    const updateAvailability = () => {
      const currentRequestRevision = ++requestRevision;
      setIsLoading(IS_STANDALONE_DEPLOYMENT && !availabilityCache.availability);
      return loadDeploymentModelAvailability()
        .then((nextAvailability) => {
          if (isMounted && requestRevision === currentRequestRevision) {
            setAvailability(nextAvailability || EMPTY_AVAILABILITY);
          }
        })
        .finally(() => {
          if (isMounted && requestRevision === currentRequestRevision) {
            setIsLoading(false);
          }
        });
    };

    const unsubscribe = IS_STANDALONE_DEPLOYMENT
      ? subscribeToModelAvailabilityRefresh(updateAvailability)
      : () => {};
    updateAvailability();

    return () => {
      isMounted = false;
      unsubscribe();
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
