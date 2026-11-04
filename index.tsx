import React from 'react';
import ReactDOM from 'react-dom/client';
import './index.css';
import App from './App';

interface ErrorBoundaryState {
  hasError: boolean;
  errorMsg: string;
  retryCount: number;
}

function sanitizeLocalStorageOnCrash() {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return;
    const arrayKeys = [
      'tmdb_watchlist_v1',
      'tmdb_watched_movies_v1',
      'tmdb_watched_shows_full_v1',
      'tmdb_user_genres_v1',
      'tmdb_user_providers_v1',
    ];
    for (const k of arrayKeys) {
      const raw = window.localStorage.getItem(k);
      if (raw !== null) {
        try {
          const parsed = JSON.parse(raw);
          if (!Array.isArray(parsed)) {
            window.localStorage.setItem(k, '[]');
          }
        } catch {
          window.localStorage.setItem(k, '[]');
        }
      }
    }
    const epRaw = window.localStorage.getItem('tmdb_watched_episodes_v1');
    if (epRaw !== null) {
      try {
        const parsed = JSON.parse(epRaw);
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
          window.localStorage.setItem('tmdb_watched_episodes_v1', '{}');
        }
      } catch {
        window.localStorage.setItem('tmdb_watched_episodes_v1', '{}');
      }
    }
  } catch {
    // ignore
  }
}

class RootErrorBoundary extends React.Component<
  { children: React.ReactNode },
  ErrorBoundaryState
> {
  private keyListener: ((e: KeyboardEvent) => void) | null = null;
  private autoRetryTimer: number | null = null;

  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { hasError: false, errorMsg: '', retryCount: 0 };
  }

  static getDerivedStateFromError(error: unknown): Partial<ErrorBoundaryState> {
    return {
      hasError: true,
      errorMsg: error instanceof Error ? error.message : String(error),
    };
  }

  componentDidCatch(error: unknown, info: React.ErrorInfo) {
    console.error('RootErrorBoundary caught error:', error);
    sanitizeLocalStorageOnCrash();

    try {
      fetch('/api/client-error', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: error instanceof Error ? error.message : String(error),
          stack: error instanceof Error ? error.stack : '',
          componentStack: info?.componentStack || '',
          href: typeof window !== 'undefined' ? window.location.href : '',
          ua: typeof navigator !== 'undefined' ? navigator.userAgent : '',
        }),
      }).catch(() => {});
    } catch {
      // ignore
    }

    // Automatically self-heal once without requiring user interaction
    if (this.state.retryCount < 1) {
      if (this.autoRetryTimer) window.clearTimeout(this.autoRetryTimer);
      this.autoRetryTimer = window.setTimeout(() => {
        this.setState((prev) => ({
          hasError: false,
          errorMsg: '',
          retryCount: prev.retryCount + 1,
        }));
      }, 80);
    }
  }

  componentDidUpdate(_prevProps: unknown, prevState: ErrorBoundaryState) {
    if (this.state.hasError && !prevState.hasError) {
      this.attachRemoteListener();
    } else if (!this.state.hasError && prevState.hasError) {
      this.detachRemoteListener();
    }
  }

  componentWillUnmount() {
    this.detachRemoteListener();
    if (this.autoRetryTimer) window.clearTimeout(this.autoRetryTimer);
  }

  private handleRestart = () => {
    sanitizeLocalStorageOnCrash();
    this.setState((prev) => ({
      hasError: false,
      errorMsg: '',
      retryCount: prev.retryCount + 1,
    }));
  };

  private attachRemoteListener() {
    this.detachRemoteListener();
    if (typeof window === 'undefined') return;
    this.keyListener = (e: KeyboardEvent) => {
      const code = e.keyCode || e.which || 0;
      const key = e.key || '';
      if (
        key === 'Enter' ||
        key === ' ' ||
        key === 'Escape' ||
        key === 'Backspace' ||
        code === 13 ||
        code === 32 ||
        code === 461 ||
        code === 10009 ||
        code === 403
      ) {
        e.preventDefault();
        e.stopPropagation();
        this.handleRestart();
      }
    };
    window.addEventListener('keydown', this.keyListener, true);
  }

  private detachRemoteListener() {
    if (this.keyListener && typeof window !== 'undefined') {
      window.removeEventListener('keydown', this.keyListener, true);
      this.keyListener = null;
    }
  }

  render() {
    if (this.state.hasError) {
      if (this.state.retryCount < 1) {
        return <div className="fixed inset-0 bg-black" />;
      }
      return (
        <div className="fixed inset-0 bg-black text-white flex flex-col items-center justify-center p-6 text-center select-none">
          <div className="max-w-md w-full rounded-3xl bg-[#1C1C1E] border border-white/10 p-6 space-y-4 shadow-2xl">
            <h1 className="text-lg font-bold text-white">MovieJournal wird neu geladen</h1>
            <p className="text-xs text-zinc-400 leading-relaxed line-clamp-3">
              {this.state.errorMsg || 'Ein temporärer Darstellungsfehler ist aufgetreten.'}
            </p>
            <button
              ref={(el) => {
                if (el) {
                  try {
                    el.focus({ preventScroll: true });
                  } catch {
                    el.focus();
                  }
                }
              }}
              type="button"
              tabIndex={0}
              onClick={this.handleRestart}
              className="w-full py-3 rounded-xl bg-white text-black font-bold text-xs hover:bg-zinc-200 ring-4 ring-white/40 transition-colors cursor-pointer"
            >
              Jetzt neu starten (OK-Taste drücken)
            </button>
          </div>
        </div>
      );
    }
    return <React.Fragment key={this.state.retryCount}>{this.props.children}</React.Fragment>;
  }
}

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error('Could not find root element to mount to');
}

const root = ReactDOM.createRoot(rootElement);
root.render(
  <RootErrorBoundary>
    <App />
  </RootErrorBoundary>
);