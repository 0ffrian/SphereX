// R5.6 viewer controls: zoom/rotate step helpers and the keyboard map, tested against real r187
// OrbitControls (no renderer or DOM element needed).
import { describe, expect, it } from 'vitest';
import { PerspectiveCamera } from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { rotateControls, viewerKeyAction, zoomControls } from './ViewerApp';

const START_DISTANCE = 4;

function makeControls() {
  const camera = new PerspectiveCamera(40, 1, 0.1, 100);
  camera.position.set(0, 0, START_DISTANCE);
  const controls = new OrbitControls(camera);
  controls.minDistance = 1.5;
  controls.maxDistance = 20;
  let changes = 0;
  controls.addEventListener('change', () => changes++);
  return { camera, controls, changes: () => changes };
}

describe('zoomControls', () => {
  it('"in" moves the camera closer and emits one change', () => {
    const { camera, controls, changes } = makeControls();
    zoomControls(controls, 'in');
    expect(camera.position.length()).toBeLessThan(START_DISTANCE);
    expect(changes()).toBe(1);
  });

  it('"out" moves the camera further away', () => {
    const { camera, controls } = makeControls();
    zoomControls(controls, 'out');
    expect(camera.position.length()).toBeGreaterThan(START_DISTANCE);
  });

  it('"in" then "out" returns to the start distance', () => {
    const { camera, controls } = makeControls();
    zoomControls(controls, 'in');
    zoomControls(controls, 'out');
    expect(camera.position.length()).toBeCloseTo(START_DISTANCE, 6);
  });
});

describe('rotateControls', () => {
  it('left and right orbit in opposite directions at a constant distance', () => {
    const left = makeControls();
    const right = makeControls();
    rotateControls(left.controls, 'left');
    rotateControls(right.controls, 'right');
    expect(left.changes()).toBe(1);
    expect(Math.sign(left.camera.position.x)).toBe(-Math.sign(right.camera.position.x));
    expect(left.camera.position.x).not.toBeCloseTo(0, 3);
    expect(left.camera.position.length()).toBeCloseTo(START_DISTANCE, 6);
  });

  it('up and down orbit in opposite directions', () => {
    const up = makeControls();
    const down = makeControls();
    rotateControls(up.controls, 'up');
    rotateControls(down.controls, 'down');
    expect(up.camera.position.y).not.toBeCloseTo(0, 3);
    expect(Math.sign(up.camera.position.y)).toBe(-Math.sign(down.camera.position.y));
  });
});

type Mods = Partial<Pick<KeyboardEvent, 'ctrlKey' | 'metaKey' | 'altKey'>>;

describe('viewerKeyAction (R5.6 keyboard)', () => {
  const key = (k: string, mods: Mods = {}) =>
    viewerKeyAction({ key: k, ctrlKey: false, metaKey: false, altKey: false, ...mods });

  it('maps arrows, +/− and R', () => {
    expect(key('ArrowLeft')).toEqual({ kind: 'rotate', direction: 'left' });
    expect(key('ArrowDown')).toEqual({ kind: 'rotate', direction: 'down' });
    expect(key('+')).toEqual({ kind: 'zoom', direction: 'in' });
    expect(key('=')).toEqual({ kind: 'zoom', direction: 'in' });
    expect(key('-')).toEqual({ kind: 'zoom', direction: 'out' });
    expect(key('r')).toEqual({ kind: 'reset' });
    expect(key('R')).toEqual({ kind: 'reset' });
  });

  it('ignores keys it does not own', () => {
    expect(key('a')).toBeNull();
    expect(key('Tab')).toBeNull();
  });

  it('leaves browser shortcuts alone (Ctrl+R reload, Ctrl/Cmd +/− page zoom)', () => {
    expect(key('r', { ctrlKey: true })).toBeNull();
    expect(key('R', { metaKey: true })).toBeNull();
    expect(key('=', { ctrlKey: true })).toBeNull();
    expect(key('-', { metaKey: true })).toBeNull();
    expect(key('ArrowLeft', { altKey: true })).toBeNull();
  });
});
