import { StrictMode, Suspense, useState } from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter, useLocation, useNavigate } from 'react-router-dom';
import { WorkspaceNavigationProvider } from '../../src/components/common/WorkspaceNavigation.jsx';
import CommonContainer from '../../src/components/common/CommonContainer.tsx';
import OverflowContainer from '../../src/components/common/OverflowContainer.tsx';
import PageSkeletonLoader from '../../src/components/common/PageSkeletonLoader.jsx';

const viewport = vi.hoisted(() => ({ mobile: false }));
vi.mock('react-responsive', () => ({ useMediaQuery: () => viewport.mobile }));
vi.mock('../../src/components/common/TopNav.tsx', () => ({
  default: function Navigation({ isWorkspaceLoading, submitRenderVideo }) {
    const [open, setOpen] = useState(false);
    return <nav aria-label="Workspace">
      <button onClick={() => setOpen(!open)}>Navigation</button>
      {open && <span>Menu open</span>}
      {!isWorkspaceLoading && submitRenderVideo && <button onClick={submitRenderVideo}>Render session</button>}
    </nav>;
  },
}));
vi.mock('../../src/components/common/MobileTopNav.tsx', () => ({ default: () => <nav aria-label="Mobile workspace" /> }));
vi.mock('../../src/components/common/AlertDialog.tsx', () => ({ AlertDialog: () => <div data-testid="dialog-host" /> }));

beforeEach(() => { viewport.mobile = false; });

function createPending() {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
}

describe('persistent workspace navigation', () => {
  it('keeps one navigation and dialog host through Suspense and removes stale session actions on route changes', async () => {
    let pending = createPending();
    let navigate;
    let renderVideo = vi.fn();
    const firstRender = renderVideo;
    function Page() {
      useLocation();
      if (pending) throw pending.promise;
      return <CommonContainer submitRenderVideo={renderVideo}><p>Ready session</p></CommonContainer>;
    }
    function App() {
      navigate = useNavigate();
      return <WorkspaceNavigationProvider><Suspense fallback={<PageSkeletonLoader page="image" />}><Page /></Suspense></WorkspaceNavigationProvider>;
    }
    const { rerender } = render(<StrictMode><MemoryRouter useTransitions={false} initialEntries={['/video/first']}><App /></MemoryRouter></StrictMode>);
    const nav = screen.getByRole('navigation');
    fireEvent.click(screen.getByRole('button', { name: 'Navigation' }));
    expect(screen.getByText('Menu open')).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Render session' })).toBeNull();
    const firstPending = pending;
    pending = null;
    await act(async () => firstPending.resolve());
    expect(screen.getByText('Ready session')).toBeVisible();
    expect(screen.getAllByRole('navigation')).toEqual([nav]);
    expect(screen.getAllByTestId('dialog-host')).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: 'Render session' }));
    expect(firstRender).toHaveBeenCalledTimes(1);

    // A ready page can replace a handler without remounting the navigation.
    renderVideo = vi.fn();
    rerender(<StrictMode><MemoryRouter useTransitions={false} initialEntries={['/video/first']}><App /></MemoryRouter></StrictMode>);
    fireEvent.click(screen.getByRole('button', { name: 'Render session' }));
    expect(renderVideo).toHaveBeenCalledTimes(1);
    expect(firstRender).toHaveBeenCalledTimes(1);

    pending = createPending();
    await act(async () => navigate('/video/second'));
    expect(screen.queryByRole('button', { name: 'Render session' })).toBeNull();
    expect(screen.getAllByRole('navigation')).toEqual([nav]);
    expect(screen.getByText('Menu open')).toBeVisible();
    const secondPending = pending;
    pending = null;
    await act(async () => secondPending.resolve());
    expect(screen.getByRole('button', { name: 'Render session' })).toBeVisible();
    expect(screen.getAllByRole('navigation')).toEqual([nav]);
  });

  it.each([false, true])('keeps the responsive shell available while a page loads (mobile=%s)', mobile => {
    viewport.mobile = mobile;
    function Page({ ready }) {
      return <WorkspaceNavigationProvider>{ready
        ? <OverflowContainer><p>Ready page</p></OverflowContainer>
        : <PageSkeletonLoader page="account" />}</WorkspaceNavigationProvider>;
    }
    const { rerender } = render(<MemoryRouter><Page ready={false} /></MemoryRouter>);
    const nav = screen.getByRole('navigation', { name: mobile ? 'Mobile workspace' : 'Workspace' });
    rerender(<MemoryRouter><Page ready /></MemoryRouter>);
    expect(screen.getAllByRole('navigation')).toEqual([nav]);
    expect(screen.getAllByTestId('dialog-host')).toHaveLength(1);
    expect(screen.getByText('Ready page')).toBeVisible();
  });
});
