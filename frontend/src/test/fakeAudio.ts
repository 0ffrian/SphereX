// Test helper (src/test/ is test-only code): a minimal recording AudioContext, enough for the
// audio driver and the sound modules. It never makes a sound. App modules must never import this.

export class FakeParam {
  value = 0;
  readonly calls: [string, number, number][] = [];
  setValueAtTime(v: number, t: number) {
    this.calls.push(['set', v, t]);
    return this;
  }
  linearRampToValueAtTime(v: number, t: number) {
    this.calls.push(['linear', v, t]);
    return this;
  }
  exponentialRampToValueAtTime(v: number, t: number) {
    this.calls.push(['exp', v, t]);
    return this;
  }
  setTargetAtTime(v: number, t: number) {
    this.calls.push(['target', v, t]);
    return this;
  }
  cancelScheduledValues(t: number) {
    this.calls.push(['cancel', 0, t]);
    return this;
  }
}

export class FakeNode {
  readonly outputs: FakeNode[] = [];
  disconnected = false;
  constructor(
    readonly ctx: FakeAudioContext,
    readonly nodeType: string,
  ) {
    ctx.nodes.push(this);
  }
  connect(n: FakeNode) {
    this.outputs.push(n);
    return n;
  }
  disconnect() {
    this.disconnected = true;
    this.outputs.length = 0;
  }
}

export class FakeGain extends FakeNode {
  readonly gain = new FakeParam();
  constructor(ctx: FakeAudioContext) {
    super(ctx, 'gain');
  }
}

export class FakeSource extends FakeNode {
  startAt: number | null = null;
  stopAt: number | null = null;
  stopCalls = 0;
  onended: (() => void) | null = null;
  type = 'sine';
  buffer: unknown = null;
  readonly frequency = new FakeParam();
  /** Simulate the source finishing. */
  end() {
    this.onended?.();
  }
  start(t = 0) {
    this.startAt = t;
  }
  stop(t = 0) {
    this.stopCalls++;
    this.stopAt = t;
  }
}

export class FakeFilter extends FakeNode {
  type = 'lowpass';
  readonly frequency = new FakeParam();
  readonly Q = new FakeParam();
  constructor(ctx: FakeAudioContext) {
    super(ctx, 'biquad');
  }
}

export class FakePanner extends FakeNode {
  readonly pan = new FakeParam();
  constructor(ctx: FakeAudioContext) {
    super(ctx, 'panner');
  }
}

export class FakeCompressor extends FakeNode {
  readonly threshold = new FakeParam();
  readonly knee = new FakeParam();
  readonly ratio = new FakeParam();
  readonly attack = new FakeParam();
  readonly release = new FakeParam();
  constructor(ctx: FakeAudioContext) {
    super(ctx, 'compressor');
  }
}

export interface FakeAudioOptions {
  state?: AudioContextState;
  outputLatency?: number;
  stereoPanner?: boolean;
  compressor?: boolean;
}

export class FakeAudioContext {
  state: AudioContextState;
  currentTime = 0;
  readonly sampleRate = 8000;
  readonly outputLatency: number | undefined;
  readonly nodes: FakeNode[] = [];
  readonly destination: FakeNode;
  resumes = 0;
  createStereoPanner?: () => FakePanner;
  createDynamicsCompressor?: () => FakeCompressor;

  constructor(options: FakeAudioOptions = {}) {
    this.state = options.state ?? 'running';
    this.outputLatency = options.outputLatency;
    this.destination = new FakeNode(this, 'destination');
    if (options.stereoPanner !== false) this.createStereoPanner = () => new FakePanner(this);
    if (options.compressor !== false) {
      this.createDynamicsCompressor = () => new FakeCompressor(this);
    }
  }

  async resume() {
    this.resumes++;
    this.state = 'running';
  }
  createGain() {
    return new FakeGain(this);
  }
  createOscillator() {
    return new FakeSource(this, 'oscillator');
  }
  createBufferSource() {
    return new FakeSource(this, 'bufferSource');
  }
  createBiquadFilter() {
    return new FakeFilter(this);
  }
  createBuffer(_channels: number, length: number, sampleRate: number) {
    const data = new Float32Array(length);
    return { length, sampleRate, getChannelData: () => data };
  }

  async close() {
    this.state = 'closed';
  }

  /** Every source node created, in order. */
  sources(): FakeSource[] {
    return this.nodes.filter((n): n is FakeSource => n instanceof FakeSource);
  }

  /** The cast the app code needs. */
  asAudioContext(): AudioContext {
    return this as unknown as AudioContext;
  }
}
