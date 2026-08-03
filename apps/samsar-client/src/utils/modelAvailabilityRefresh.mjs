const refreshListeners = new Set();

export function subscribeToModelAvailabilityRefresh(listener) {
  if (typeof listener !== "function") {
    return () => {};
  }

  refreshListeners.add(listener);
  return () => {
    refreshListeners.delete(listener);
  };
}

export async function refreshModelAvailabilityCaches() {
  const refreshes = Array.from(refreshListeners, (listener) => {
    try {
      return listener();
    } catch (error) {
      return Promise.reject(error);
    }
  });

  await Promise.allSettled(refreshes);
}
