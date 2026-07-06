import { useCallback, useRef, useState } from 'react';

function normalizeStateValue(value) {
  return Array.isArray(value) ? value : [];
}

function cloneStateValue(value) {
  const normalizedValue = normalizeStateValue(value);

  if (typeof structuredClone === 'function') {
    return structuredClone(normalizedValue);
  }

  return JSON.parse(JSON.stringify(normalizedValue));
}

function createStateSignature(value) {
  return JSON.stringify(normalizeStateValue(value));
}

function buildHistoryState(present) {
  const clonedPresent = cloneStateValue(present);

  return {
    past: [],
    present: clonedPresent,
    future: [],
    presentSignature: createStateSignature(clonedPresent),
  };
}

export default function useUndoRedoState(initialState = [], options = {}) {
  const historyLimit = Number.isFinite(options?.limit)
    ? Math.max(1, Math.floor(options.limit))
    : 5;

  const historyRef = useRef(buildHistoryState(initialState));
  const [historyState, setHistoryState] = useState(historyRef.current);

  const updateHistoryState = useCallback((updater) => {
    const nextHistoryState = updater(historyRef.current);
    historyRef.current = nextHistoryState;
    setHistoryState(nextHistoryState);
    return nextHistoryState;
  }, []);

  const commitState = useCallback(
    (nextStateOrUpdater) => {
      const nextHistoryState = updateHistoryState((previousHistoryState) => {
        const previousPresent = cloneStateValue(previousHistoryState.present);
        const resolvedNextState =
          typeof nextStateOrUpdater === 'function'
            ? nextStateOrUpdater(previousPresent)
            : nextStateOrUpdater;
        const normalizedNextState = cloneStateValue(resolvedNextState);
        const nextSignature = createStateSignature(normalizedNextState);

        if (nextSignature === previousHistoryState.presentSignature) {
          return previousHistoryState;
        }

        return {
          past: [
            ...previousHistoryState.past,
            cloneStateValue(previousHistoryState.present),
          ].slice(-historyLimit),
          present: normalizedNextState,
          future: [],
          presentSignature: nextSignature,
        };
      });

      return nextHistoryState.present;
    },
    [historyLimit, updateHistoryState]
  );

  const syncState = useCallback(
    (nextStateOrUpdater, syncOptions = {}) => {
      const shouldResetHistory = Boolean(syncOptions?.resetHistory);
      const nextHistoryState = updateHistoryState((previousHistoryState) => {
        const previousPresent = cloneStateValue(previousHistoryState.present);
        const resolvedNextState =
          typeof nextStateOrUpdater === 'function'
            ? nextStateOrUpdater(previousPresent)
            : nextStateOrUpdater;
        const normalizedNextState = cloneStateValue(resolvedNextState);
        const nextSignature = createStateSignature(normalizedNextState);

        if (
          !shouldResetHistory &&
          nextSignature === previousHistoryState.presentSignature
        ) {
          return previousHistoryState;
        }

        return {
          past: shouldResetHistory ? [] : previousHistoryState.past,
          present: normalizedNextState,
          future: shouldResetHistory ? [] : previousHistoryState.future,
          presentSignature: nextSignature,
        };
      });

      return nextHistoryState.present;
    },
    [updateHistoryState]
  );

  const undo = useCallback(() => {
    const nextHistoryState = updateHistoryState((previousHistoryState) => {
      if (!previousHistoryState.past.length) {
        return previousHistoryState;
      }

      const nextPresent = cloneStateValue(
        previousHistoryState.past[previousHistoryState.past.length - 1]
      );

      return {
        past: previousHistoryState.past.slice(0, -1),
        present: nextPresent,
        future: [
          cloneStateValue(previousHistoryState.present),
          ...previousHistoryState.future,
        ].slice(0, historyLimit),
        presentSignature: createStateSignature(nextPresent),
      };
    });

    return nextHistoryState.present;
  }, [historyLimit, updateHistoryState]);

  const redo = useCallback(() => {
    const nextHistoryState = updateHistoryState((previousHistoryState) => {
      if (!previousHistoryState.future.length) {
        return previousHistoryState;
      }

      const nextPresent = cloneStateValue(previousHistoryState.future[0]);

      return {
        past: [
          ...previousHistoryState.past,
          cloneStateValue(previousHistoryState.present),
        ].slice(-historyLimit),
        present: nextPresent,
        future: previousHistoryState.future.slice(1),
        presentSignature: createStateSignature(nextPresent),
      };
    });

    return nextHistoryState.present;
  }, [historyLimit, updateHistoryState]);

  return {
    state: historyState.present,
    setState: commitState,
    syncState,
    undo,
    redo,
    canUndo: historyState.past.length > 0,
    canRedo: historyState.future.length > 0,
    undoCount: historyState.past.length,
    redoCount: historyState.future.length,
    historyLimit,
  };
}
