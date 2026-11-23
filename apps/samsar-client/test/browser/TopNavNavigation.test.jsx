import { render } from '@testing-library/react';
import { page, userEvent } from 'vitest/browser';
import { beforeEach, expect, it, vi } from 'vitest';
import axios from 'axios';
import { MemoryRouter, useLocation } from 'react-router-dom';
import TopNav from '../../src/components/common/TopNav.tsx';
import MobileTopNav from '../../src/components/common/MobileTopNav.tsx';
import { NavCanvasControlContext } from '../../src/contexts/NavCanvasControlContext.jsx';
import { LocalizationProvider } from '../../src/contexts/LocalizationContext.jsx';
import { ColorModeProvider } from '../../src/contexts/ColorMode.jsx';
import '../../src/index.css';

const mocks = vi.hoisted(() => ({ userState: {} }));
vi.mock('../../src/contexts/UserContext.jsx', () => ({ useUser: () => mocks.userState }));
vi.mock('../../src/components/video/toolbars/CanvasControlBar.jsx', () => ({ default: () => null }));
vi.mock('axios', () => ({ default: { post: vi.fn() } }));

beforeEach(() => {
  mocks.userState = { user: { _id: 'user', email: 'user@example.com', generationCredits: 1000 }, userFetching: false, userInitiated: true };
});

function Location() {
  return <output className="block pt-32" aria-label="Current route">{useLocation().pathname}</output>;
}

function mount(Nav = TopNav, path = '/image/studio/image-1') {
  localStorage.setItem('videoSessionId', 'video-1');
  localStorage.setItem('imageSessionId', 'image-1');
  render(
    <MemoryRouter initialEntries={[path]}>
      <ColorModeProvider><LocalizationProvider>
        <NavCanvasControlContext.Provider value={{}}>
          <Nav addNewVidGPTSession={vi.fn()} />
          <Location />
        </NavCanvasControlContext.Provider>
      </LocalizationProvider></ColorModeProvider>
    </MemoryRouter>
  );
}

async function expectDestinations() {
  await page.getByRole('button', { name: 'View Projects', exact: true }).click();
  for (const name of ['Create', 'Studio', 'VidGenie', 'Image Editor', 'Audio Studio', 'View Projects']) {
    await expect.element(page.getByRole('menuitem', { name, exact: true })).toBeVisible();
  }
  await expect.element(page.getByRole('dialog')).not.toBeInTheDocument();
}

it.each(['light', 'dark'])('navigates across canvases with the same menu in %s mode', async (theme) => {
  await page.viewport(1280, 800);
  localStorage.setItem('colorMode', theme);
  mount();
  await expectDestinations();
  await page.getByRole('menuitem', { name: 'Studio', exact: true }).click();
  await expect.element(page.getByLabelText('Current route')).toHaveTextContent('/video');
  await expectDestinations();
  await page.getByRole('menuitem', { name: 'Audio Studio', exact: true }).click();
  await expect.element(page.getByLabelText('Current route')).toHaveTextContent('/audio/studio');
  await expectDestinations();
  await page.getByRole('menuitem', { name: 'Image Editor', exact: true }).click();
  await expect.element(page.getByLabelText('Current route')).toHaveTextContent('/image/studio/image-1');
  await page.getByRole('button', { name: 'New image project', exact: true }).click();
  await expect.element(page.getByRole('dialog', { name: 'Create new Image session' })).toBeVisible();
  await userEvent.keyboard('{Escape}');
  await expect.element(page.getByRole('dialog')).not.toBeInTheDocument();
});

it('supports keyboard selection, Escape, and outside-click dismissal', async () => {
  await page.viewport(1280, 800);
  mount();
  await page.getByRole('button', { name: 'View Projects', exact: true }).click();
  await userEvent.keyboard('{Escape}');
  await expect.element(page.getByRole('button', { name: 'View Projects', exact: true })).toHaveFocus();
  await userEvent.keyboard('{ArrowDown}{Enter}');
  await expect.element(page.getByLabelText('Current route')).toHaveTextContent('/create');
  await expect.element(page.getByRole('dialog')).not.toBeInTheDocument();
  await expectDestinations();
  // The modal menu makes the route output inert; click the outside surface instead.
  await page.elementLocator(document.body).click({ position: { x: 10, y: 700 } });
  await expect.element(page.getByRole('menu')).not.toBeInTheDocument();
});

it('keeps the full menu and project action usable on narrow screens', async () => {
  await page.viewport(375, 812);
  mount(MobileTopNav);
  await expectDestinations();
  const bounds = page.getByRole('menu').element().getBoundingClientRect();
  expect(bounds.left).toBeGreaterThanOrEqual(0);
  expect(bounds.right).toBeLessThanOrEqual(375);
  await page.getByRole('menuitem', { name: 'Studio', exact: true }).click();
  await page.getByRole('button', { name: 'New Studio project', exact: true }).click();
  await expect.element(page.getByRole('dialog', { name: 'Create new session', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expectDestinations();
});

it.each([
  ['desktop', TopNav, 1280],
  ['mobile', MobileTopNav, 375],
  ['small mobile', MobileTopNav, 320],
])('opens Create from the prominent projects menu on %s', async (_, Nav, width) => {
  await page.viewport(width, 812);
  mount(Nav);
  await expect.element(page.getByRole('link', { name: 'Create', exact: true })).not.toBeInTheDocument();
  const projectsButton = page.getByRole('button', { name: 'View Projects', exact: true });
  await expect.element(projectsButton).toBeVisible();
  const bounds = projectsButton.element().getBoundingClientRect();
  expect(bounds.left).toBeGreaterThanOrEqual(0);
  expect(bounds.right).toBeLessThanOrEqual(width);
  expect(document.querySelector('[data-app-top-nav]').scrollWidth).toBeLessThanOrEqual(width);
  await projectsButton.click();
  await page.getByRole('menuitem', { name: 'Create', exact: true }).click();
  await expect.element(page.getByLabelText('Current route')).toHaveTextContent('/create');
  await expect.element(page.getByRole('button', { name: 'View Projects', exact: true })).toBeVisible();
  await expect.element(page.getByRole('button', { name: 'Samsar Studio', exact: true })).toBeVisible();
  await projectsButton.click();
  await expect.element(page.getByRole('menuitem', { name: 'Create', exact: true })).toHaveAttribute('aria-current', 'page');
});

it.each([
  ['desktop', TopNav, 1280],
  ['mobile', MobileTopNav, 375],
])('keeps guest Create navigation available without session requests on %s', async (_, Nav, width) => {
  await page.viewport(width, 812);
  mocks.userState.user = null;
  mount(Nav, '/');
  await page.getByRole('button', { name: 'View Projects', exact: true }).click();
  await expect.element(page.getByRole('menuitem', { name: 'Create', exact: true })).toBeVisible();
  expect(page.getByRole('menu').element().querySelectorAll('[role="menuitem"]')).toHaveLength(1);
  await page.getByRole('menuitem', { name: 'Create', exact: true }).click();
  await expect.element(page.getByLabelText('Current route')).toHaveTextContent('/create');
  expect(axios.post).not.toHaveBeenCalled();
});
