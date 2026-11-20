import { IcosahedronGeometry, EdgesGeometry } from 'three';
import { sampleLayer } from './sampler.js';

// A formation is a full set of N target positions (world units == CSS pixels on
// the z = 0 plane), a per-particle arrival delay that choreographs the
// transition *into* it, and an optional rotation driven by time and the cursor.

const TAU = Math.PI * 2;

function gauss() {
  return (Math.random() + Math.random() + Math.random() + Math.random() - 2) / 2;
}

function shuffled(N) {
  const p = new Uint32Array(N);
  for (let i = 0; i < N; i++) p[i] = i;
  for (let i = N - 1; i > 0; i--) {
    const j = (Math.random() * (i + 1)) | 0;
    const t = p[i];
    p[i] = p[j];
    p[j] = t;
  }
  return p;
}

/** Deep, atmospheric dust every particle can fall back to. Fixed per particle. */
export function makeAmbient(N, W, H) {
  const a = new Float32Array(N * 3);
  for (let i = 0; i < N; i++) {
    const fg = Math.random() < 0.06; // a few near-camera bokeh specks
    a[i * 3] = (Math.random() - 0.5) * W * (fg ? 1.1 : 2.2);
    a[i * 3 + 1] = (Math.random() - 0.5) * H * (fg ? 1.1 : 2.2);
    a[i * 3 + 2] = fg ? H * (0.2 + Math.random() * 0.4) : -H * (0.15 + Math.pow(Math.random(), 0.7) * 1.6);
  }
  return a;
}

function formation(N) {
  // amb[i] = 1 marks background dust: it never rotates with the formation.
  return { pos: new Float32Array(N * 3), delay: new Float32Array(N), amb: new Uint8Array(N), rot: null };
}

function fillAmbient(f, p, ambient) {
  f.pos[p * 3] = ambient[p * 3];
  f.pos[p * 3 + 1] = ambient[p * 3 + 1];
  f.pos[p * 3 + 2] = ambient[p * 3 + 2];
  f.delay[p] = Math.random();
  f.amb[p] = 1;
}

/**
 * Build a formation from a DOM layer. `order(x, y)` returns 0..1 and decides
 * who arrives first, e.g. top-to-bottom like a page being printed.
 */
function fromLayer(layer, ctx, { ambientFrac, depth = 8, order, extra }) {
  const { N, W, H, ambient } = ctx;
  const f = formation(N);
  const perm = shuffled(N);
  const extraCount = extra ? Math.floor(N * extra.frac) : 0;
  const M = Math.floor(N * (1 - ambientFrac)) - extraCount;
  const px = sampleLayer(layer, M, W, H);
  for (let j = 0; j < N; j++) {
    const p = perm[j];
    if (j < M) {
      const x = px[j * 2] - W / 2;
      const y = H / 2 - px[j * 2 + 1];
      f.pos[p * 3] = x;
      f.pos[p * 3 + 1] = y;
      f.pos[p * 3 + 2] = gauss() * depth;
      f.delay[p] = order(px[j * 2] / W, px[j * 2 + 1] / H) * 0.7 + Math.random() * 0.3;
    } else if (j < M + extraCount) {
      extra.place(f, p, j - M, extraCount);
    } else fillAmbient(f, p, ambient);
  }
  return f;
}

// ───────────────────────── Formations ─────────────────────────

/** Where particles are born: a vast, loose shell around the camera. */
export function spawn({ N, H }) {
  const f = formation(N);
  for (let i = 0; i < N; i++) {
    const u = Math.random() * 2 - 1;
    const th = Math.random() * TAU;
    const r = H * (0.9 + Math.random() * 1.6);
    const s = Math.sqrt(1 - u * u);
    f.pos[i * 3] = Math.cos(th) * s * r;
    f.pos[i * 3 + 1] = u * r;
    f.pos[i * 3 + 2] = Math.sin(th) * s * r - H * 0.6;
    f.delay[i] = Math.random();
  }
  return f;
}

export function hero(layer, ctx) {
  return fromLayer(layer, ctx, {
    ambientFrac: 0.2,
    depth: 10,
    order: (x, y) => Math.min(1, Math.hypot(x - 0.5, (y - 0.5) * 0.7) * 1.6),
  });
}

/** A turbulent vortex nebula: the swarm with no blueprint. */
export function nebula({ N, W, H, ambient }) {
  const f = formation(N);
  const R = Math.max(W, H) * 0.55;
  for (let i = 0; i < N; i++) {
    const r = Math.random();
    if (r < 0.1) {
      fillAmbient(f, i, ambient);
      continue;
    }
    if (r < 0.72) {
      // spiral arms
      const arm = (Math.random() * 3) | 0;
      const rad = R * Math.pow(Math.random(), 0.55);
      const ang = (arm * TAU) / 3 + (rad / R) * 4.2 + gauss() * 0.45;
      f.pos[i * 3] = Math.cos(ang) * rad;
      f.pos[i * 3 + 1] = gauss() * R * 0.05 * (1.2 - rad / R);
      f.pos[i * 3 + 2] = Math.sin(ang) * rad;
    } else {
      // diffuse halo
      f.pos[i * 3] = gauss() * R * 0.8;
      f.pos[i * 3 + 1] = gauss() * R * 0.35;
      f.pos[i * 3 + 2] = gauss() * R * 0.8;
    }
    f.delay[i] = Math.random();
  }
  f.rot = (t, mx, my) => [1.08 + my * 0.12, t * 0.05 + mx * 0.25, 0.32];
  return f;
}

/** A geodesic structure: lattice edges, dense nodes, a dotted core and an orbit. */
export function structure({ N, W, H, ambient }) {
  const f = formation(N);
  const R = Math.min(W, H) * (W < H ? 0.36 : 0.31);
  const edges = new EdgesGeometry(new IcosahedronGeometry(R, 1), 1).attributes.position.array;
  const edgeCount = edges.length / 6;
  const verts = new IcosahedronGeometry(R, 1).attributes.position.array;
  const perm = shuffled(N);

  for (let j = 0; j < N; j++) {
    const i = perm[j];
    const r = j / N;
    let x, y, z;
    if (r < 0.48) {
      const e = ((Math.random() * edgeCount) | 0) * 6;
      const t = Math.random();
      x = edges[e] + (edges[e + 3] - edges[e]) * t;
      y = edges[e + 1] + (edges[e + 4] - edges[e + 1]) * t;
      z = edges[e + 2] + (edges[e + 5] - edges[e + 2]) * t;
      const j2 = R * 0.006;
      x += gauss() * j2;
      y += gauss() * j2;
      z += gauss() * j2;
    } else if (r < 0.56) {
      const v = ((Math.random() * (verts.length / 3)) | 0) * 3;
      const s = R * 0.025;
      x = verts[v] + gauss() * s;
      y = verts[v + 1] + gauss() * s;
      z = verts[v + 2] + gauss() * s;
    } else if (r < 0.76) {
      // fibonacci-ish dotted core
      const u = Math.random() * 2 - 1;
      const th = Math.random() * TAU;
      const s = Math.sqrt(1 - u * u);
      const rr = R * 0.42;
      x = Math.cos(th) * s * rr;
      y = u * rr;
      z = Math.sin(th) * s * rr;
    } else if (r < 0.88) {
      const a = Math.random() * TAU;
      const rr = R * (1.42 + gauss() * 0.02);
      x = Math.cos(a) * rr;
      y = gauss() * R * 0.012;
      z = Math.sin(a) * rr;
      // tilt the orbit
      const ty = y * Math.cos(0.5) - z * Math.sin(0.5);
      z = y * Math.sin(0.5) + z * Math.cos(0.5);
      y = ty;
    } else {
      fillAmbient(f, i, ambient);
      continue;
    }
    f.pos[i * 3] = x;
    f.pos[i * 3 + 1] = y;
    f.pos[i * 3 + 2] = z;
    f.delay[i] = Math.random() * 0.6 + (1 - Math.min(1, Math.hypot(x, y, z) / (R * 1.5))) * 0.4;
  }
  f.rot = (t, mx, my) => [0.35 + my * 0.55 + Math.sin(t * 0.2) * 0.08, t * 0.16 + mx * 0.9, 0.08];
  f.radius = R;
  return f;
}

/** The structure, detonated: same particles, flung outward along their own radius. */
export function fracture(src, { N, H }) {
  const f = formation(N);
  for (let i = 0; i < N; i++) {
    const x = src.pos[i * 3];
    const y = src.pos[i * 3 + 1];
    const z = src.pos[i * 3 + 2];
    const len = Math.hypot(x, y, z);
    if (src.amb[i]) {
      f.pos[i * 3] = x;
      f.pos[i * 3 + 1] = y;
      f.pos[i * 3 + 2] = z;
      f.delay[i] = Math.random();
      f.amb[i] = 1;
      continue;
    }
    // shards: particles sharing a direction travel together, by chunked noise
    const shard = Math.sin(Math.floor(Math.atan2(y, x) * 3) * 12.9898 + Math.floor(z / (H * 0.08)) * 78.233);
    const k = 1.9 + Math.abs(shard) * 1.6 + Math.pow(Math.random(), 3) * 1.5;
    const d = len || 1;
    f.pos[i * 3] = x * k + gauss() * H * 0.02;
    f.pos[i * 3 + 1] = y * k + gauss() * H * 0.02;
    f.pos[i * 3 + 2] = z * k + gauss() * H * 0.02;
    f.delay[i] = 1 - Math.min(1, d / (src.radius * 1.5)) * 0.8 - Math.random() * 0.2;
  }
  f.rot = src.rot;
  return f;
}

export function website(layer, ctx) {
  return fromLayer(layer, ctx, {
    ambientFrac: 0.16,
    depth: 4,
    order: (x, y) => Math.min(1, y * 0.85 + x * 0.15), // printed top-down
  });
}

export function finale(layer, ctx) {
  const { W, H } = ctx;
  const rx = Math.min(W * 0.48, H * 0.9);
  const ry = Math.min(H * 0.34, rx * 0.6);
  return fromLayer(layer, ctx, {
    ambientFrac: 0.12,
    depth: 6,
    order: (x, y) => Math.min(1, Math.hypot(x - 0.5, y - 0.5) * 1.4),
    extra: {
      frac: 0.18,
      // A tilted orbit embracing the final composition
      place(f, p, k, total) {
        const a = (k / total) * TAU + gauss() * 0.01;
        const band = 1 + gauss() * 0.015;
        f.pos[p * 3] = Math.cos(a) * rx * band;
        // an orbit that wraps around the composition, dipping behind the headline
        f.pos[p * 3 + 1] = Math.sin(a) * ry * band + H * 0.04;
        f.pos[p * 3 + 2] = Math.sin(a + 0.6) * rx * 0.5;
        f.delay[p] = 0.4 + (k / total) * 0.6;
      },
    },
  });
}
