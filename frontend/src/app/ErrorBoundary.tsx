// Issue #102 (demo hardening): one bad render cannot take the whole app down. A throw while
// rendering a part of the page shows a short message and a "Reload view" button in that part
// only; the rest stays mounted and usable. The reload keeps the URL hash, and useHashSync
// restores the object from it, so the button returns to the same object.
import { Component, type ErrorInfo, type ReactNode } from 'react';

/** Reloads the page. `location.reload()` keeps the hash, so the same object comes back. */
export function reloadView(): void {
  window.location.reload();
}

export interface ErrorBoundaryProps {
  /** What failed, in plain words for the message: "The sky view", "This panel". */
  area: string;
  children?: ReactNode;
  /** Extra class on the fallback box, so it can sit where the failed part was. */
  className?: string;
  /**
   * A new value clears a failed boundary, so the next object gets a fresh try without a reload
   * (the current search). It is read only after a failure: a healthy part is never remounted.
   */
  resetKey?: unknown;
  /** Test hook; defaults to reloadView. */
  onReload?: () => void;
}

interface State {
  failed: boolean;
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, State> {
  override state: State = { failed: false };

  static getDerivedStateFromError(): State {
    return { failed: true };
  }

  override componentDidCatch(error: unknown, info: ErrorInfo): void {
    console.error(`[sx] ${this.props.area} stopped working:`, error, info.componentStack);
  }

  override componentDidUpdate(prev: ErrorBoundaryProps): void {
    if (this.state.failed && prev.resetKey !== this.props.resetKey)
      this.setState({ failed: false });
  }

  override render(): ReactNode {
    if (!this.state.failed) return this.props.children;
    const onReload = this.props.onReload ?? reloadView;
    return (
      <div
        role="alert"
        data-testid="error-boundary"
        className={`flex flex-col gap-2 rounded-md border border-red-400 bg-red-950/80 px-3 py-2 text-sm text-neutral-100 ${this.props.className ?? ''}`}
      >
        <p>{this.props.area} stopped working. Reloading brings back the same object.</p>
        <button
          type="button"
          onClick={onReload}
          className="min-h-11 self-start rounded-md border border-neutral-500 bg-neutral-900 px-3 text-neutral-100 hover:bg-neutral-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-400"
        >
          Reload view
        </button>
      </div>
    );
  }
}

let installed = false;

/**
 * Logs uncaught errors and unhandled promise rejections (issue #102). Log only: nothing is
 * prevented or changed, so the browser's own handling stays as it was. Safe to call twice.
 */
export function installGlobalErrorLogging(target: Window = window): void {
  if (installed) return;
  installed = true;
  target.addEventListener('error', (e: ErrorEvent) => {
    console.error('[sx] uncaught error:', e.error ?? e.message);
  });
  target.addEventListener('unhandledrejection', (e: PromiseRejectionEvent) => {
    console.error('[sx] unhandled promise rejection:', e.reason);
  });
}
