import { useContext } from 'react';
import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ColorModeProvider, useColorMode } from '../../src/contexts/ColorMode.jsx';
import { AlertDialogProvider, useAlertDialog } from '../../src/contexts/AlertDialogContext.jsx';
import { NavCanvasControlContext, NavCanvasControlProvider } from '../../src/contexts/NavCanvasControlContext.jsx';
import { LocalizationProvider, useLocalization } from '../../src/contexts/LocalizationContext.jsx';

const session = vi.hoisted(() => ({ user: null }));
vi.mock('../../src/contexts/UserContext.jsx', () => ({ useUser: () => session }));

beforeEach(() => { session.user = null; });
afterEach(() => {
  document.head.querySelector('meta[name="theme-color"]')?.remove();
  document.body.className = '';
  document.documentElement.className = '';
  document.documentElement.removeAttribute('lang');
  document.documentElement.removeAttribute('dir');
});

describe('persisted color mode', () => {
  it('initializes an empty profile to dark and updates the actual document theme', () => {
    const meta = document.createElement('meta');
    meta.name = 'theme-color';
    document.head.append(meta);
    const { result } = renderHook(useColorMode, { wrapper: ColorModeProvider });
    expect(result.current.colorMode).toBe('dark');
    expect(localStorage.getItem('colorMode')).toBe('dark');
    expect(document.documentElement).toHaveClass('dark');
    expect(document.body).toHaveClass('theme-dark');
    expect(meta.content).toBe('#0c0d12');
    act(() => result.current.toggleColorMode());
    expect(localStorage.getItem('colorMode')).toBe('light');
    expect(document.body).toHaveClass('theme-light');
    expect(document.body).not.toHaveClass('theme-dark');
    expect(document.documentElement).not.toHaveClass('dark');
    expect(document.documentElement.style.colorScheme).toBe('light');
    expect(meta.content).toBe('#d9e2f0');
    act(() => result.current.toggleColorMode());
    expect(result.current.colorMode).toBe('dark');
  });

  it.each(['light', 'unknown'])('loads %s and responds to another tab changing the theme', (saved) => {
    localStorage.setItem('colorMode', saved);
    const { result, unmount } = renderHook(useColorMode, { wrapper: ColorModeProvider });
    expect(result.current.colorMode).toBe(saved === 'light' ? 'light' : 'dark');
    localStorage.setItem('colorMode', 'light');
    act(() => window.dispatchEvent(new StorageEvent('storage', { key: 'colorMode' })));
    expect(result.current.colorMode).toBe('light');
    const remove = vi.spyOn(window, 'removeEventListener');
    unmount();
    expect(remove).toHaveBeenCalledWith('storage', expect.any(Function));
  });

  it('keeps theme controls usable when private browsing rejects storage', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('denied'); });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('denied'); });
    const { result } = renderHook(useColorMode, { wrapper: ColorModeProvider });
    expect(result.current.colorMode).toBe('dark');
    act(() => result.current.toggleColorMode());
    expect(result.current.colorMode).toBe('light');
    expect(document.documentElement.style.colorScheme).toBe('light');
  });
});

describe('alert dialog state', () => {
  it('opens content, applies large-dialog options, and clears visible state on close', () => {
    const { result } = renderHook(useAlertDialog, { wrapper: AlertDialogProvider });
    act(() => result.current.openAlertDialog('Confirm delete', null, true, { hideCloseButton: true }));
    expect(result.current).toMatchObject({ isAlertDialogOpen: true, alertDialogContent: 'Confirm delete', useXL: true, dialogOptions: { hideCloseButton: true } });
    act(() => result.current.setIsAlertActionPending(true));
    expect(result.current.isAlertActionPending).toBe(true);
    act(() => result.current.closeAlertDialog());
    expect(result.current).toMatchObject({ isAlertDialogOpen: false, alertDialogContent: null, useXL: false });
    act(() => result.current.openAlertDialog('Second', null, false, null));
    expect(result.current.dialogOptions).toEqual({});
    act(() => result.current.setAlertComponentHTML(<strong>Updated</strong>));
    expect(result.current.isAlertDialogOpen).toBe(true);
  });

  it('does not submit a destructive action merely by opening its confirmation dialog', () => {
    const submit = vi.fn();
    const { result } = renderHook(useAlertDialog, { wrapper: AlertDialogProvider });
    act(() => result.current.openAlertDialog('Delete project?', submit));
    expect(submit).not.toHaveBeenCalled();
  });
});

describe('canvas navigation context', () => {
  it('clears grid snapping whenever the navigation grid is hidden', () => {
    const { result } = renderHook(() => useContext(NavCanvasControlContext), { wrapper: NavCanvasControlProvider });
    act(() => result.current.setSnapEraserToGrid(true));
    expect(result.current.snapEraserToGrid).toBe(false);
    act(() => result.current.toggleShowCanvasNavigationGrid());
    act(() => result.current.setSnapEraserToGrid(true));
    expect(result.current.snapEraserToGrid).toBe(true);
    act(() => result.current.toggleShowCanvasNavigationGrid());
    expect(result.current.snapEraserToGrid).toBe(false);
    act(() => result.current.toggleShowGridOverlay());
    act(() => result.current.toggleIsVideoPreviewPlaying());
    expect(result.current.showGridOverlay).toBe(true);
    expect(result.current.isVideoPreviewPlaying).toBe(true);
  });

  it('stores callable editor actions without executing them during registration', () => {
    const { result } = renderHook(() => useContext(NavCanvasControlContext), { wrapper: NavCanvasControlProvider });
    const action = vi.fn();
    for (const key of ['downloadCurrentFrame', 'toggleStageZoom', 'zoomCanvasIn', 'zoomCanvasOut', 'resetCanvasZoom', 'requestRegenerateSubtitles', 'requestRegenerateAnimations', 'requestRealignLayers', 'requestRealignToAiVideoAndLayers']) {
      act(() => result.current[`set${key[0].toUpperCase()}${key.slice(1)}`](() => action));
      expect(action).not.toHaveBeenCalled();
      expect(result.current[key]).toBe(action);
    }
    act(() => result.current.setSessionId('scene-session'));
    act(() => result.current.setCanvasActualDimensions({ width: 1920, height: 1080 }));
    act(() => result.current.setCanvasNavigationGridGranularity(6));
    expect(result.current).toMatchObject({ sessionId: 'scene-session', canvasActualDimensions: { width: 1920, height: 1080 }, canvasNavigationGridGranularity: 6 });
  });
});

describe('localized editor strings', () => {
  it('persists a supported selection and interpolates values without dropping zero', () => {
    const { result } = renderHook(useLocalization, { wrapper: LocalizationProvider });
    expect(result.current.t('common.daysUntilUpdate', { count: 0 })).toBe('0 days until update');
    expect(result.current.t('common.daysUntilUpdate')).toBe('{count} days until update');
    act(() => result.current.setLanguage('th'));
    expect(result.current.language).toBe('th');
    expect(document.documentElement.lang).toBe('th');
    expect(document.documentElement.dir).toBe('ltr');
    expect(localStorage.getItem('preferredLanguage')).toBe('th');
    expect(result.current.t('absent.translation', { name: 'Roy' }, 'Hello {name}')).toBe('Hello Roy');
    expect(result.current.t('absent.translation')).toBe('absent.translation');
  });

  it('uses the signed-in user preference ahead of the saved browser preference', () => {
    localStorage.setItem('preferredLanguage', 'th');
    session.user = { preferredLanguage: 'en' };
    const { result, rerender } = renderHook(useLocalization, { wrapper: LocalizationProvider });
    expect(result.current.language).toBe('en');
    session.user = { preferredLanguage: 'ja' };
    rerender();
    expect(result.current.language).toBe('ja');
    act(() => result.current.setLanguage('not-supported'));
    expect(result.current.language).toBe('en');
    expect(result.current.t('common.login')).toBe('Login');
  });

  it('falls back to English for an invalid saved language and incomplete dictionaries', () => {
    localStorage.setItem('preferredLanguage', 'invalid');
    const { result } = renderHook(useLocalization, { wrapper: LocalizationProvider });
    expect(result.current.language).toBe('en');
    act(() => result.current.setLanguage('la'));
    expect(result.current.t('common.auth.ageConfirmation')).toBeTruthy();
    expect(result.current.t('missing.deep.path')).toBe('missing.deep.path');
    act(() => result.current.setLanguage(null));
    expect(result.current.language).toBe('en');
  });
});
