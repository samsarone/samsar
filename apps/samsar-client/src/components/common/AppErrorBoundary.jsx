import { Component } from 'react';
import {
  APP_ERROR_REVEAL_DELAY_MS,
  shouldDelayAppErrorDisplay,
} from '../../utils/appErrorRecovery.mjs';
import { isPreloadRecoveryPending } from '../../utils/routePreloadRecovery.mjs';
import RouteLoadingScreen from './RouteLoadingScreen.jsx';

export default class AppErrorBoundary extends Component {
  appStartedAt = Date.now();

  errorRevealTimer = null;

  state = {
    error: null,
    revealError: false,
  };

  static getDerivedStateFromError(error) {
    return { error, revealError: false };
  }

  componentDidCatch(error, errorInfo) {
    console.error('Samsar client render failed:', error, errorInfo);

    if (!shouldDelayAppErrorDisplay({
      appStartedAt: this.appStartedAt,
      errorCaughtAt: Date.now(),
      preloadRecoveryPending: isPreloadRecoveryPending(),
    })) {
      this.setState({ revealError: true });
      return;
    }

    this.errorRevealTimer = window.setTimeout(() => {
      this.setState({ revealError: true });
    }, APP_ERROR_REVEAL_DELAY_MS);
  }

  componentWillUnmount() {
    if (this.errorRevealTimer !== null) {
      window.clearTimeout(this.errorRevealTimer);
    }
  }

  render() {
    if (!this.state.error) {
      return this.props.children;
    }

    if (!this.state.revealError) {
      return <RouteLoadingScreen label="Opening workspace..." />;
    }

    return (
      <main className="flex min-h-screen items-center justify-center bg-[#0c0d12] px-6 text-slate-100">
        <section className="w-full max-w-md rounded-2xl border border-slate-700 bg-[#181b24] p-7 text-center shadow-2xl">
          <h1 className="text-xl font-semibold">We couldn&apos;t open this page</h1>
          <p className="mt-3 text-sm leading-6 text-slate-300">
            The app may have been updated while this page was open. Reload to
            reconnect and continue.
          </p>
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="mt-6 rounded-xl bg-blue-600 px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-blue-500"
          >
            Reload page
          </button>
        </section>
      </main>
    );
  }
}
