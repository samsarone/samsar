import { act, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter, Route, Routes, useNavigate } from 'react-router-dom';
import VidgenieSkeletonLoader, { VidgenieSkeleton } from '../../src/components/oneshot_editor/VidgenieSkeletonLoader.jsx';
import { getSessionLoadingLayout, readSessionLoadingLayout, rememberSessionLoadingLayout } from '../../src/utils/sessionLoadingLayout.js';

afterEach(() => vi.restoreAllMocks());

describe('session-specific loading layout hints', () => {
  it('separates blank, completed and in-progress projects, including old render previews', () => {
    expect(getSessionLoadingLayout({}).variant).toBe('init');
    expect(getSessionLoadingLayout({ videoLink: '/done.mp4' }).variant).toBe('completed');
    expect(getSessionLoadingLayout({ videoLink: '/old.mp4', videoGenerationPending: true }).variant).toBe('pending');
    expect(getSessionLoadingLayout({ remoteURL: '/old.mp4', expressGenerationPaused: true }).variant).toBe('pending');
    expect(getSessionLoadingLayout(null)).toBeNull();
  });

  it('stores only layout metadata, bounded to 24 projects and expires it', () => {
    vi.spyOn(Date, 'now').mockReturnValue(1000000);
    for (let i = 0; i < 30; i++) rememberSessionLoadingLayout({ _id: String(i), videoLink: 'private-video-url', inputPrompt: 'private-prompt', aspectRatio: '9:16' });
    const stored = sessionStorage.getItem('sessionLoadingLayouts.v1');
    expect(stored).not.toMatch(/private-video-url|private-prompt/);
    expect(JSON.parse(stored)).toHaveLength(24);
    expect(readSessionLoadingLayout('0')).toBeNull();
    expect(readSessionLoadingLayout('29')).toMatchObject({ variant: 'completed', aspectRatio: '9:16' });
    Date.now.mockReturnValue(1000000 + 30 * 60 * 1000);
    expect(readSessionLoadingLayout('29')).toBeNull();
  });

  it('ignores malformed/blocked storage and never prevents rendering', () => {
    for (const stored of ['bad-json', '{}', '[null,{"id":"a","variant":"completed"}]']) {
      sessionStorage.setItem('sessionLoadingLayouts.v1', stored);
      expect(readSessionLoadingLayout('a')).toBeNull();
    }
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('blocked'); });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('blocked'); });
    expect(() => rememberSessionLoadingLayout({ _id: 'a' })).not.toThrow();
    render(<MemoryRouter initialEntries={['/vidgenie/a']}><VidgenieSkeletonLoader /></MemoryRouter>);
    expect(screen.getByRole('status')).toHaveAttribute('data-loading-layout', 'unknown');
  });

  it('uses a completed layout only for the matching route and changes it on navigation', async () => {
    rememberSessionLoadingLayout({ _id: 'completed', videoLink: '/done.mp4' });
    rememberSessionLoadingLayout({ _id: 'new' });
    let navigate;
    function Harness() { navigate = useNavigate(); return <VidgenieSkeletonLoader embedded />; }
    const { container } = render(<MemoryRouter initialEntries={['/vidgenie/completed']}><Routes><Route path="/vidgenie/:id" element={<Harness />} /></Routes></MemoryRouter>);
    expect(screen.getByRole('status')).toHaveAttribute('data-loading-layout', 'completed');
    expect(container.querySelector('[data-skeleton-request]')).toBeNull();
    expect(container.querySelector('[data-skeleton-result]')).not.toBeNull();
    await act(() => navigate('/vidgenie/new'));
    expect(screen.getByRole('status')).toHaveAttribute('data-loading-layout', 'init');
    expect(container.querySelector('[data-skeleton-prompt]')).not.toBeNull();
    expect(container.querySelector('[data-skeleton-result]')).toBeNull();
    await act(() => navigate('/vidgenie/unknown'));
    expect(screen.getByRole('status')).toHaveAttribute('data-loading-layout', 'unknown');
  });

  it.each([true, false])('checks the guest handoff identity (matching=%s)', (matches) => {
    render(<MemoryRouter initialEntries={[{ pathname: '/vidgenie/sample', state: { guestSession: { _id: matches ? 'sample' : 'different', isGuestSession: true, videoLink: '/sample.mp4', aspectRatio: '9:16' } } }]}><VidgenieSkeletonLoader /></MemoryRouter>);
    expect(screen.getByRole('status')).toHaveAttribute('data-loading-layout', matches ? 'completed' : 'unknown');
  });

  it('keeps embedded loading content inside the existing page without duplicating navigation or fixed overlays', () => {
    const { container } = render(<VidgenieSkeleton embedded variant="init" />);
    expect(container.querySelector('.fixed')).toBeNull();
    expect(container.querySelector('button, input, select, textarea, a')).toBeNull();
    expect(screen.getByRole('status', { name: 'Loading VidGenie' })).toHaveAttribute('aria-busy', 'true');
  });
});
