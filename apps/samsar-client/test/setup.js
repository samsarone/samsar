import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach, vi } from 'vitest';

// Node 25+ exposes its own storage globals; use the jsdom origin's storage.
if (globalThis.jsdom) {
  vi.stubGlobal('localStorage', globalThis.jsdom.window.localStorage);
  vi.stubGlobal('sessionStorage', globalThis.jsdom.window.sessionStorage);
  // Anchored menus observe their trigger size. jsdom has no layout engine;
  // positioning is covered separately by the Chromium browser suite.
  if (!globalThis.ResizeObserver) {
    vi.stubGlobal('ResizeObserver', class {
      observe() {}
      unobserve() {}
      disconnect() {}
    });
  }
}

afterEach(() => {
  cleanup();
  window.localStorage.clear();
  window.sessionStorage.clear();
  vi.useRealTimers();
});
