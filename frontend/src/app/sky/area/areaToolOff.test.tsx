// Q-205 (closed by Moon, condition 4): with AREA_TOOL_ENABLED off, no Area path is reachable and
// the shell behaves as before Area search: no rail button, no card, `area=` links are not applied.
import { act } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('./areaTool', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./areaTool')>()),
  AREA_TOOL_ENABLED: false,
}));

const { TOOLS, openTool } = await import('@/app/shell/ToolRail');
const { useShellStore } = await import('@/app/shell/shellStore');
const { useAppStore, initialAppData } = await import('@/state/store');
const { AreaCard } = await import('./AreaCard');
const { useHashSync } = await import('@/app/useHashSync');
const { mount } = await import('@/test/mount');

function HashOnly() {
  useHashSync();
  return null;
}

describe('Area search switched off', () => {
  afterEach(() => window.history.replaceState(null, '', window.location.pathname));

  it('has no rail button and the tool cannot be entered', () => {
    expect(TOOLS.map((t) => t.id)).not.toContain('area');
    useShellStore.setState({ tool: 'sky' });
    openTool('area');
    expect(useShellStore.getState().tool).toBe('sky');
  });

  it('renders no Area card even if the tool were set', () => {
    useShellStore.setState({ tool: 'area' });
    useAppStore.setState({ area: { ...initialAppData.area, card: 'area' } });
    const m = mount(<AreaCard />);
    expect(m.host.innerHTML).toBe('');
    m.unmount();
    useShellStore.setState({ tool: 'sky' });
  });

  it('treats an area= link as before Area search (a link with no object)', () => {
    useAppStore.setState(initialAppData);
    window.history.replaceState(null, '', '#area=fixture%3Aarea-main');
    const m = mount(<HashOnly />);
    act(() => undefined);
    expect(useShellStore.getState().tool).toBe('sky');
    expect(useAppStore.getState().area.areaId).toBeNull();
    expect(useAppStore.getState().sky.linkProblems).toEqual([
      'This link has no object name or coordinates.',
    ]);
    m.unmount();
  });
});
