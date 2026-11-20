# swarm-cursor

A scroll-driven particle swarm website. Thousands of particles form the headline, disperse into a nebula, condense into a geodesic structure, fracture, print an actual website top-down, then converge on a final call to action.

Built with Three.js (one `THREE.Points` draw call, custom shaders), GSAP and ScrollTrigger, and Vite.

```bash
npm install
npm run dev       # http://localhost:5173
npm run build && npm run preview
```

## Architecture

| File | Role |
| --- | --- |
| `index.html` | Fixed `#stage` of DOM layers (real, accessible content) over the canvas, plus a tall `#track` whose scroll length is the timeline. |
| `src/main.js` | Capability and device tiering, font loading, cursor, HUD, nav, resize, teardown (HMR-safe). |
| `src/scroll.js` | **One** scrubbed GSAP master timeline drives `swarm.state.s` (formation index), particle opacity and all DOM choreography, so the chapters play as one continuous animation. |
| `src/swarm/Swarm.js` | CPU-integrated particle sim on a dynamic `BufferGeometry`: spring to the blended target, staggered per-particle arrival, mid-flight flow field and depth swing, cursor forces, adaptive quality. |
| `src/swarm/formations.js` | Target generators: spawn shell, hero text, nebula, geodesic structure, fracture, website, finale with orbit ring. |
| `src/swarm/sampler.js` | Redraws every `[data-swarm]` element at its **real CSS layout rect** on an offscreen canvas and samples points by alpha. Particle targets therefore match the HTML exactly at every breakpoint. |
| `src/swarm/shaders.js` | Point sprites with depth of field (circle of confusion grows, softens and fades), twinkle, and an ember tint by velocity. |

### Making particles build something new

Mark any element inside a layer with `data-swarm="text" | "box" | "image"`. Optional attributes: `data-weight` (density, 0–1) and `data-fill` (fill density for boxes). Then add a formation for that layer in `formations.js`.

### Cursor field

The smoothed cursor (that's the delay) pulls particles toward a ring around it (magnetic), spins them (vortex) and drags them along its velocity (wake). Fast movements scatter them in 3D. A small cohort of particles leaves the formation and trails the cursor as an orbiting comet, built from a history buffer of cursor positions.

### Performance and accessibility

- The particle budget is tiered by viewport, pointer type, cores and memory: about 18k on desktop, about 7k on mobile.
- If the frame rate stays under about 48 fps, the pixel ratio drops first, then the particle count (floor: 40%).
- For testing, `?particles=12000` pins the count and disables adaptation.
- `prefers-reduced-motion` gives no intro gather, no flow-field travel, no cursor scatter or comet, stiff springs and static grain.
- Without WebGL or JavaScript, the same DOM renders as a static editorial page. An inline head check picks the mode before first paint.
