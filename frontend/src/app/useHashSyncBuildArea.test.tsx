// Regression (PR #100 review F1, F2; issue #60 behaviour): opening the build pane from Area search
// pushes its own marked `#build` entry above the area's, and Back returns to the area with the
// tool `area` and the pane closed once.
import { act } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createApiClient } from '@/app/api/client';
import { useShellStore } from '@/app/shell/shellStore';
import { useHashSync } from '@/app/useHashSync';
import { initialAreaState, resetAreaRequests } from '@/state/area';
import { initialAppData, setSkyApi, useAppStore } from '@/state/store';
import { fixtureFetch } from '@/test/fixtureFetch';
import { mount, stubMatchMedia } from '@/test/mount';

function HashOnly() {
  useHashSync();
  return null;
}

const settle = async () => {
  for (let i = 0; i < 8; i++) {
    await act(async () => {
      await new Promise((r) => setTimeout(r, 30));
    });
  }
};

describe('build pane from Area search', () => {
  afterEach(() => window.history.replaceState(null, '', window.location.pathname));

  it('pushes a marked #build entry; Back returns to the area', async () => {
    stubMatchMedia(false);
    resetAreaRequests();
    useAppStore.setState({ ...initialAppData, area: initialAreaState });
    useShellStore.setState({ tool: 'sky', pointerMode: 'pan', cardRequested: false });
    setSkyApi(createApiClient({ fetchImpl: fixtureFetch }));
    window.history.replaceState(null, '', '/#area=fixture%3Aarea-main');
    const m = mount(<HashOnly />);
    await settle();
    expect(useShellStore.getState().tool).toBe('area');
    const len0 = window.history.length;

    act(() => useShellStore.getState().setTool('viewer'));
    await settle();
    expect(window.history.state).toEqual({ sxBuild: true });
    expect(window.location.hash).toBe('#build');
    expect(window.history.length).toBe(len0 + 1);

    const closes = vi.spyOn(useShellStore.getState(), 'closeBuild');
    window.history.back();
    await settle();
    expect(decodeURIComponent(window.location.hash)).toBe('#area=fixture:area-main');
    expect(useShellStore.getState().tool).toBe('area');
    expect(useShellStore.getState().build.open).toBe(false);
    expect(useAppStore.getState().area.areaId).toBe('fixture:area-main');
    expect(closes.mock.calls.length).toBeLessThanOrEqual(1);
    closes.mockRestore();
    m.unmount();
  });
});
