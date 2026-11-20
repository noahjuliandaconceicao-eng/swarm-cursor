import { Swarm } from './swarm/Swarm.js';
import * as F from './swarm/formations.js';
import { createScrollTimeline, CHAPTERS, gsap, ScrollTrigger } from './scroll.js';

const root = document.documentElement;
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];

function particleBudget({ coarse, reduced }) {
  const w = window.innerWidth;
  const cores = navigator.hardwareConcurrency || 4;
  const mem = navigator.deviceMemory || 4;
  let n = coarse || w < 768 ? 7000 : w < 1200 ? 13000 : 18000;
  if (cores <= 4 || mem <= 4) n *= 0.7;
  if (w > 2200) n *= 1.15;
  if (reduced) n *= 0.6;
  return Math.round(n);
}

function loadFonts() {
  if (!document.fonts) return Promise.resolve();
  const wanted = [
    '800 100px "Inter Tight"',
    '500 40px "Inter Tight"',
    '400 16px "Inter Tight"',
    '400 12px "JetBrains Mono"',
    'italic 40px "Instrument Serif"',
  ].map((f) => document.fonts.load(f).catch(() => {}));
  const timeout = new Promise((r) => setTimeout(r, 2500));
  return Promise.race([Promise.all(wanted).then(() => document.fonts.ready), timeout]);
}

function fallback(reason) {
  console.warn('[swarm] static fallback:', reason);
  root.classList.remove('has-webgl');
  root.classList.add('no-webgl');
}

async function boot() {
  if (!root.classList.contains('has-webgl')) return; // static site already showing

  const reducedQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
  const reduced = reducedQuery.matches;
  const coarse = window.matchMedia('(pointer: coarse)').matches;
  const canvas = $('#swarm');

  if ('scrollRestoration' in history) history.scrollRestoration = 'manual';
  window.scrollTo(0, 0);

  // ?particles=12000 pins the count (and disables adaptive quality) for testing.
  const forced = parseInt(new URLSearchParams(location.search).get('particles'), 10);
  const count = forced > 0 ? Math.min(forced, 60000) : particleBudget({ coarse, reduced });

  let swarm;
  try {
    swarm = new Swarm(canvas, { count, reducedMotion: reduced });
    swarm.adaptive = !(forced > 0);
  } catch (err) {
    fallback(err);
    return;
  }
  if (reduced) root.classList.add('reduced-motion');

  const layers = Object.fromEntries($$('[data-layer]').map((el) => [el.dataset.layer, el]));
  const dprCap = coarse ? 1.75 : 2;
  let W = window.innerWidth;
  let H = window.innerHeight;
  swarm.resize(W, H, Math.min(window.devicePixelRatio || 1, dprCap));

  await loadFonts();

  const build = (reseed) => {
    const ctx = { N: swarm.N, W, H, ambient: F.makeAmbient(swarm.N, W, H) };
    const structure = F.structure(ctx);
    swarm.setFormations(
      [
        F.spawn(ctx),
        F.hero(layers.hero, ctx),
        F.nebula(ctx),
        structure,
        F.fracture(structure, ctx),
        F.website(layers.site, ctx),
        F.finale(layers.final, ctx),
      ],
      { reseed },
    );
  };
  build(true);

  // ───────── HUD ─────────
  const hud = {
    count: $('[data-count]'),
    fps: $('[data-fps]'),
    cx: $('[data-cx]'),
    cy: $('[data-cy]'),
    bar: $('.hud__progress span'),
    chapters: $$('.hud__index li'),
  };
  const fmt = (n) => n.toLocaleString('en-US');
  hud.count.textContent = fmt(swarm.count);
  swarm.onQualityChange = (n) => (hud.count.textContent = fmt(n));
  const thresholds = [0, 1.0, 2.6, 4.2, 5.6, 8.2];
  let activeChapter = -1;

  const scroll = createScrollTimeline({
    swarm,
    layers,
    onUpdate(progress, time) {
      hud.bar.style.transform = `scaleX(${progress})`;
      let c = 0;
      for (let i = 0; i < thresholds.length; i++) if (time >= thresholds[i]) c = i;
      if (c !== activeChapter) {
        activeChapter = c;
        hud.chapters.forEach((li, i) => li.classList.toggle('is-active', i === c));
      }
    },
  });
  hud.chapters[0].classList.add('is-active');

  // ───────── Intro ─────────
  gsap.set(layers.hero, { autoAlpha: 1 });
  if (!reduced) {
    gsap.to(swarm.state, { intro: 1, duration: 3.6, ease: 'power2.out', delay: 0.15 });
    gsap.from($$('.reveal-line > span', layers.hero), { yPercent: 115, duration: 1.4, stagger: 0.12, ease: 'expo.out', delay: 1.4 });
    gsap.from('.hud, .hud__coords, .hud__progress, .hero__scroll', { autoAlpha: 0, duration: 1.2, delay: 2 });
  }

  // ───────── Cursor ─────────
  const cursor = $('.cursor');
  const dot = $('.cursor__dot');
  const ring = $('.cursor__ring');
  const dotX = gsap.quickSetter(dot, 'x', 'px');
  const dotY = gsap.quickSetter(dot, 'y', 'px');
  const ringX = gsap.quickTo(ring, 'x', { duration: 0.45, ease: 'power3.out' });
  const ringY = gsap.quickTo(ring, 'y', { duration: 0.45, ease: 'power3.out' });

  const onPointerMove = (e) => {
    if (e.pointerType === 'touch') return; // touch handled below so it works mid-scroll
    swarm.pointerMove(e.clientX, e.clientY);
    cursor.classList.add('is-active');
    dotX(e.clientX);
    dotY(e.clientY);
    ringX(e.clientX);
    ringY(e.clientY);
    hud.cx.textContent = String(Math.round(e.clientX)).padStart(4, '0');
    hud.cy.textContent = String(Math.round(e.clientY)).padStart(4, '0');
  };
  const onPointerOver = (e) => cursor.classList.toggle('is-hover', !!e.target.closest?.('a'));
  const onLeave = () => {
    swarm.pointerLeave();
    cursor.classList.remove('is-active');
  };
  const onTouch = (e) => {
    const t = e.touches[0];
    if (t) swarm.pointerMove(t.clientX, t.clientY);
  };

  window.addEventListener('pointermove', onPointerMove, { passive: true });
  window.addEventListener('pointerover', onPointerOver, { passive: true });
  document.addEventListener('pointerleave', onLeave);
  window.addEventListener('blur', onLeave);
  window.addEventListener('touchstart', onTouch, { passive: true });
  window.addEventListener('touchmove', onTouch, { passive: true });
  window.addEventListener('touchend', onLeave, { passive: true });
  window.addEventListener('touchcancel', onLeave, { passive: true });

  // ───────── Navigation (layers are fixed, so anchors map to timeline time) ─────────
  const behavior = reduced ? 'auto' : 'smooth';
  const onNavClick = (e) => {
    const top = e.target.closest('[data-scroll-top]');
    const chapter = e.target.closest('[data-chapter]');
    if (top) {
      e.preventDefault();
      window.scrollTo({ top: 0, behavior });
    } else if (chapter) {
      e.preventDefault();
      window.scrollTo({ top: scroll.scrollFor(CHAPTERS[+chapter.dataset.chapter]), behavior });
    }
  };
  document.addEventListener('click', onNavClick);

  // ───────── Frame loop (GSAP's ticker = one rAF shared with ScrollTrigger) ─────────
  let fpsAcc = 0;
  let fpsFrames = 0;
  const tick = (_time, deltaMs) => {
    const dt = Math.min(deltaMs / 1000, 1 / 20);
    swarm.update(dt);
    swarm.render();
    fpsAcc += deltaMs;
    fpsFrames++;
    if (fpsAcc > 500) {
      hud.fps.textContent = Math.round((fpsFrames * 1000) / fpsAcc);
      fpsAcc = 0;
      fpsFrames = 0;
    }
  };
  gsap.ticker.add(tick);
  gsap.ticker.lagSmoothing(500, 33);

  // ───────── Resize ─────────
  let resizeTimer;
  const onResize = () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      const nW = window.innerWidth;
      const nH = window.innerHeight;
      // Ignore mobile URL-bar height jitter.
      if (nW === W && Math.abs(nH - H) < 120 && coarse) return;
      W = nW;
      H = nH;
      swarm.resize(W, H, Math.min(window.devicePixelRatio || 1, dprCap) * (swarm.perf.cuts ? 0.75 : 1));
      build(false);
      ScrollTrigger.refresh();
    }, 180);
  };
  window.addEventListener('resize', onResize);

  // Reduced-motion preference changed mid-session: simplest honest response is a reload.
  const onMotionPref = () => window.location.reload();
  reducedQuery.addEventListener('change', onMotionPref);

  const onContextLost = (e) => {
    e.preventDefault();
    gsap.ticker.remove(tick);
  };
  const onContextRestored = () => gsap.ticker.add(tick);
  canvas.addEventListener('webglcontextlost', onContextLost);
  canvas.addEventListener('webglcontextrestored', onContextRestored);

  ScrollTrigger.refresh();

  return function destroy() {
    gsap.ticker.remove(tick);
    scroll.destroy();
    window.removeEventListener('pointermove', onPointerMove);
    window.removeEventListener('pointerover', onPointerOver);
    document.removeEventListener('pointerleave', onLeave);
    window.removeEventListener('blur', onLeave);
    window.removeEventListener('touchstart', onTouch);
    window.removeEventListener('touchmove', onTouch);
    window.removeEventListener('touchend', onLeave);
    window.removeEventListener('touchcancel', onLeave);
    document.removeEventListener('click', onNavClick);
    window.removeEventListener('resize', onResize);
    reducedQuery.removeEventListener('change', onMotionPref);
    canvas.removeEventListener('webglcontextlost', onContextLost);
    canvas.removeEventListener('webglcontextrestored', onContextRestored);
    clearTimeout(resizeTimer);
    swarm.dispose();
  };
}

const ready = boot().catch((err) => {
  fallback(err);
});

if (import.meta.hot) {
  import.meta.hot.dispose(async () => {
    const destroy = await ready;
    destroy?.();
  });
}
