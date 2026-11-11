// Regression (code review finding 1, issue #96): Back and Forward through Area search entries must
// not rewrite history. Applying a hash changes the stores; those changes must not write the hash
// again (which pushed or replaced the entry Back had just reached).
import { act } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
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

const now = () => ({
  hash: decodeURIComponent(window.location.hash),
  tool: useShellStore.getState().tool,
  areaId: useAppStore.getState().area.areaId,
});

describe('Area search and the history', () => {
  afterEach(() => window.history.replaceState(null, '', window.location.pathname));

  it('Back opens the earlier area, Forward leaves the tool, Back opens it again', async () => {
    stubMatchMedia(false);
    resetAreaRequests();
    useAppStore.setState({ ...initialAppData, area: initialAreaState });
    useShellStore.setState({ tool: 'sky', pointerMode: 'pan', cardRequested: false });
    setSkyApi(createApiClient({ fetchImpl: fixtureFetch }));
    window.history.replaceState(null, '', '/#area=fixture%3Aarea-main');
    const m = mount(<HashOnly />);
    await settle();
    expect(now()).toEqual({
      hash: '#area=fixture:area-main',
      tool: 'area',
      areaId: 'fixture:area-main',
    });

    // A new area pushes an entry; leaving the tool replaces it with one without `area`.
    await act(async () => {
      await useAppStore.getState().areaOpen('fixture:area-multivisit', 'snap');
    });
    await settle();
    expect(now().hash).toBe('#area=fixture:area-multivisit');
    act(() => useShellStore.getState().setTool('sky'));
    await settle();
    expect(now()).toMatchObject({ hash: '', tool: 'sky' });

    window.history.back();
    await settle();
    expect(now()).toEqual({
      hash: '#area=fixture:area-main',
      tool: 'area',
      areaId: 'fixture:area-main',
    });

    window.history.forward();
    await settle();
    expect(now()).toMatchObject({ hash: '', tool: 'sky' });

    window.history.back();
    await settle();
    expect(now()).toEqual({
      hash: '#area=fixture:area-main',
      tool: 'area',
      areaId: 'fixture:area-main',
    });
    m.unmount();
  });
});
