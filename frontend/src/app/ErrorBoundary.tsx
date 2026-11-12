// Issue #102 (demo hardening): one bad render cannot take the whole app down. A throw while
// rendering a part of the page shows a short message and a "Reload view" button in that part
// only; the rest stays mounted and usable. The reload keeps the URL hash, and useHashSync
// restores the object (and the open build pane) from it, so the button returns to where you were.
// Looks follow the design language (D-38): an `s1` card with a `line` border and a 10px radius,
// `fail` only for the error dot, and a 40px outline button (44px on touch, R9).
import { Component, type ErrorInfo, type ReactNode } from 'react';
import { isApiError } from './api/errors';

/** Reloads the page. `location.reload()` keeps the hash, so the same view comes back. */
export function reloadView(): void {
  window.location.reload();
}

export interface ErrorBoundaryProps {
  /** What failed, in plain words for the message: "The sky view", "This panel". */
  area: string;
  children?: ReactNode;
  /** Extra classes on the fallback card, so it sits where the failed part was. */
  className?: string;
  /**
   * A change in any of these (compared one by one with `Object.is`) clears a failed boundary, so
   * the next object gets a fresh try without a reload. Read only after a failure: a healthy part
   * is never remounted. Pass stable values (store fields, strings), not new objects each render.
   */
  resetKeys?: readonly unknown[];
  /** Test hook; defaults to reloadView. */
  onReload?: () => void;
}

interface State {
  failed: boolean;
}

function keysChanged(a: readonly unknown[] = [], b: readonly unknown[] = []): boolean {
  return a.length !== b.length || a.some((v, i) => !Object.is(v, b[i]));
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
    if (this.state.failed && keysChanged(prev.resetKeys, this.props.resetKeys)) {
      this.setState({ failed: false });
    }
  }

  override render(): ReactNode {
    if (!this.state.failed) return this.props.children;
    const onReload = this.props.onReload ?? reloadView;
    return (
      <div
        role="alert"
        data-testid="error-boundary"
        className={`flex max-w-sm flex-col gap-3 rounded-[10px] border border-line bg-s1 p-4 text-sm text-fg ${this.props.className ?? ''}`}
      >
        <p className="flex items-start gap-2">
          <span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-fail" aria-hidden="true" />
          <span>{this.props.area} stopped working. Reload view brings back where you were.</span>
        </p>
        <button
          type="button"
          onClick={onReload}
          className="h-10 self-start rounded-[6px] border border-line bg-transparent px-4 font-medium text-fg transition-transform hover:bg-s2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent active:scale-[0.98] pointer-coarse:h-11"
        >
          Reload view
        </button>
      </div>
    );
  }
}

/** True for a rejection that only means a request was cancelled on purpose (a newer one replaced it). */
function isExpectedAbort(reason: unknown): boolean {
  if (reason instanceof DOMException && reason.name === 'AbortError') return true;
  return isApiError(reason) && reason.kind === 'aborted';
}

let installed = false;

/**
 * Logs uncaught errors and unhandled promise rejections on `window` (issue #102). Log only:
 * nothing is prevented or changed, so the browser's own handling stays as it was. A request
 * cancelled on purpose is not logged. Installs once; a second call does nothing.
 */
export function installGlobalErrorLogging(): void {
  if (installed) return;
  installed = true;
  window.addEventListener('error', (e: ErrorEvent) => {
    console.error('[sx] uncaught error:', e.error ?? e.message);
  });
  window.addEventListener('unhandledrejection', (e: PromiseRejectionEvent) => {
    if (isExpectedAbort(e.reason)) return;
    console.error('[sx] unhandled promise rejection:', e.reason);
  });
}
