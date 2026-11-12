// Issue #71 (D-37): the zoom bar and Details buttons act on the drawing engine, or say why they cannot.
import { describe, expect, it, vi } from 'vitest';
import { resolveViewControls } from './engineView';
import { engineKey, useWorldStore } from './worldStore';
import type { ViewerApp } from '@/viewer/ViewerApp';
import type { RockView } from '@/engine/rocks/RockView';
import type { WorldEngine } from '@/engine/worlds/WorldEngine';

const base = { viewer: null, engineWorld: null, engineStar: null, rockView: null, rockKind: false };

describe('resolveViewControls', () => {
  it('drives the three.js viewer when no engine draws', () => {
    const viewer = {
      zoom: vi.fn(),
      rotate: vi.fn(),
      resetView: vi.fn(),
      zoomRatio: () => 1.5,
    } as unknown as ViewerApp;
    const vc = resolveViewControls({ ...base, viewer });
    expect(vc.zoomOff).toBeNull();
    vc.zoom('in');
    vc.rotate('left');
    vc.reset();
    expect(viewer.zoom).toHaveBeenCalledWith('in');
    expect(viewer.rotate).toHaveBeenCalledWith('left');
    expect(viewer.resetView).toHaveBeenCalled();
    expect(vc.ratio()).toBe(1.5);
  });

  it('is off, with a reason, before any viewer exists', () => {
    expect(resolveViewControls(base).zoomOff).toMatch(/not ready/);
  });

  it('a world the engine draws zooms and turns through the world store', () => {
    const state = { zoom: 2, yaw: 0, pitch: 0 };
    const globe = {
      state: () => state,
      setOverrides: vi.fn(),
      draw: vi.fn(),
    } as unknown as WorldEngine;
    const apply = vi.fn();
    useWorldStore.setState({ globe, apply });
    const vc = resolveViewControls({ ...base, engineWorld: {} });
    expect(vc.zoomOff).toBeNull();
    vc.zoom('in');
    expect(apply).toHaveBeenLastCalledWith({ zoom: 2.5 });
    // The surface follows the arrow (issue #93): a larger yaw turns it left on screen, a larger pitch moves it up.
    vc.rotate('right');
    expect(apply.mock.calls.at(-1)![0].yaw).toBeLessThan(0);
    vc.rotate('down');
    expect(apply.mock.calls.at(-1)![0].pitch).toBeLessThan(0);
    vc.reset();
    expect(apply).toHaveBeenLastCalledWith({ zoom: 1, yaw: 0, pitch: 0 });
    useWorldStore.setState({ globe: null });
    expect(resolveViewControls({ ...base, engineWorld: {} }).zoomOff).not.toBeNull();
  });

  it('a star the engine draws has no zoom or turn and says so', () => {
    const vc = resolveViewControls({ ...base, engineStar: {} });
    expect(vc.zoomOff).toMatch(/star view/);
    expect(vc.rotateOff).not.toBeNull();
    expect(vc.resetOff).not.toBeNull();
  });

  it('a rock turns and resets but cannot zoom', () => {
    const rockView = { rotate: vi.fn(), resetPose: vi.fn() } as unknown as RockView;
    const vc = resolveViewControls({ ...base, rockView, rockKind: true });
    expect(vc.zoomOff).toMatch(/cannot zoom/);
    expect(vc.rotateOff).toBeNull();
    vc.rotate('up');
    vc.reset();
    expect(rockView.rotate).toHaveBeenCalledWith('up');
    expect(rockView.resetPose).toHaveBeenCalled();
  });
});

describe('failure keys (no sticky flags)', () => {
  it('a failure belongs to one card and preset, so the next object is tried afresh', () => {
    useWorldStore.getState().fail(engineKey('card-a', 'trappist-1e'));
    const failed = useWorldStore.getState().failedId;
    expect(failed).toBe(engineKey('card-a', 'trappist-1e'));
    expect(failed).not.toBe(engineKey('card-b', 'trappist-1e'));
    expect(failed).not.toBe(engineKey('card-a', 'jupiter'));
    useWorldStore.getState().failStar(engineKey('card-s', 'sun'));
    expect(useWorldStore.getState().starFailedId).not.toBe(engineKey('card-t', 'sun'));
  });
});
