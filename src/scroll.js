import { gsap } from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';

gsap.registerPlugin(ScrollTrigger);

// Chapter anchors on the master timeline (in timeline seconds == 100vh of scroll).
export const CHAPTERS = [0, 1.85, 3.6, 4.85, 6.95, 9.7];

const lines = (layer) => layer.querySelectorAll('.reveal-line > span');

/**
 * One master timeline, scrubbed by scroll. Particle state (`stage.s`, opacity)
 * and DOM choreography live on the same clock, so every chapter is a moment in
 * one continuous animation rather than separate per-section effects.
 */
export function createScrollTimeline({ swarm, layers, onUpdate }) {
  const stage = swarm.state;
  const root = document.documentElement;
  const tl = gsap.timeline({ defaults: { ease: 'none' } });

  const show = (layer, at) => tl.fromTo(layer, { autoAlpha: 0 }, { autoAlpha: 1, duration: 0.01, immediateRender: false }, at);
  const hide = (layer, at) => tl.to(layer, { autoAlpha: 0, duration: 0.01 }, at);
  const linesIn = (layer, at) =>
    tl.fromTo(lines(layer), { yPercent: 115 }, { yPercent: 0, duration: 0.5, stagger: 0.07, ease: 'power3.out', immediateRender: false }, at);
  const linesOut = (layer, at) =>
    tl.fromTo(lines(layer), { yPercent: 0 }, { yPercent: -115, duration: 0.35, stagger: 0.05, ease: 'power2.in', immediateRender: false }, at);
  const morph = (to, at, duration) => tl.to(stage, { s: to, duration, ease: 'sine.inOut' }, at);

  // 01 → 02 · Hero disperses into the nebula
  linesOut(layers.hero, 0.3);
  tl.to(layers.hero.querySelector('.hero__scroll'), { autoAlpha: 0, duration: 0.2 }, 0.3);
  morph(2, 0.35, 1.3);
  hide(layers.hero, 0.9);
  show(layers.cloud, 1.2);
  linesIn(layers.cloud, 1.2);

  // 02 → 03 · Nebula condenses into the geodesic structure
  linesOut(layers.cloud, 2.1);
  morph(3, 2.1, 1.3);
  hide(layers.cloud, 2.6);
  show(layers.form, 2.9);
  linesIn(layers.form, 2.9);

  // 03 → 04 · Structure fractures
  linesOut(layers.form, 3.9);
  morph(4, 3.9, 0.8);
  hide(layers.form, 4.35);
  show(layers.fracture, 4.3);
  linesIn(layers.fracture, 4.3);

  // 04 → 05 · Shards assemble into a website, printed top-down
  linesOut(layers.fracture, 5.0);
  hide(layers.fracture, 5.4);
  morph(5, 4.95, 1.45);
  show(layers.site, 5.8);
  const site = layers.site;
  const solids = [...site.querySelectorAll('.site__frame, .site__image, .card, .site__pill, .site__btn')];
  const texts = [...site.querySelectorAll('.site__nav li:not(.site__pill), .site__logo, .site__tag, .site__title, .site__lede, .card__n, .card p, .site__caption')];
  // Solid surfaces condense from the scaffold with a wipe; text comes into focus.
  tl.fromTo(
    solids,
    { clipPath: 'inset(0% 0% 100% 0% round 14px)', opacity: 0 },
    { clipPath: 'inset(0% 0% 0% 0% round 14px)', opacity: 1, duration: 0.55, stagger: 0.05, ease: 'power2.out', immediateRender: true },
    5.95,
  );
  tl.fromTo(
    texts,
    { opacity: 0, filter: 'blur(10px)' },
    { opacity: 1, filter: 'blur(0px)', duration: 0.45, stagger: 0.03, ease: 'power1.out', immediateRender: true },
    6.05,
  );
  tl.to(stage, { opacity: 0.5, duration: 0.6 }, 6.1);

  // 05 → 06 · Everything converges on the final composition
  tl.to(texts, { opacity: 0, filter: 'blur(12px)', duration: 0.35, stagger: { each: 0.015, from: 'end' } }, 7.45);
  tl.to(solids, { clipPath: 'inset(100% 0% 0% 0% round 14px)', duration: 0.45, stagger: { each: 0.03, from: 'end' }, ease: 'power2.in' }, 7.5);
  tl.to(stage, { opacity: 1, duration: 0.5 }, 7.5);
  hide(site, 8.05);
  morph(6, 7.6, 1.5);
  show(layers.final, 8.5);
  linesIn(layers.final, 8.5);
  const cta = layers.final.querySelector('.final__cta');
  tl.fromTo(
    [...cta.children, layers.final.querySelector('.final__replay'), layers.final.querySelector('.final__foot')],
    { opacity: 0, filter: 'blur(8px)' },
    { opacity: 1, filter: 'blur(0px)', duration: 0.5, stagger: 0.08, immediateRender: true },
    8.95,
  );
  tl.to(root, { '--glow': 0.16, duration: 1.2 }, 8.3);
  tl.set({}, {}, 10.2); // hold the ending

  const st = ScrollTrigger.create({
    trigger: '#track',
    start: 'top top',
    end: 'bottom bottom',
    animation: tl,
    scrub: swarm.reduced ? true : 1.1,
    onUpdate: (self) => onUpdate?.(self.progress, self.progress * tl.duration()),
  });

  // Final CTA becomes clickable only once it exists.
  const finalLive = ScrollTrigger.create({
    trigger: '#track',
    start: () => st.start + (st.end - st.start) * (9.1 / tl.duration()),
    end: 'bottom bottom',
    toggleClass: { targets: layers.final, className: 'is-interactive' },
  });

  /** Scroll position (px) for a timeline time. */
  const scrollFor = (time) => st.start + (st.end - st.start) * (time / tl.duration());

  return {
    tl,
    st,
    scrollFor,
    destroy() {
      st.kill();
      finalLive.kill();
      tl.kill();
    },
  };
}

export { gsap, ScrollTrigger };
