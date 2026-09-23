import { act, renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import useUndoRedoState from '../../src/hooks/useUndoRedoState.js';

describe('canvas history', () => {
  it('restores edits and clears redo after editing an earlier state', () => {
    const { result } = renderHook(() => useUndoRedoState([{ text: 'original' }]));
    act(() => result.current.setState([{ text: 'edited' }]));
    act(() => result.current.undo());
    expect(result.current.state).toEqual([{ text: 'original' }]);
    expect(result.current.canRedo).toBe(true);
    act(() => result.current.redo());
    expect(result.current.state).toEqual([{ text: 'edited' }]);
    act(() => result.current.undo());
    act(() => result.current.setState([{ text: 'new branch' }]));
    expect(result.current.canRedo).toBe(false);
    act(() => result.current.redo());
    expect(result.current.state).toEqual([{ text: 'new branch' }]);
  });

  it('does not create an undo entry for an unchanged save', () => {
    const { result } = renderHook(() => useUndoRedoState([{ id: 'a' }]));
    act(() => result.current.setState([{ id: 'a' }]));
    expect(result.current.canUndo).toBe(false);
  });

  it('isolates saved history from later mutations to the submitted items', () => {
    const { result } = renderHook(() => useUndoRedoState([]));
    const items = [{ style: { color: 'red' } }];
    act(() => result.current.setState(items));
    items[0].style.color = 'blue';
    expect(result.current.state[0].style.color).toBe('red');
    act(() => result.current.setState((current) => {
      current[0].style.color = 'green';
      return current;
    }));
    act(() => result.current.undo());
    expect(result.current.state[0].style.color).toBe('red');
  });

  it('limits retained history and safely handles undo at the boundary', () => {
    const { result } = renderHook(() => useUndoRedoState([0], { limit: 2 }));
    for (const value of [1, 2, 3]) act(() => result.current.setState([value]));
    expect(result.current.undoCount).toBe(2);
    for (let i = 0; i < 3; i++) act(() => result.current.undo());
    expect(result.current.state).toEqual([1]);
    expect(result.current.canUndo).toBe(false);
  });

  it('resets history when a different scene is loaded', () => {
    const { result } = renderHook(() => useUndoRedoState(['scene-a']));
    act(() => result.current.setState(['edited-a']));
    act(() => result.current.undo());
    act(() => result.current.syncState(['scene-b'], { resetHistory: true }));
    expect(result.current.state).toEqual(['scene-b']);
    expect(result.current.canUndo).toBe(false);
    expect(result.current.canRedo).toBe(false);
  });

  it('refreshes the current scene without adding a user edit', () => {
    const { result } = renderHook(() => useUndoRedoState(['initial']));
    act(() => result.current.setState(['edited']));
    act(() => result.current.syncState(['server-refresh']));
    expect(result.current.undoCount).toBe(1);
    act(() => result.current.undo());
    expect(result.current.state).toEqual(['initial']);
  });
});
