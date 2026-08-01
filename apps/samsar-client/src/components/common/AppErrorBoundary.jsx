import { Component } from 'react';

export default class AppErrorBoundary extends Component {
  state = {
    error: null,
  };

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, errorInfo) {
    console.error('Samsar client render failed:', error, errorInfo);
  }

  render() {
    if (!this.state.error) {
      return this.props.children;
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
