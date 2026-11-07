import { render, screen, waitFor } from '@testing-library/react';
import { page, userEvent } from 'vitest/browser';
import { beforeEach, expect, it, vi } from 'vitest';
import axios from 'axios';
import UserAccount from '../../src/components/account/UserAccount.tsx';
import '../../src/index.css';

const fixture = vi.hoisted(() => ({
  pathname: '/account/usage',
  standalone: false,
  user: {
    _id: 'owner', username: 'Usage test', selectedInferenceModel: 'gpt-6-astra',
    selectedAssistantModel: 'gpt-6-astra', selectedInferenceEffort: 'high',
  },
}));

vi.mock('axios', () => ({ default: { get: vi.fn(), post: vi.fn() } }));
vi.mock('react-router-dom', async (importOriginal) => ({
  ...await importOriginal(),
  useNavigate: () => vi.fn(),
  useLocation: () => ({ pathname: fixture.pathname }),
}));
vi.mock('../../src/contexts/ColorMode.jsx', () => ({ useColorMode: () => ({ colorMode: 'dark' }) }));
vi.mock('../../src/contexts/UserContext.jsx', () => ({
  useUser: () => ({ user: fixture.user }),
}));
vi.mock('../../src/utils/environment.jsx', async (importOriginal) => ({ ...await importOriginal(), get IS_STANDALONE_DEPLOYMENT() { return fixture.standalone; } }));
vi.mock('../../src/utils/web.jsx', async (importOriginal) => ({ ...await importOriginal(), getHeaders: () => ({ headers: { Authorization: 'test' } }) }));
vi.mock('../../src/hooks/useDeploymentModelAvailability.js', () => ({ useDeploymentModelAvailability: () => ({ primaryAdapterByModel: {} }) }));
vi.mock('../../src/hooks/useInferenceModelAvailability.js', () => ({ useInferenceModelAvailability: () => ({}) }));
vi.mock('../../src/components/common/TopNav.tsx', () => ({ default: () => <div className="fixed top-0 h-14">Top navigation</div> }));
vi.mock('../../src/components/common/MobileTopNav.tsx', () => ({ default: () => <div className="fixed top-0 h-14">Mobile navigation</div> }));
vi.mock('../../src/components/common/AlertDialog.tsx', () => ({ AlertDialog: () => null }));
// Keep the real account layout; substitute long content for unrelated panels.
vi.mock('../../src/components/account/MusicPanelContent.jsx', () => ({ default: () => <div style={{ height: 1800 }}>Music content</div> }));
vi.mock('../../src/components/account/ImagePanelContent.jsx', () => ({ default: () => <div style={{ height: 1800 }}>Image content</div> }));
vi.mock('../../src/components/account/SettingsPanelContent.jsx', () => ({ default: () => <div style={{ height: 1800 }}>Settings content</div> }));
vi.mock('../../src/components/account/BillingPanelContent.jsx', () => ({ default: () => <div style={{ height: 1800 }}>Billing content</div> }));
vi.mock('../../src/components/account/ModelAdaptersPanelContent.jsx', () => ({ default: () => <div style={{ height: 1800 }}>Adapter content</div> }));
vi.mock('../../src/components/account/APIKeysPanelContent.jsx', () => ({ default: () => <div style={{ height: 1800 }}>API key content</div> }));
vi.mock('../../src/components/library/aivideo/SceneLibraryHome.jsx', () => ({ default: () => <div style={{ height: 1800 }}>Scene content</div> }));
vi.mock('react-toastify', () => ({ toast: { error: vi.fn(), success: vi.fn() }, ToastContainer: () => null }));

beforeEach(() => {
  fixture.pathname = '/account/usage';
  fixture.standalone = false;
  axios.get.mockImplementation(async url => ({ data: url.endsWith('/usage/logs') ? {
    items: Array.from({ length: 25 }, (_, index) => ({
      id: `entry-${index}`, source: `entry_${index}`, credits: 20,
      metadata: { sessionId: `session-${index}` }, createdAt: '2026-11-07T00:00:00Z',
    })),
    pagination: { page: 1, pageSize: 25, totalItems: 26, totalPages: 2, hasNextPage: true, hasPreviousPage: false },
  } : { apiKeys: [] } }));
});

it.each([[1280, 800], [390, 700]])('scrolls all usage rows and pagination into view at %sx%s', async (width, height) => {
  await page.viewport(width, height);
  const { container } = render(<UserAccount />);
  await screen.findByText('Entry 24');
  const scroller = container.querySelector('.workspace-scroll');
  expect(scroller.scrollHeight).toBeGreaterThan(scroller.clientHeight);
  expect(scroller.getBoundingClientRect().bottom).toBeLessThanOrEqual(height + 1);
  await userEvent.wheel(scroller, { delta: { y: 400 } });
  await waitFor(() => expect(scroller.scrollTop).toBeGreaterThan(0));
  scroller.scrollTop = scroller.scrollHeight;
  await waitFor(() => expect(scroller.scrollTop).toBeGreaterThan(0));
  const lastNext = screen.getAllByRole('button', { name: 'Next' }).at(-1);
  expect(lastNext.getBoundingClientRect().bottom).toBeLessThanOrEqual(height);
  expect(lastNext.getBoundingClientRect().top).toBeGreaterThan(56);
  expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(width);
  expect(document.documentElement.scrollHeight).toBeLessThanOrEqual(height + 1);
});

for (const width of [390, 1280]) {
  it.each(['account', 'settings', 'billing', 'apiKeys', 'images', 'sounds', 'scenes', 'videos', 'model-adapters'])(
    `keeps the shared %s panel scrollable at ${width}px`, async panel => {
      fixture.pathname = panel === 'account' ? '/account' : `/account/${panel}`;
      fixture.standalone = panel === 'model-adapters';
      await page.viewport(width, 600);
      const { container } = render(<UserAccount />);
      const scroller = container.querySelector('.workspace-scroll');
      expect(scroller.scrollHeight).toBeGreaterThan(scroller.clientHeight);
      await userEvent.wheel(scroller, { delta: { y: 400 } });
      await waitFor(() => expect(scroller.scrollTop).toBeGreaterThan(0));
      scroller.scrollTop = scroller.scrollHeight;
      expect(scroller.scrollTop + scroller.clientHeight).toBeCloseTo(scroller.scrollHeight, 0);
      expect(scroller.getBoundingClientRect().bottom).toBeLessThanOrEqual(601);
      expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(width);
      expect(document.documentElement.scrollHeight).toBeLessThanOrEqual(601);
    },
  );
}
