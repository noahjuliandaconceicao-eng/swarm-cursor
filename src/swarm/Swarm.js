import {
  WebGLRenderer,
  Scene,
  PerspectiveCamera,
  BufferGeometry,
  BufferAttribute,
  ShaderMaterial,
  Points,
  AdditiveBlending,
  Matrix4,
  Euler,
} from 'three';
import { vertexShader, fragmentShader } from './shaders.js';

const FOV = 50;
const SPREAD = 0.45; // how much of a transition is spent on staggered departures
const HIST = 64; // cursor-trail history length (frames)
const TAU = Math.PI * 2;

const _m = new Matrix4();
const _e = new Euler();

/**
 * The swarm: one THREE.Points draw call over a BufferGeometry whose positions
 * are integrated every frame on the CPU (spring → formation target + cursor
 * forces). Targets are blended between formations by a scroll-driven `s`.
 */
export class Swarm {
  constructor(canvas, { count, reducedMotion = false }) {
    this.N = count;
    this.count = count;
    this.reduced = reducedMotion;
    this.formations = [];
    this.state = { s: 1, intro: reducedMotion ? 1 : 0, opacity: 1 };
    this.followMix = 0;
    this.scatter = 0;
    this.time = 0;
    this.perf = { frames: 0, acc: 0, cuts: 0 };
    this.onQualityChange = null;
    this.adaptive = true;

    this.pointer = {
      x: 0, y: 0, sx: 0, sy: 0, px: 0, py: 0, vx: 0, vy: 0,
      nx: 0, ny: 0, active: false, seen: false,
      hist: new Float32Array(HIST * 2), hi: 0,
    };

    this.renderer = new WebGLRenderer({
      canvas,
      antialias: false,
      alpha: false,
      powerPreference: 'high-performance',
      stencil: false,
      depth: false,
    });
    this.renderer.setClearColor(0x050506, 1);

    this.scene = new Scene();
    this.camera = new PerspectiveCamera(FOV, 1, 1, 10000);

    this.#buildGeometry();
    this.setCount(count);
  }

  #buildGeometry() {
    const N = this.N;
    this.pos = new Float32Array(N * 3);
    this.vel = new Float32Array(N * 3);
    this.speed = new Float32Array(N);
    this.seed = new Float32Array(N);
    this.stiff = new Float32Array(N);
    const size = new Float32Array(N);
    const tint = new Float32Array(N * 3);

    const warm = [0.93, 0.91, 0.88];
    const ember = [1.0, 0.42, 0.28];
    const cold = [0.55, 0.68, 1.0];
    for (let i = 0; i < N; i++) {
      const r = Math.random();
      this.seed[i] = r;
      this.stiff[i] = 0.022 + Math.random() * 0.04; // varied inertia = organic lag
      size[i] = 1.25 + Math.pow(Math.random(), 3) * 2.2;
      const c = Math.random();
      const col = c < 0.07 ? ember : c < 0.1 ? cold : warm;
      tint.set(col, i * 3);
    }

    const g = new BufferGeometry();
    this.posAttr = new BufferAttribute(this.pos, 3).setUsage(35048); // DynamicDraw
    this.speedAttr = new BufferAttribute(this.speed, 1).setUsage(35048);
    g.setAttribute('position', this.posAttr);
    g.setAttribute('aSpeed', this.speedAttr);
    g.setAttribute('aSize', new BufferAttribute(size, 1));
    g.setAttribute('aSeed', new BufferAttribute(this.seed, 1));
    g.setAttribute('aTint', new BufferAttribute(tint, 3));
    g.setDrawRange(0, this.count);
    this.geometry = g;

    this.material = new ShaderMaterial({
      vertexShader,
      fragmentShader,
      transparent: true,
      depthTest: false,
      depthWrite: false,
      blending: AdditiveBlending,
      uniforms: {
        uPixelRatio: { value: 1 },
        uFocus: { value: 1000 },
        uAperture: { value: 3.2 },
        uTime: { value: 0 },
        uScale: { value: 1 },
        uOpacity: { value: 1 },
      },
    });

    this.points = new Points(g, this.material);
    this.points.frustumCulled = false;
    this.scene.add(this.points);
  }

  resize(W, H, dpr) {
    this.W = W;
    this.H = H;
    this.u = H / 900; // force/size unit so behaviour is resolution independent
    this.renderer.setPixelRatio(dpr);
    this.renderer.setSize(W, H, false);
    this.camera.aspect = W / H;
    this.D = H / 2 / Math.tan((FOV * Math.PI) / 360); // 1 world unit == 1 CSS px at z = 0
    this.camera.position.set(0, 0, this.D);
    this.camera.far = this.D * 6;
    this.camera.updateProjectionMatrix();
    this.material.uniforms.uPixelRatio.value = dpr;
    this.material.uniforms.uFocus.value = this.D;
    this.material.uniforms.uScale.value = Math.min(1.25, Math.max(0.85, Math.sqrt(W * H) / 1100));
  }

  /** formations[0] is the spawn cloud, formations[1] the hero; `s` runs 1..last. */
  setFormations(list, { reseed = false } = {}) {
    this.formations = list;
    if (reseed) {
      this.pos.set(list[0].pos);
      this.vel.fill(0);
    }
  }

  setCount(n) {
    this.count = Math.max(Math.min(this.N, 2500), Math.min(this.N, n | 0));
    this.geometry.setDrawRange(0, this.count);
    this.followers = Math.floor(this.count * 0.012);
  }

  // ───────── pointer ─────────

  pointerMove(clientX, clientY) {
    const p = this.pointer;
    p.x = clientX - this.W / 2;
    p.y = this.H / 2 - clientY;
    if (!p.seen) {
      p.sx = p.px = p.x;
      p.sy = p.py = p.y;
      for (let i = 0; i < HIST; i++) {
        p.hist[i * 2] = p.x;
        p.hist[i * 2 + 1] = p.y;
      }
    }
    p.seen = true;
    p.active = true;
  }

  pointerLeave() {
    this.pointer.active = false;
  }

  #rotation(f, time) {
    if (!f.rot) return null;
    const [x, y, z] = f.rot(time, this.pointer.nx, this.pointer.ny);
    _m.makeRotationFromEuler(_e.set(x, y, z));
    return _m.elements.slice(0); // copy: two formations may rotate per frame
  }

  update(dt) {
    const F = this.formations;
    if (F.length < 2) return;
    const f = Math.min(dt * 60, 3); // frame-rate normalisation
    this.time += dt;
    const time = this.time;
    const { H, u, reduced } = this;
    const p = this.pointer;

    // Cursor: smoothed position (the "delay"), velocity, trail history.
    const lerp = 1 - Math.pow(1 - 0.2, f);
    p.px = p.sx;
    p.py = p.sy;
    p.sx += (p.x - p.sx) * lerp;
    p.sy += (p.y - p.sy) * lerp;
    p.vx = (p.sx - p.px) / f;
    p.vy = (p.sy - p.py) / f;
    p.hi = (p.hi + 1) % HIST;
    p.hist[p.hi * 2] = p.sx;
    p.hist[p.hi * 2 + 1] = p.sy;
    const tnx = p.seen ? p.x / (this.W / 2) : 0;
    const tny = p.seen ? p.y / (this.H / 2) : 0;
    p.nx += (tnx - p.nx) * 0.04 * f;
    p.ny += (tny - p.ny) * 0.04 * f;
    const cSpeed = Math.hypot(p.vx, p.vy) / u;
    const scatterT = Math.min(1, Math.max(0, (cSpeed - 7) / 30));
    this.scatter += (scatterT - this.scatter) * (scatterT > this.scatter ? 0.5 : 0.06);
    const interact = p.active && !reduced;
    this.followMix += ((interact ? 1 : 0) - this.followMix) * 0.035 * f;

    // Which two formations are we between?
    const last = F.length - 1;
    const s = Math.min(Math.max(this.state.s, 1), last);
    const a = Math.min(Math.floor(s), last);
    const b = Math.min(a + 1, last);
    const t = s - a;
    const FA = F[a];
    const FB = F[b];
    const mA = this.#rotation(FA, time);
    const mB = this.#rotation(FB, time);
    const intro = this.state.intro;
    const SP = F[0].pos;
    const HD = F[1].delay;

    const pos = this.pos;
    const vel = this.vel;
    const seed = this.seed;
    const stiff = this.stiff;
    const speed = this.speed;
    const count = this.count;
    const followers = this.followers;
    const fm = this.followMix;

    const damp = Math.pow(reduced ? 0.7 : 0.87, f);
    const flowAmp = reduced ? 0 : H * 0.16;
    const fq = 3.2 / H;
    const jit = reduced ? 0 : 1.3 * u;
    const R = 165 * u;
    const R2 = R * R;
    const r0 = R * 0.3;
    const MAG = 1.25 * u;
    const SWIRL = 1.1 * u;
    const SCAT = 10 * u * this.scatter;
    const DRAG = 0.07;
    const kMul = reduced ? 3 : 1;
    const depthNorm = 1 / (H * 0.35);

    for (let i = 0; i < count; i++) {
      const i3 = i * 3;
      const sd = seed[i];

      // Source & destination targets (rotated if the formation spins).
      let ax = FA.pos[i3], ay = FA.pos[i3 + 1], az = FA.pos[i3 + 2];
      if (mA && !FA.amb[i]) {
        const x = ax, y = ay, z = az;
        ax = mA[0] * x + mA[4] * y + mA[8] * z;
        ay = mA[1] * x + mA[5] * y + mA[9] * z;
        az = mA[2] * x + mA[6] * y + mA[10] * z;
      }
      let bx = FB.pos[i3], by = FB.pos[i3 + 1], bz = FB.pos[i3 + 2];
      if (mB && !FB.amb[i]) {
        const x = bx, y = by, z = bz;
        bx = mB[0] * x + mB[4] * y + mB[8] * z;
        by = mB[1] * x + mB[5] * y + mB[9] * z;
        bz = mB[2] * x + mB[6] * y + mB[10] * z;
      }

      // Staggered, eased progress for this particle.
      let tp = (t - FB.delay[i] * SPREAD) / (1 - SPREAD);
      tp = tp < 0 ? 0 : tp > 1 ? 1 : tp;
      const e = tp * tp * tp * (tp * (tp * 6 - 15) + 10); // smootherstep

      let x = ax + (bx - ax) * e;
      let y = ay + (by - ay) * e;
      let z = az + (bz - az) * e;

      // Mid-flight: swing through depth and ride a flow field instead of a straight line.
      if (flowAmp && e > 0 && e < 1) {
        const m = Math.sin(Math.PI * e);
        const ang = m * (0.25 + sd * 0.55) * (i & 1 ? 1 : -1);
        const c = Math.cos(ang), sn = Math.sin(ang);
        const rx = x * c - z * sn;
        z = x * sn + z * c;
        x = rx;
        const amp = flowAmp * m;
        const ox = Math.sin(y * fq + time * 0.6 + sd * TAU) + Math.sin(z * fq * 1.3 - time * 0.4);
        const oy = Math.sin(z * fq + time * 0.5 + sd * 9.0) + Math.sin(x * fq * 1.2 + time * 0.3);
        const oz = Math.sin(x * fq - time * 0.45 + sd * 5.0) + Math.sin(y * fq * 1.1 + time * 0.35);
        x += ox * amp * 0.5;
        y += oy * amp * 0.5;
        z += oz * amp * 0.9;
      }

      // Living stillness: shimmer in place, dust drifts.
      if (jit) {
        const ph = sd * 60;
        x += Math.sin(time * 0.9 + ph) * jit;
        y += Math.cos(time * 0.77 + ph * 1.3) * jit;
        z += Math.sin(time * 0.6 + ph * 0.7) * jit * 4;
        if (FB.amb[i]) {
          x += Math.sin(time * 0.11 + ph) * H * 0.04;
          y += Math.cos(time * 0.09 + ph * 0.5) * H * 0.03;
        }
      }

      // Load-in: gather from the spawn shell, centre-out.
      if (intro < 1) {
        let ip = (intro * 1.8 - HD[i] * 0.8);
        ip = ip < 0 ? 0 : ip > 1 ? 1 : ip;
        const ie = 1 - Math.pow(1 - ip, 3);
        x = SP[i3] + (x - SP[i3]) * ie;
        y = SP[i3 + 1] + (y - SP[i3 + 1]) * ie;
        z = SP[i3 + 2] + (z - SP[i3 + 2]) * ie;
      }

      let k = stiff[i] * kMul;

      // Comet: a small cohort peels off and trails the cursor with orbiting delay.
      if (i < followers && fm > 0.001) {
        const lag = (2 + (i / followers) * 48) | 0;
        const hIdx = ((p.hi - lag + HIST) % HIST) * 2;
        const oa = time * (1.2 + sd * 2.2) + sd * TAU * 7;
        const orad = (5 + sd * 30 + (i / followers) * 26) * u * (1 + this.scatter * 2);
        const fx = p.hist[hIdx] + Math.cos(oa) * orad;
        const fy = p.hist[hIdx + 1] + Math.sin(oa) * orad;
        const fz = Math.sin(oa * 0.7) * 40 * u;
        x += (fx - x) * fm;
        y += (fy - y) * fm;
        z += (fz - z) * fm;
        k = k + (0.11 - k) * fm;
      }

      // Spring toward target, with inertia.
      let vx = vel[i3] * damp + (x - pos[i3]) * k * f;
      let vy = vel[i3 + 1] * damp + (y - pos[i3 + 1]) * k * f;
      let vz = vel[i3 + 2] * damp + (z - pos[i3 + 2]) * k * f;

      // Cursor field: magnetic ring + vortex + wake drag; scatter on fast moves.
      if (interact && i >= followers) {
        const dx = pos[i3] - p.sx;
        const dy = pos[i3 + 1] - p.sy;
        const d2 = dx * dx + dy * dy;
        if (d2 < R2 && d2 > 0.01) {
          const d = Math.sqrt(d2);
          const zf = 1 / (1 + Math.abs(pos[i3 + 2]) * depthNorm);
          const fall = (1 - d / R) * zf * f;
          const nx = dx / d, ny = dy / d;
          const pull = ((d - r0) / R) * MAG * (1 - this.scatter);
          vx += (-nx * pull + -ny * SWIRL + p.vx * DRAG) * fall;
          vy += (-ny * pull + nx * SWIRL + p.vy * DRAG) * fall;
          if (SCAT > 0.01) {
            const sc = SCAT * fall * (1 - d / R);
            vx += nx * sc;
            vy += ny * sc;
            vz += (sd - 0.5) * sc * 3;
          }
        }
      }

      vel[i3] = vx;
      vel[i3 + 1] = vy;
      vel[i3 + 2] = vz;
      pos[i3] += vx * f;
      pos[i3 + 1] += vy * f;
      pos[i3 + 2] += vz * f;

      const sp = Math.sqrt(vx * vx + vy * vy + vz * vz) / (14 * u);
      speed[i] += ((sp > 1 ? 1 : sp) - speed[i]) * 0.2;
    }

    this.posAttr.needsUpdate = true;
    this.speedAttr.needsUpdate = true;
    this.posAttr.clearUpdateRanges?.();
    this.posAttr.addUpdateRange?.(0, count * 3);
    this.speedAttr.clearUpdateRanges?.();
    this.speedAttr.addUpdateRange?.(0, count);

    const un = this.material.uniforms;
    un.uTime.value = time;
    un.uOpacity.value = this.state.opacity;

    this.#adapt(dt);
  }

  /** Drop particle count / pixel ratio if the device can't hold ~50 fps. */
  #adapt(dt) {
    if (!this.adaptive) return;
    const pf = this.perf;
    pf.frames++;
    if (pf.frames < 40) return; // ignore warm-up
    pf.acc += dt;
    if (pf.frames < 160) return;
    const avg = pf.acc / 120;
    pf.frames = 40;
    pf.acc = 0;
    if (avg > 1 / 48 && pf.cuts < 4) {
      pf.cuts++;
      // Fill-rate is usually the bottleneck: drop resolution first, then particles.
      const dpr = this.renderer.getPixelRatio();
      if (dpr > 1.01) this.resize(this.W, this.H, Math.max(1, dpr * 0.7));
      else this.setCount(Math.max(this.N * 0.4, this.count * (avg > 1 / 30 ? 0.65 : 0.8)));
      this.onQualityChange?.(this.count);
    }
  }

  render() {
    this.renderer.render(this.scene, this.camera);
  }

  dispose() {
    this.geometry.dispose();
    this.material.dispose();
    this.renderer.dispose();
  }
}
