import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from './api/errors';
import { ErrorBoundary, installGlobalErrorLogging } from './ErrorBoundary';

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}

function Boom(): never {
  throw new Error('test: forced render throw');
}

describe('ErrorBoundary (#102)', () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    host = document.createElement('div');
    document.body.append(host);
    root = createRoot(host);
    // React and the boundary both log the forced throw; keep the test output clean.
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
    vi.restoreAllMocks();
  });

  it('a throwing panel shows its fallback and leaves the other panels mounted', () => {
    act(() =>
      root.render(
        <ErrorBoundary area="The app">
          <ErrorBoundary area="The sky view">
            <p data-testid="sky">sky</p>
          </ErrorBoundary>
          <ErrorBoundary area="This panel">
            <Boom />
          </ErrorBoundary>
          <ErrorBoundary area="The build pane">
            <p data-testid="build">build</p>
          </ErrorBoundary>
        </ErrorBoundary>,
      ),
    );
    expect(host.querySelector('[data-testid="sky"]')).not.toBeNull();
    expect(host.querySelector('[data-testid="build"]')).not.toBeNull();
    const fallbacks = host.querySelectorAll('[data-testid="error-boundary"]');
    expect(fallbacks).toHaveLength(1);
    expect(fallbacks[0]?.getAttribute('role')).toBe('alert');
    expect(fallbacks[0]?.textContent).toMatch(/^This panel stopped working/);
  });

  it('the Reload view button reloads', () => {
    const onReload = vi.fn();
    act(() =>
      root.render(
        <ErrorBoundary area="This panel" onReload={onReload}>
          <Boom />
        </ErrorBoundary>,
      ),
    );
    const button = host.querySelector('button');
    expect(button?.textContent).toBe('Reload view');
    act(() => button?.click());
    expect(onReload).toHaveBeenCalledOnce();
  });

  it('offers a second action when given one (the build pane: Close build)', () => {
    const onClick = vi.fn();
    act(() =>
      root.render(
        <ErrorBoundary area="The build pane" action={{ label: 'Close build', onClick }}>
          <Boom />
        </ErrorBoundary>,
      ),
    );
    const buttons = [...host.querySelectorAll('button')].map((b) => b.textContent);
    expect(buttons).toEqual(['Reload view', 'Close build']);
    act(() => host.querySelectorAll('button')[1]?.click());
    expect(onClick).toHaveBeenCalledOnce();
  });

  it('a changed reset key clears the fallback; equal keys keep it', () => {
    let fail = true;
    function Maybe() {
      if (fail) throw new Error('test: forced render throw');
      return <p data-testid="back">back</p>;
    }
    const at = (key: string) =>
      act(() =>
        root.render(
          <ErrorBoundary area="This panel" resetKeys={[key, 'kind']}>
            <Maybe />
          </ErrorBoundary>,
        ),
      );
    at('a');
    expect(host.querySelector('[data-testid="error-boundary"]')).not.toBeNull();
    fail = false;
    at('a');
    expect(host.querySelector('[data-testid="error-boundary"]')).not.toBeNull();
    at('b');
    expect(host.querySelector('[data-testid="error-boundary"]')).toBeNull();
    expect(host.querySelector('[data-testid="back"]')).not.toBeNull();
  });

  it('renders its children untouched when nothing throws', () => {
    act(() =>
      root.render(
        <ErrorBoundary area="This panel">
          <p data-testid="ok">ok</p>
        </ErrorBoundary>,
      ),
    );
    expect(host.innerHTML).toBe('<p data-testid="ok">ok</p>');
  });
});

describe('installGlobalErrorLogging (#102)', () => {
  afterEach(() => vi.restoreAllMocks());

  const reject = (reason: unknown) =>
    window.dispatchEvent(Object.assign(new Event('unhandledrejection'), { reason }));

  it('logs unhandled rejections and uncaught errors, but not a request cancelled on purpose', () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    installGlobalErrorLogging();
    installGlobalErrorLogging(); // a second call adds no second listener

    reject(new ApiError('aborted', 'Replaced by a newer request.'));
    reject(new DOMException('aborted', 'AbortError'));
    expect(log).not.toHaveBeenCalled();

    const boom = new Error('test: unhandled');
    reject(boom);
    expect(log).toHaveBeenCalledOnce();
    expect(log).toHaveBeenCalledWith('[sx] unhandled promise rejection:', boom);

    window.dispatchEvent(new ErrorEvent('error', { error: boom, message: boom.message }));
    expect(log).toHaveBeenCalledTimes(2);
    expect(log).toHaveBeenLastCalledWith('[sx] uncaught error:', boom);
  });
});
