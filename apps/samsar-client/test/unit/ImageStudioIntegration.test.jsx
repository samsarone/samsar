import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import axios from 'axios';
import { toast } from 'react-toastify';
import ImageStudioHome from '../../src/components/image/ImageStudioHome.jsx';
import { ColorModeProvider } from '../../src/contexts/ColorMode.jsx';
import { NavCanvasControlProvider } from '../../src/contexts/NavCanvasControlContext.jsx';
import { AlertDialogProvider } from '../../src/contexts/AlertDialogContext.jsx';
import { LocalizationProvider } from '../../src/contexts/LocalizationContext.jsx';
import { getHeaders } from '../../src/utils/web.jsx';

const boundary = vi.hoisted(() => ({
  canvas: null,
  stage: null,
  user: { _id: 'user-1', generationCredits: 1000, isPremiumUser: true, preferredLanguage: 'en' },
  getUserAPI: vi.fn(),
}));
vi.mock('axios', () => ({ default: { get: vi.fn(), post: vi.fn() } }));
vi.mock('../../src/contexts/UserContext.jsx', () => ({
  useUser: () => ({ user: boundary.user, getUserAPI: boundary.getUserAPI, setUser: vi.fn(), resetUser: vi.fn() }),
}));
vi.mock('../../src/utils/web.jsx', async (importOriginal) => ({ ...await importOriginal(), getHeaders: vi.fn() }));
// Konva depends on a native canvas implementation. Retain the real studio,
// toolbar, dialogs, history, assistant and routing; expose only its canvas port.
vi.mock('../../src/components/video/editor/VideoCanvasContainer.jsx', async () => {
  const { forwardRef, useImperativeHandle } = await import('react');
  return { default: forwardRef((props, ref) => {
    boundary.canvas = props;
    useImperativeHandle(ref, () => ({ getStage: () => boundary.stage }));
    return <section aria-label='Studio canvas'><output data-testid='canvas-items'>{JSON.stringify(props.activeItemList)}</output></section>;
  }) };
});

function project(overrides = {}) {
  return {
    _id: 'image-project', aspectRatio: '1:1', canvasDimensions: { width: 1024, height: 1024 },
    generations: ['/images/existing.png'], sessionMessages: [],
    layers: [{ _id: 'layer-1', imageSession: { generationStatus: 'COMPLETED', activeItemList: [
      { id: 'image-a', type: 'image', src: '/images/existing.png', width: 1024, height: 1024, x: 0, y: 0 },
    ] } }],
    ...overrides,
  };
}

function requests(endpoint) {
  return axios.post.mock.calls.filter(([url]) => url.endsWith(endpoint));
}

function fakeDecodedImage({ fail = false, width = 800, height = 400 } = {}) {
  vi.stubGlobal('Image', class {
    width = width;
    height = height;
    set src(value) {
      this.source = value;
      queueMicrotask(() => fail ? this.onerror?.(new Error('decode failed')) : this.onload?.());
    }
    get src() { return this.source; }
  });
}

let loadedProject;
const BrowserImage = globalThis.Image;
afterEach(() => { vi.stubGlobal('Image', BrowserImage); });
beforeEach(() => {
  boundary.canvas = null;
  boundary.stage = null;
  boundary.getUserAPI.mockReset();
  getHeaders.mockReturnValue({ headers: { Authorization: 'Bearer test-session' } });
  axios.get.mockReset();
  axios.post.mockReset();
  loadedProject = project();
  axios.get.mockImplementation(async (url) => {
    if (url.includes('/image_sessions/session_details')) return { data: loadedProject };
    return { data: {} };
  });
  axios.post.mockResolvedValue({ data: {} });
  vi.spyOn(toast, 'error').mockReturnValue('test-error');
  vi.spyOn(toast, 'success').mockReturnValue('test-success');
});

function mount(path = '/image/studio/image-project') {
  return render(<MemoryRouter initialEntries={[path]}><ColorModeProvider><LocalizationProvider><NavCanvasControlProvider><AlertDialogProvider>
    <Routes><Route path='/image/studio/:id' element={<ImageStudioHome />} /><Route path='/image/studio' element={<ImageStudioHome />} /></Routes>
  </AlertDialogProvider></NavCanvasControlProvider></LocalizationProvider></ColorModeProvider></MemoryRouter>);
}

async function loaded() {
  await screen.findByRole('region', { name: 'Studio canvas' });
  return boundary.canvas;
}

describe('image studio integration', () => {
  it('streams assistant progress through polling after SSE and temporary status failures', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('{}', { status: 404 }));
    if (!Element.prototype.scrollIntoView) Element.prototype.scrollIntoView = vi.fn();
    let polls = 0;
    const user = { id: 'q', role: 'user', content: 'Suggest a prompt' };
    axios.get.mockImplementation(async url => {
      if (!url.includes('/assistant_query_status')) return { data: loadedProject };
      expect(url).toContain('include_messages=true');
      if (++polls <= 3) throw new Error('Temporary network failure');
      const complete = polls >= 6;
      return { data: { status: complete ? 'COMPLETED' : 'PENDING', sessionDetails: {
        assistantSessionVersion: 0, sessionMessageGenerationPending: !complete,
        sessionMessages: complete ? [user, { id: 'q', role: 'assistant', content: 'Finished suggestion' }] : [user],
        assistantStream: { queryId: 'q', sequence: polls, status: complete ? 'completed' : 'streaming',
          text: polls === 4 ? 'Live suggestion' : 'Live suggestion continues' },
      } } };
    });
    mount(); await loaded();
    fireEvent.click(screen.getByRole('button', { name: 'Assistant', exact: true }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Message assistant' }), { target: { value: user.content } });
    vi.useFakeTimers();
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Send', exact: true })));
    expect(requests('/assistants/submit_assistant_query')[0][1].stream).toBe(true);
    expect(requests('/assistants/submit_assistant_query')[0][1].assistantContext).toMatchObject({ version: 1, page: 'image' });
    await act(async () => vi.advanceTimersByTimeAsync(4000));
    expect(screen.getByText('Live suggestion')).toBeInTheDocument();
    await act(async () => vi.advanceTimersByTimeAsync(1000));
    expect(screen.getByText('Live suggestion continues')).toBeInTheDocument();
    expect(screen.queryByText('Live suggestion', { exact: true })).not.toBeInTheDocument();
    await act(async () => vi.advanceTimersByTimeAsync(1000));
    expect(screen.getAllByText('Finished suggestion')).toHaveLength(1);
    await act(async () => vi.advanceTimersByTimeAsync(3000));
    expect(polls).toBe(6);
  });

  it('hydrates the project and canvas while retaining the real toolbar and navigation', async () => {
    mount();
    await loaded();
    expect(boundary.canvas.sessionId).toBe('image-project');
    expect(boundary.canvas.selectedLayerId).toBe('layer-1');
    expect(boundary.canvas.activeItemList).toEqual(loadedProject.layers[0].imageSession.activeItemList);
    expect(screen.getByRole('button', { name: 'Generate Image', exact: true })).toBeInTheDocument();
    expect(axios.get).toHaveBeenCalledWith(expect.stringContaining('/image_sessions/session_details?id=image-project'), { headers: { Authorization: 'Bearer test-session' } });
  });

  it('keeps the loading state while the project request is pending', () => {
    axios.get.mockReturnValue(new Promise(() => {}));
    mount();
    expect(screen.getByText('Loading image session...')).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Studio canvas' })).not.toBeInTheDocument();
  });

  it('reports a failed project load without fabricating a canvas', async () => {
    axios.get.mockRejectedValue(new Error('unavailable'));
    mount();
    await waitFor(() => expect(toast.error).toHaveBeenCalled());
    expect(screen.getByText('Loading image session...')).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Studio canvas' })).not.toBeInTheDocument();
  });

  it('does not fetch an existing project on the route without a session id', () => {
    mount('/image/studio');
    expect(axios.get.mock.calls.some(([url]) => url.includes('/image_sessions/session_details'))).toBe(false);
  });

  it('requests login instead of fetching a private project when authentication is missing', async () => {
    getHeaders.mockReturnValue(null);
    mount();
    expect(await screen.findByRole('heading', { name: 'Welcome back' })).toBeInTheDocument();
    expect(axios.get.mock.calls.some(([url]) => url.includes('/image_sessions/session_details'))).toBe(false);
  });

  it('does not synthesize a first layer for an empty project response', async () => {
    loadedProject = project({ layers: [] });
    mount();
    await waitFor(() => expect(axios.get).toHaveBeenCalled());
    expect(screen.getByText('Loading image session...')).toBeInTheDocument();
    expect(requests('/image_sessions/update_active_item_list')).toHaveLength(0);
  });

  it('ignores blank text, then creates a trimmed text layer with its configured style and persists it', async () => {
    mount();
    await loaded();
    await act(async () => boundary.canvas.createTextLayer({ text: '   ' }));
    expect(boundary.canvas.activeItemList).toHaveLength(1);
    expect(requests('/image_sessions/update_active_item_list')).toHaveLength(0);
    await act(async () => boundary.canvas.createTextLayer({ text: '  A scene title  ', config: { fill: '#ff0000', fontFamily: 'Arial' } }));
    expect(boundary.canvas.activeItemList).toHaveLength(2);
    expect(boundary.canvas.activeItemList[1]).toMatchObject({ id: 'item_1', type: 'text', text: 'A scene title', config: { fill: '#ff0000', fontFamily: 'Arial' } });
    expect(boundary.canvas.selectedId).toBe('item_1');
    expect(boundary.canvas.selectedLayerType).toBe('text');
    expect(requests('/image_sessions/update_active_item_list')[0][1]).toMatchObject({ sessionId: 'image-project', layerId: 'layer-1', activeItemList: boundary.canvas.activeItemList });
  });

  it('deletes the selected layer through the actual layers panel and persists the empty canvas', async () => {
    mount();
    await loaded();
    await act(async () => boundary.canvas.setSelectedId('image-a'));
    fireEvent.click(screen.getByRole('button', { name: 'Delete layer' }));
    expect(boundary.canvas.activeItemList).toEqual([]);
    expect(boundary.canvas.selectedId).toBeNull();
    expect(requests('/image_sessions/update_active_item_list').at(-1)[1].activeItemList).toEqual([]);
  });

  it('hides a selected image, clears its selection, and can show it again', async () => {
    mount();
    await loaded();
    await act(async () => boundary.canvas.setSelectedId('image-a'));
    fireEvent.click(screen.getByRole('button', { name: 'Hide layer' }));
    expect(boundary.canvas.selectedId).toBeNull();
    expect(boundary.canvas.activeItemList[0].isHidden).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Show layer' }));
    expect(boundary.canvas.activeItemList[0].isHidden).toBe(false);
    expect(requests('/image_sessions/update_active_item_list')).toHaveLength(2);
  });

  it('undoes and redoes a visibility edit using the actual toolbar controls', async () => {
    mount();
    await loaded();
    fireEvent.click(screen.getByRole('button', { name: 'Hide layer' }));
    fireEvent.click(screen.getByRole('button', { name: 'Actions', exact: true }));
    fireEvent.click(screen.getByRole('button', { name: 'Undo', exact: true }));
    expect(boundary.canvas.activeItemList[0].isHidden).not.toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Redo', exact: true }));
    expect(boundary.canvas.activeItemList[0].isHidden).toBe(true);
    expect(requests('/image_sessions/update_active_item_list')).toHaveLength(3);
  });

  it('supports canvas undo shortcuts while preserving text-field editing shortcuts', async () => {
    mount();
    await loaded();
    fireEvent.click(screen.getByRole('button', { name: 'Hide layer' }));
    fireEvent.keyDown(window, { key: 'z', ctrlKey: true });
    expect(boundary.canvas.activeItemList[0].isHidden).not.toBe(true);
    fireEvent.keyDown(window, { key: 'y', ctrlKey: true });
    expect(boundary.canvas.activeItemList[0].isHidden).toBe(true);
    const input = document.querySelector('textarea');
    expect(input).not.toBeNull();
    fireEvent.keyDown(input, { key: 'z', metaKey: true });
    expect(boundary.canvas.activeItemList[0].isHidden).toBe(true);
  });

  it('does not undo drawing gestures through the history shortcut while the pencil tool is active', async () => {
    mount();
    await loaded();
    fireEvent.click(screen.getByRole('button', { name: 'Hide layer' }));
    fireEvent.click(screen.getByRole('button', { name: 'Actions', exact: true }));
    fireEvent.click(screen.getByRole('button', { name: 'Pencil', exact: true }));
    fireEvent.keyDown(window, { key: 'z', ctrlKey: true });
    expect(boundary.canvas.activeItemList[0].isHidden).toBe(true);
    expect(screen.getByRole('button', { name: 'Undo', exact: true })).toBeDisabled();
  });

  it('ignores an older save response that arrives after a newer canvas save', async () => {
    const completions = [];
    axios.post.mockImplementation((_url, payload) => new Promise((resolve) => completions.push({ resolve, payload })));
    mount();
    await loaded();
    await act(async () => boundary.canvas.createTextLayer({ text: 'first edit' }));
    await act(async () => boundary.canvas.createTextLayer({ text: 'second edit' }));
    expect(completions).toHaveLength(2);
    const layer = (items) => ({ _id: 'layer-1', imageSession: { activeItemList: items } });
    await act(async () => completions[1].resolve({ data: { layer: layer(completions[1].payload.activeItemList) } }));
    await act(async () => completions[0].resolve({ data: { layer: layer(completions[0].payload.activeItemList) } }));
    expect(boundary.canvas.activeItemList.map((item) => item.text).filter(Boolean)).toEqual(['first edit', 'second edit']);
  });

  it('retains the local edit when saving to the server fails', async () => {
    axios.post.mockRejectedValue(new Error('network offline'));
    mount();
    await loaded();
    await act(async () => boundary.canvas.createTextLayer({ text: 'unsaved title' }));
    expect(boundary.canvas.activeItemList.at(-1).text).toBe('unsaved title');
    expect(requests('/image_sessions/update_active_item_list')).toHaveLength(1);
  });

  it('uses the selected generation model and requested image ratio when submitting a canvas prompt', async () => {
    axios.get.mockImplementation(async (url) => ({ data: url.includes('/generate_status') ? { status: 'FAILED', generationError: 'provider rejected request' } : loadedProject }));
    mount();
    await loaded();
    await act(async () => boundary.canvas.setSelectedGenerationModel('NANOBANANA2'));
    await act(async () => boundary.canvas.submitGenerateRequest({ prompt: 'A rainy street', aspectRatio: '16:9', extra: 'kept' }));
    expect(requests('/image_sessions/request_generate')[0][1]).toEqual({ prompt: 'A rainy street', aspectRatio: '16:9', extra: 'kept', videoSessionId: 'image-project', layerId: 'layer-1', model: 'NANOBANANA2' });
    expect(boundary.canvas.generationError).toBe('provider rejected request');
    expect(boundary.canvas.isGenerationPending).toBe(false);
    expect(boundary.getUserAPI).toHaveBeenCalledOnce();
  });

  it('clears generation pending state and surfaces a rejected submission', async () => {
    axios.post.mockRejectedValue(new Error('Request failed with status code 429'));
    mount();
    await loaded();
    await act(async () => boundary.canvas.submitGenerateRequest({ prompt: 'A rainy street' }));
    expect(boundary.canvas.isGenerationPending).toBe(false);
    expect(boundary.canvas.generationError).toBe('Request failed with status code 429');
    expect(axios.get.mock.calls.some(([url]) => url.includes('/generate_status'))).toBe(false);
    expect(toast.error).toHaveBeenCalled();
  });

  it('leaves the canvas usable when generation is attempted after the auth session expires', async () => {
    mount();
    await loaded();
    getHeaders.mockReturnValue(null);
    await act(async () => boundary.canvas.submitGenerateRequest({ prompt: 'A rainy street' }));
    expect(screen.getByRole('heading', { name: 'Welcome back' })).toBeInTheDocument();
    expect(requests('/image_sessions/request_generate')).toHaveLength(0);
    expect(boundary.canvas.isGenerationPending).toBe(false);
  });

  it('releases generation controls when authentication expires before the first poll', async () => {
    let acceptRequest;
    axios.post.mockReturnValueOnce(new Promise(resolve => { acceptRequest = resolve; }));
    mount();
    await loaded();
    await act(async () => boundary.canvas.submitGenerateRequest({ prompt: 'A rainy street' }));
    expect(boundary.canvas.isGenerationPending).toBe(true);
    getHeaders.mockReturnValue(null);
    await act(async () => acceptRequest({ data: {} }));
    expect(screen.getByRole('heading', { name: 'Welcome back' })).toBeInTheDocument();
    expect(boundary.canvas.isGenerationPending).toBe(false);
    expect(axios.get.mock.calls.some(([url]) => url.includes('/generate_status'))).toBe(false);
  });

  it.each([undefined, 'Credit balance exhausted'])('finishes a failed generation poll with an actionable error: %s', async (generationError) => {
    axios.get.mockImplementation(async (url) => ({ data: url.includes('/generate_status') ? { status: 'FAILED', generationError } : loadedProject }));
    mount();
    await loaded();
    await act(async () => boundary.canvas.submitGenerateNewRequest({ prompt: 'A rainy street' }));
    expect(boundary.canvas.isGenerationPending).toBe(false);
    expect(boundary.canvas.generationError).toBe(generationError || 'Generation failed.');
  });

  it.each([false, true])('adds completed generation output and persists its image placement when decoding fails=%s', async (decodeFails) => {
    fakeDecodedImage({ fail: decodeFails });
    axios.get.mockImplementation(async (url) => ({ data: url.includes('/generate_status') ? {
      status: 'COMPLETED', generationImages: ['/generations/new.png'],
      layer: { _id: 'layer-1', imageSession: { generationStatus: 'COMPLETED', activeGeneratedImage: 'new.png' } },
    } : loadedProject }));
    mount();
    await loaded();
    await act(async () => boundary.canvas.submitGenerateRequest({ prompt: 'new image' }));
    expect(boundary.canvas.activeItemList).toHaveLength(2);
    expect(boundary.canvas.activeItemList[1]).toMatchObject({
      id: 'item_1', type: 'image', src: expect.stringContaining('new.png'),
      width: decodeFails ? 1024 : 800, height: decodeFails ? 1024 : 400,
      x: decodeFails ? 0 : 112, y: decodeFails ? 0 : 312,
    });
    expect(boundary.canvas.isGenerationPending).toBe(false);
    expect(requests('/image_sessions/update_active_item_list')).toHaveLength(1);
    expect(boundary.getUserAPI).toHaveBeenCalledOnce();
  });

  it('polls a pending generation on a one-second interval and stops after failure', async () => {
    let polls = 0;
    axios.get.mockImplementation(async (url) => ({ data: url.includes('/generate_status') ? { status: ++polls === 1 ? 'PENDING' : 'FAILED' } : loadedProject }));
    mount();
    await loaded();
    vi.useFakeTimers();
    await act(async () => boundary.canvas.submitGenerateRequest({ prompt: 'new image' }));
    expect(polls).toBe(1);
    expect(boundary.canvas.isGenerationPending).toBe(true);
    await act(async () => vi.advanceTimersByTimeAsync(999));
    expect(polls).toBe(1);
    await act(async () => vi.advanceTimersByTimeAsync(1));
    expect(polls).toBe(2);
    expect(boundary.canvas.isGenerationPending).toBe(false);
    await act(async () => vi.advanceTimersByTimeAsync(3000));
    expect(polls).toBe(2);
  });

  it('cancels the scheduled generation poll when leaving the studio', async () => {
    let polls = 0;
    axios.get.mockImplementation(async (url) => {
      if (url.includes('/generate_status')) { polls += 1; return { data: { status: 'PENDING' } }; }
      return { data: loadedProject };
    });
    const { unmount } = mount();
    await loaded();
    vi.useFakeTimers();
    await act(async () => boundary.canvas.submitGenerateRequest({ prompt: 'new image' }));
    unmount();
    await vi.advanceTimersByTimeAsync(5000);
    expect(polls).toBe(1);
  });

  it('opens the actual upload dialog, decodes selected media and saves the resulting image layer', async () => {
    fakeDecodedImage();
    mount();
    await loaded();
    await act(async () => boundary.canvas.openUploadDialog());
    const file = new File(['<svg/>'], 'upload.svg', { type: 'image/svg+xml' });
    fireEvent.change(document.querySelector('#image-upload-input'), { target: { files: [file] } });
    await waitFor(() => expect(boundary.canvas.activeItemList).toHaveLength(2));
    expect(boundary.canvas.activeItemList.at(-1)).toMatchObject({ source: 'upload', type: 'image', width: 800, height: 400, x: 112, y: 312 });
    expect(document.querySelector('#image-upload-input')).toBeNull();
    expect(requests('/image_sessions/update_active_item_list')).toHaveLength(1);
  });

  it('opens advanced export with the project resolution and can dismiss it without saving', async () => {
    mount();
    await loaded();
    fireEvent.click(screen.getByRole('button', { name: 'Advanced', exact: true }));
    expect(screen.getByText('Advanced Download')).toBeInTheDocument();
    expect(screen.getByText('Output: 1024 × 1024px')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Close', exact: true }));
    expect(screen.queryByText('Advanced Download')).not.toBeInTheDocument();
    expect(axios.post).not.toHaveBeenCalled();
  });

  it('opens project settings with its existing custom dimensions and validates minimum/maximum sizes', async () => {
    loadedProject = project({ canvasDimensions: { width: 777, height: 555 } });
    mount();
    await loaded();
    fireEvent.click(screen.getByRole('button', { name: 'Edit', exact: true }));
    expect(screen.getByLabelText('Width')).toHaveValue(777);
    expect(screen.getByLabelText('Height')).toHaveValue(555);
    fireEvent.change(screen.getByLabelText('Width'), { target: { value: '127' } });
    expect(screen.getByText('Canvas dimensions must be at least 128px.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save changes' })).toBeDisabled();
    fireEvent.change(screen.getByLabelText('Width'), { target: { value: '8193' } });
    expect(screen.getByText('Canvas dimensions must be 8192px or smaller.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save changes' })).toBeDisabled();
    expect(requests('/image_sessions/update_aspect_ratio')).toHaveLength(0);
  });

  it('saves custom project dimensions through the dialog and applies the server response', async () => {
    loadedProject = project({ canvasDimensions: { width: 777, height: 555 } });
    axios.post.mockImplementation(async (url, payload) => ({ data: url.endsWith('/image_sessions/update_aspect_ratio') ? { session: project({ ...payload }) } : {} }));
    mount();
    await loaded();
    fireEvent.click(screen.getByRole('button', { name: 'Edit', exact: true }));
    fireEvent.change(screen.getByLabelText('Width'), { target: { value: '640' } });
    fireEvent.change(screen.getByLabelText('Height'), { target: { value: '360' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Save changes' })).not.toBeInTheDocument());
    expect(requests('/image_sessions/update_aspect_ratio')[0][1]).toEqual({ sessionId: 'image-project', aspectRatio: '1:1', canvasDimensions: { width: 640, height: 360 } });
    expect(boundary.canvas.canvasDimensions).toEqual({ width: 640, height: 360 });
  });

  it('starts with a 100% canvas zoom when there is no persisted zoom preference', async () => {
    mount();
    await loaded();
    const initialZoom = boundary.canvas.stageZoomScale;
    fireEvent.click(screen.getByRole('button', { name: 'Reset zoom', exact: true }));
    // Fit-to-screen scaling is separate. A fresh user's manual zoom should
    // match Reset zoom, which also uses fit mode and restores 100%.
    expect(boundary.canvas.stageZoomScale).toBe(1);
    expect(initialZoom).toBe(boundary.canvas.stageZoomScale);
  });

  it.each([
    ['100', 4], ['-10', 0.5], ['invalid', 1], ['1.75', 1.75],
  ])('clamps persisted zoom %s to the supported range', async (stored, scale) => {
    localStorage.setItem('imageStudioCanvasZoomMode', 'manual');
    localStorage.setItem('imageStudioCanvasZoomScale', stored);
    mount();
    await loaded();
    expect(boundary.canvas.stageZoomScale).toBe(scale);
    expect(boundary.canvas.displayZoomType).toBe('manual');
  });

  it('clamps navigation zoom controls at both limits and resets the persisted preference', async () => {
    localStorage.setItem('imageStudioCanvasZoomScale', '4');
    localStorage.setItem('imageStudioCanvasZoomMode', 'manual');
    mount();
    await loaded();
    expect(screen.getByRole('button', { name: 'Zoom in', exact: true })).toBeDisabled();
    for (let i = 0; i < 20; i++) fireEvent.click(screen.getByRole('button', { name: 'Zoom out', exact: true }));
    expect(boundary.canvas.stageZoomScale).toBe(0.5);
    expect(screen.getByRole('button', { name: 'Zoom out', exact: true })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Reset zoom', exact: true }));
    expect(boundary.canvas.stageZoomScale).toBe(1);
    expect(boundary.canvas.displayZoomType).toBe('fit');
    expect(localStorage.getItem('imageStudioCanvasZoomScale')).toBe('1');
    expect(localStorage.getItem('imageStudioCanvasZoomMode')).toBe('fit');
  });

  it('loads paginated library assets through the real library view and returns to the canvas', async () => {
    axios.get.mockImplementation(async (url, config) => {
      if (!url.includes('/library_assets')) return { data: loadedProject };
      const page = config.params.page;
      return { data: { currentSessionAssets: [], globalSessionAssets: [], pagination: { page, totalPages: 2, hasNextPage: page === 1, hasPreviousPage: page === 2 } } };
    });
    mount();
    await loaded();
    fireEvent.click(screen.getByRole('button', { name: 'Upload/Library', exact: true }));
    fireEvent.click(screen.getByRole('button', { name: 'Library', exact: true }));
    await screen.findByText('Page 1 of 2');
    expect(screen.getByRole('button', { name: 'Previous', exact: true })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Next', exact: true }));
    await screen.findByText('Page 2 of 2');
    expect(screen.getByRole('button', { name: 'Next', exact: true })).toBeDisabled();
    expect(axios.get).toHaveBeenCalledWith(expect.stringContaining('/image_sessions/library_assets'), expect.objectContaining({ params: { sessionId: 'image-project', page: 2, limit: 40 } }));
    fireEvent.click(screen.getByRole('button', { name: 'Back to Studio', exact: true }));
    expect(screen.getByRole('region', { name: 'Studio canvas' })).toBeInTheDocument();
  });

  it('shows a library request error without discarding the current canvas', async () => {
    axios.get.mockImplementation(async (url) => {
      if (url.includes('/library_assets')) throw new Error('Library unavailable');
      return { data: loadedProject };
    });
    mount();
    await loaded();
    fireEvent.click(screen.getByRole('button', { name: 'Upload/Library', exact: true }));
    fireEvent.click(screen.getByRole('button', { name: 'Library', exact: true }));
    await screen.findByText('Library unavailable');
    fireEvent.click(screen.getByRole('button', { name: 'Back to Studio', exact: true }));
    expect(boundary.canvas.activeItemList).toEqual(loadedProject.layers[0].imageSession.activeItemList);
  });

  it('adds a selected library asset with its raw source and signed preview, then returns to Studio', async () => {
    fakeDecodedImage();
    axios.get.mockImplementation(async (url) => ({ data: url.includes('/library_assets') ? {
      currentSessionAssets: [{ rawSrc: '/assets/raw.png', previewUrl: 'https://media.example/signed.png?token=test' }],
      globalSessionAssets: [],
    } : loadedProject }));
    mount();
    await loaded();
    fireEvent.click(screen.getByRole('button', { name: 'Upload/Library', exact: true }));
    fireEvent.click(screen.getByRole('button', { name: 'Library', exact: true }));
    // Opening the library briefly shows the existing project generations while
    // its request is pending. Wait for the requested asset before selecting it.
    await waitFor(() => expect(document.querySelector('img[src="https://media.example/signed.png?token=test"]')).not.toBeNull());
    fireEvent.click(screen.getByRole('button', { name: 'Select', exact: true }));
    await screen.findByRole('region', { name: 'Studio canvas' });
    expect(boundary.canvas.activeItemList.at(-1)).toMatchObject({ source: 'library', src: '/assets/raw.png', previewUrl: 'https://media.example/signed.png?token=test', width: 800, height: 400 });
    expect(requests('/image_sessions/update_active_item_list')).toHaveLength(1);
  });

  it('flattens canvas items while restoring the visibility of selection tools and masks', async () => {
    const visibleNode = (initial) => {
      let current = initial;
      return { visible: vi.fn((next) => next === undefined ? current : (current = next)) };
    };
    const transformer = visibleNode(true);
    const mask = visibleNode(false);
    boundary.stage = {
      find: vi.fn((selector) => selector === 'Transformer' ? [transformer] : [mask]),
      batchDraw: vi.fn(), toDataURL: vi.fn(() => 'data:image/png;base64,combined'),
    };
    mount();
    await loaded();
    fireEvent.click(screen.getByRole('button', { name: 'Actions', exact: true }));
    fireEvent.click(screen.getByRole('button', { name: 'Combine', exact: true }));
    expect(boundary.canvas.activeItemList).toEqual([{ src: 'data:image/png;base64,combined', id: 'item_0', x: 0, y: 0, width: 1024, height: 1024, type: 'image' }]);
    expect(transformer.visible()).toBe(true);
    expect(mask.visible()).toBe(false);
    expect(boundary.stage.toDataURL).toHaveBeenCalledWith({ pixelRatio: 2 });
    expect(boundary.stage.batchDraw).toHaveBeenCalledTimes(2);
    expect(requests('/image_sessions/update_active_item_list')).toHaveLength(1);
  });

  it('handles nested canvas drag events and rejects unsupported drop files without modifying the project', async () => {
    const { container } = mount();
    await loaded();
    const dropZone = container.querySelector('[aria-label="Studio canvas"]').parentElement;
    fireEvent.dragEnter(dropZone, { dataTransfer: { types: ['Files'] } });
    fireEvent.dragEnter(dropZone, { dataTransfer: { types: ['Files'] } });
    expect(screen.getByText('Drop image to upload')).toBeInTheDocument();
    fireEvent.dragLeave(dropZone);
    expect(screen.getByText('Drop image to upload')).toBeInTheDocument();
    fireEvent.dragLeave(dropZone);
    expect(screen.queryByText('Drop image to upload')).not.toBeInTheDocument();
    fireEvent.drop(dropZone, { dataTransfer: { files: [new File(['plain text'], 'notes.txt', { type: 'text/plain' })] } });
    expect(toast.error).toHaveBeenCalled();
    expect(boundary.canvas.activeItemList).toHaveLength(1);
    expect(requests('/image_sessions/update_active_item_list')).toHaveLength(0);
  });
});
