import { render } from '@testing-library/react';
import { page, userEvent } from 'vitest/browser';
import { expect, it, vi } from 'vitest';
import { MemoryRouter, useLocation } from 'react-router-dom';
import TopNav from '../../src/components/common/TopNav.tsx';
import MobileTopNav from '../../src/components/common/MobileTopNav.tsx';
import { NavCanvasControlContext } from '../../src/contexts/NavCanvasControlContext.jsx';
import { LocalizationProvider } from '../../src/contexts/LocalizationContext.jsx';
import { ColorModeProvider } from '../../src/contexts/ColorMode.jsx';
import '../../src/index.css';

vi.mock('../../src/contexts/UserContext.jsx', () => ({ useUser: () => ({ user: { _id: 'user', email: 'user@example.com', generationCredits: 1000 } }) }));
vi.mock('../../src/components/video/toolbars/CanvasControlBar.jsx', () => ({ default: () => null }));

function Location() {
  return <output className="block pt-32" aria-label="Current route">{useLocation().pathname}</output>;
}

function mount(Nav = TopNav) {
  localStorage.setItem('videoSessionId', 'video-1');
  localStorage.setItem('imageSessionId', 'image-1');
  render(
    <MemoryRouter initialEntries={['/image/studio/image-1']}>
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
  await page.getByRole('button', { name: 'New Project', exact: true }).click();
  for (const name of ['Studio', 'VidGenie', 'Image Editor', 'Audio Studio', 'View Projects']) {
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
  await page.getByRole('button', { name: 'New Project', exact: true }).click();
  await userEvent.keyboard('{Escape}');
  await expect.element(page.getByRole('button', { name: 'New Project', exact: true })).toHaveFocus();
  await userEvent.keyboard('{ArrowDown}{Enter}');
  await expect.element(page.getByLabelText('Current route')).toHaveTextContent('/video');
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
