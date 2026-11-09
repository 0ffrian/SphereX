// Issue #60: the build pane's state in the shell store.
import { beforeEach, describe, expect, it } from 'vitest';
import { useShellStore } from './shellStore';

beforeEach(() => {
  useShellStore.setState({
    tool: 'sky',
    body: { status: 'idle' },
    build: { open: false, animate: false, seq: 0, seedOffset: 0 },
  });
});

describe('build pane state', () => {
  it('New seed counts up and Replay keeps the seed', () => {
    const s = useShellStore.getState();
    s.openBuild(true);
    s.newSeed();
    s.newSeed();
    expect(useShellStore.getState().build.seedOffset).toBe(2);
    useShellStore.getState().replayBuild();
    expect(useShellStore.getState().build.seedOffset).toBe(2);
  });

  it("the rail's 3D viewer shows the card's own seed, not a New seed one", () => {
    const s = useShellStore.getState();
    s.openBuild(true);
    s.newSeed();
    s.closeBuild();
    expect(useShellStore.getState().build.seedOffset).toBe(0);
    // Open from the card, New seed, then the rail button without closing in between.
    useShellStore.getState().openBuild(true);
    useShellStore.getState().newSeed();
    useShellStore.getState().setTool('viewer');
    const b = useShellStore.getState().build;
    expect(b.open).toBe(true);
    expect(b.animate).toBe(false);
    expect(b.seedOffset).toBe(0);
  });

  it('choosing another tool closes the pane and forgets the seed', () => {
    useShellStore.getState().openBuild(true);
    useShellStore.getState().newSeed();
    useShellStore.getState().setTool('flipbook');
    const b = useShellStore.getState().build;
    expect(b.open).toBe(false);
    expect(b.seedOffset).toBe(0);
  });
});
