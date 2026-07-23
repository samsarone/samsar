import { useEffect, useState } from "react";

import { getHeaders } from "../utils/web.jsx";
import { fetchDeploymentProviderConfig } from "../utils/deploymentProviders.js";
import {
  DEFAULT_AUDIO_AVAILABILITY,
  extractAudioAvailability,
} from "../constants/audioProviderAvailability.js";
import { IS_STANDALONE_DEPLOYMENT } from "../utils/environment.jsx";

const PROCESSOR_API_URL = import.meta.env.VITE_PROCESSOR_API || "";

const availabilityCache = {
  audioAvailability: null,
  promise: null,
};

async function loadAudioAvailability() {
  if (!IS_STANDALONE_DEPLOYMENT) {
    return DEFAULT_AUDIO_AVAILABILITY;
  }

  if (availabilityCache.audioAvailability) {
    return availabilityCache.audioAvailability;
  }

  if (!availabilityCache.promise) {
    availabilityCache.promise = fetchDeploymentProviderConfig(PROCESSOR_API_URL, getHeaders())
      .then((payload) => {
        const audioAvailability = extractAudioAvailability(payload);
        availabilityCache.audioAvailability = audioAvailability;
        return audioAvailability;
      })
      .catch(() => DEFAULT_AUDIO_AVAILABILITY)
      .finally(() => {
        availabilityCache.promise = null;
      });
  }

  return availabilityCache.promise;
}

export function useAudioProviderAvailability() {
  const [audioAvailability, setAudioAvailability] = useState(
    availabilityCache.audioAvailability || DEFAULT_AUDIO_AVAILABILITY
  );
  const [isLoading, setIsLoading] = useState(IS_STANDALONE_DEPLOYMENT && !availabilityCache.audioAvailability);

  useEffect(() => {
    let isMounted = true;

    setIsLoading(IS_STANDALONE_DEPLOYMENT && !availabilityCache.audioAvailability);
    loadAudioAvailability()
      .then((availability) => {
        if (isMounted) {
          setAudioAvailability(availability || DEFAULT_AUDIO_AVAILABILITY);
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
    audioAvailability,
    isLoading,
  };
}
