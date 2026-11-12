// Issue #71 stream G, D-36: the star close-up of the mock-up's build split (closeup-star.html): a
// flare seen at the edge of the star, the star's own surface shader below it and plasma along the
// arches above. Pure three r187 objects: no renderer, so it is testable. The component
// (`app/StarCloseUp.tsx`) owns the renderer and the clock.
//
// Frame: the bipole sits at the north pole of the star body, seen from +z with an orthographic
// camera whose window is VIEW_HALF_H stellar radii tall (the prototype's V.h = 0.17), so the limb
// runs across the bottom of the picture. Every frame is a pure function of (stage time, kind, class).
//
// Method (Q-271): the prototype accumulates streaks into density and density-times-temperature
// render targets and blurs them. This scene draws each streak as a coloured additive line, the same
// as the globe's `StarPlasma`; a render-target pass is a drop-in replacement for `streaks` below.
import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  DynamicDrawUsage,
  Group,
  LineBasicNodeMaterial,
  LineSegments,
  Mesh,
  MeshBasicNodeMaterial,
  NoBlending,
  OrthographicCamera,
  PlaneGeometry,
  Scene,
  type Material,
  type Texture,
} from 'three/webgpu';
import { positionGeometry, screenUV, texture, vec4 } from 'three/tsl';
import { CLASS_STRENGTH, StreakSink, emitStage, groupPoint, type Mapper } from '@/physics/flares';
import {
  AREA_SPLIT,
  cellsForScale,
  discRadiusFromArea,
  granuleVisibility,
  type SpotGroup,
  type StellarModel,
  type Vec3,
} from '@/physics/stellar';
import { STAR_SURFACE, STILL_STAR_RATES, configFromModel } from '../bodies/starModel';
import type { StarSurfacePlan } from '../planTypes';
import { StarBody } from './StarBody';
import { uploadUsed } from './StarPlasma';
import { srgbToLinear } from './linearColour';
import type { TierName } from '../render/quality';

/** Window height (half) in stellar radii and where its centre sits (prototype: V.h, V.off). */
export const VIEW_HALF_H = 0.17;
export const VIEW_CENTRE_Y = 1.085;
/** Tilt of the polarity axis out of the east direction (the prototype's view skew, artistic). */
export const AXIS_TILT_RAD = (25 * Math.PI) / 180;
export type FlareClass = keyof typeof CLASS_STRENGTH;

/** What the close-up needs from a star plan (see `closeUpFor`). */
export interface StarCloseUpProps {
  physics: StellarModel;
  /** Linear-sRGB tint of the star, and its brightness and limb-darkening value, as the globe uses. */
  tint: readonly [number, number, number];
  emissive: number;
  limbU: number | null;
  seed: number;
  /** The flare being shown: kind and energy (from `FlareEvent`), or null for the default (open, X). */
  flare: { open: boolean; energyErg: number } | null;
}

/** C, M or X from the energy (same scale as `flareClass`). */
export function classOfEnergy(e: number): FlareClass {
  return e >= 1e31 ? 'x' : e >= 1e30 ? 'm' : 'c';
}

/** The single bipole the close-up draws, at the star's north pole (a display choice, artistic). */
export function closeUpGroup(): SpotGroup {
  const lat = 1.5;
  const lon = Math.PI / 2;
  const c: Vec3 = [Math.cos(lat) * Math.cos(lon), Math.sin(lat), Math.cos(lat) * Math.sin(lon)];
  const east: Vec3 = [-Math.sin(lon), 0, Math.cos(lon)];
  const north: Vec3 = [
    -Math.sin(lat) * Math.cos(lon),
    Math.cos(lat),
    -Math.sin(lat) * Math.sin(lon),
  ];
  const k = AXIS_TILT_RAD;
  const axis: Vec3 = [
    east[0] * Math.cos(k) + north[0] * Math.sin(k),
    east[1] * Math.cos(k) + north[1] * Math.sin(k),
    east[2] * Math.cos(k) + north[2] * Math.sin(k),
  ];
  const cross: Vec3 = [
    -east[0] * Math.sin(k) + north[0] * Math.cos(k),
    -east[1] * Math.sin(k) + north[1] * Math.cos(k),
    -east[2] * Math.sin(k) + north[2] * Math.cos(k),
  ];
  const area = 3e-4;
  return {
    id: 0,
    hemisphere: 1,
    latRad: lat,
    lonRad: lon,
    centre: c,
    polarityAxis: axis,
    crossAxis: cross,
    separationRad: 0.1,
    areaFraction: area,
    tiltRad: k,
    leader: { centre: c, radiusRad: discRadiusFromArea(area * AREA_SPLIT.leader) },
    follower: { centre: c, radiusRad: discRadiusFromArea(area * AREA_SPLIT.follower) },
    pores: [],
  };
}

export class StarCloseUpScene {
  readonly scene = new Scene();
  readonly camera = new OrthographicCamera(-1, 1, 1, -1, 0.1, 20);
  readonly group = closeUpGroup();
  private readonly star: StarBody;
  private readonly sink = new StreakSink(40000);
  private readonly geometry = new BufferGeometry();
  private readonly material: LineBasicNodeMaterial;
  private readonly pos: BufferAttribute;
  private readonly col: BufferAttribute;
  private readonly at: Mapper;
  private open = true;
  private cls: FlareClass = 'x';
  private readonly root = new Group();
  private readonly lines: LineSegments;
  private readonly starMaterial: Material;
  private readonly stillQuad: Mesh;
  /** Writes the sphere's depth only, while the cached picture stands in for its colour. */
  private readonly depthOnly = new MeshBasicNodeMaterial({ colorWrite: false });
  private stillTex: Texture | null = null;
  private mode: StillMode = 'live';
  /** Goes up whenever the picture of the star changes (the window shape): a cached picture is then stale. */
  viewVersion = 0;

  constructor(p: StarCloseUpProps, tier: TierName = 'medium') {
    const model: StellarModel = { ...p.physics, groups: [this.group] };
    const cells = cellsForScale(model, 'close');
    const plan: StarSurfacePlan = {
      seed: p.seed,
      granulation: true,
      spots: true,
      faculae: true,
      flares: false,
      prominences: false,
      strands: false,
      glow: false,
      rates: STILL_STAR_RATES,
      physics: model,
      config: configFromModel(model, STAR_SURFACE),
      colourView: 'enhanced',
      scale: 'close',
      cellsAcross: cells.cells,
      granuleVisibility: granuleVisibility(cells.cells, VIEW_HALF_H),
      cellsEnlarged: false,
      plasma: false,
    };
    this.star = new StarBody(plan, {
      tint: srgbToLinear([p.tint[0], p.tint[1], p.tint[2]]),
      emissive: p.emissive,
      limbU: p.limbU,
      octaves: tier === 'low' ? 3 : 4,
      axes: [1, 1, 1],
      segments: [128, 64],
      tier,
    });
    this.star.setTime(() => 0);
    this.root.add(this.star.group);
    this.pos = new BufferAttribute(this.sink.pos, 3).setUsage(DynamicDrawUsage);
    this.col = new BufferAttribute(this.sink.col, 3).setUsage(DynamicDrawUsage);
    this.geometry.setAttribute('position', this.pos);
    this.geometry.setAttribute('color', this.col);
    this.material = new LineBasicNodeMaterial({
      vertexColors: true,
      transparent: true,
      blending: AdditiveBlending,
      depthWrite: false,
      depthTest: true,
    });
    const lines = new LineSegments(this.geometry, this.material);
    lines.frustumCulled = false;
    lines.renderOrder = 2;
    this.lines = lines;
    this.root.add(lines);
    this.scene.add(this.root);
    this.starMaterial = this.star.sphere.material as Material;
    // The cached picture (issue #93 W1, see setStill): a full-screen quad drawn first, read pixel for pixel. No blending
    // (so r187 does not treat it as opaque and force alpha to 1): it writes the picture's colour and alpha as they are.
    const still = new MeshBasicNodeMaterial({
      depthTest: false,
      depthWrite: false,
      blending: NoBlending,
    });
    still.vertexNode = vec4(positionGeometry.xy, 0, 1);
    this.stillQuad = new Mesh(new PlaneGeometry(2, 2), still);
    this.stillQuad.frustumCulled = false;
    this.stillQuad.renderOrder = -1;
    this.stillQuad.visible = false;
    this.scene.add(this.stillQuad);
    const g = this.group;
    this.at = (a, l, h) => groupPoint(g, a, l, h);
    this.setFlare(p.flare);
    this.setAspect(1.6);
  }

  /** The flare shown: its kind and class (null: open, class X, the mock-up's default). */
  setFlare(f: { open: boolean; energyErg: number } | null): void {
    this.open = f ? f.open : true;
    this.cls = f ? classOfEnergy(f.energyErg) : 'x';
  }
  get flareKind(): { open: boolean; cls: FlareClass } {
    return { open: this.open, cls: this.cls };
  }

  /** Window shape: the height is fixed in stellar radii, the width follows the aspect ratio. */
  setAspect(aspect: number): void {
    const c = this.camera;
    c.left = -VIEW_HALF_H * aspect;
    c.right = VIEW_HALF_H * aspect;
    c.top = VIEW_CENTRE_Y + VIEW_HALF_H;
    c.bottom = VIEW_CENTRE_Y - VIEW_HALF_H;
    c.position.set(0, 0, 5);
    c.lookAt(0, 0, 0);
    c.updateProjectionMatrix();
    this.viewVersion++;
  }

  /**
   * Issue #93 W1 (render notes 1.12): the star below the flare never moves here (its clock is held at 0, STILL rates),
   * yet its surface shader (granulation, faculae, spots) ran for every pixel of every frame. A host can draw it once
   * into a texture (`bake`: the star alone, as it would be drawn) and then show that texture (`cached`): a full-screen
   * quad behind the plasma, while the sphere writes depth only, so the loops behind the limb stay hidden as before.
   * `live` is the old path. The picture is the same up to the half-float rounding of the sum (see the W1 report).
   */
  setStill(mode: StillMode, tex: Texture | null = null): void {
    if (mode === 'cached' && !tex) throw new Error('setStill: the cached mode needs the texture');
    this.mode = mode;
    const sphere = this.star.sphere;
    sphere.material = mode === 'cached' ? this.depthOnly : this.starMaterial;
    this.lines.visible = mode !== 'bake';
    this.stillQuad.visible = mode === 'cached';
    if (mode === 'cached' && tex !== this.stillTex) {
      this.stillTex = tex;
      const m = this.stillQuad.material as MeshBasicNodeMaterial;
      m.colorNode = texture(tex!, screenUV);
      m.needsUpdate = true;
    }
  }
  get stillMode(): StillMode {
    return this.mode;
  }

  /** Poses the plasma at stage time t (0..1 of the 60 minutes shown). Pure in (t, kind, class). */
  setStage(t: number, q = 1): void {
    this.sink.reset();
    emitStage(this.sink, this.at, t, { open: this.open, strength: CLASS_STRENGTH[this.cls], q });
    // Issue #93 W1 (0.6): only the streaks in use are uploaded (the buffers hold 40,000, about 1.9 MB).
    uploadUsed(this.pos, this.sink.n * 6);
    uploadUsed(this.col, this.sink.n * 6);
    this.geometry.setDrawRange(0, this.sink.n * 2);
  }
  get streakCount(): number {
    return this.sink.n;
  }

  /** The text on the picture, from the mock-up: kind, class and energy, and what the light is. */
  get caption(): string {
    const e = { c: 'about 10²⁹ erg', m: 'about 10³⁰ erg', x: 'about 10³¹ erg or more' };
    return `${this.open ? 'Open (eruptive)' : 'Closed (confined)'} · Class ${this.cls.toUpperCase()}, ${e[this.cls]} · Hydrogen-alpha with hot loops`;
  }

  dispose(): void {
    this.star.dispose();
    this.geometry.dispose();
    this.material.dispose();
    this.depthOnly.dispose();
    this.stillQuad.geometry.dispose();
    (this.stillQuad.material as Material).dispose();
  }
}

/** How the star below the flare is drawn (see `StarCloseUpScene.setStill`). */
export type StillMode = 'live' | 'bake' | 'cached';
