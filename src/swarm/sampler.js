// Turns live DOM layout into particle targets.
//
// Every element marked [data-swarm] inside a layer is redrawn onto an offscreen
// canvas at its real on-screen rect (using its computed font, radius, etc.).
// Pixel alpha becomes sampling density, so the particles land exactly where the
// HTML will later solidify — and it stays correct at every breakpoint.

const canvas = document.createElement('canvas');
const ctx = canvas.getContext('2d', { willReadFrequently: true });

/** Wrap each word of an element in a span once, so wrapped lines can be measured. */
function splitWords(el) {
  if (el.dataset.split) return;
  el.dataset.split = '1';
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  const nodes = [];
  while (walker.nextNode()) nodes.push(walker.currentNode);
  for (const node of nodes) {
    const parts = node.textContent.split(/(\s+)/);
    const frag = document.createDocumentFragment();
    for (const part of parts) {
      if (!part) continue;
      if (/^\s+$/.test(part)) frag.appendChild(document.createTextNode(part));
      else {
        const span = document.createElement('span');
        span.className = 'sw-w';
        span.textContent = part;
        frag.appendChild(span);
      }
    }
    node.parentNode.replaceChild(frag, node);
  }
}

function drawText(el, alpha) {
  splitWords(el);
  ctx.fillStyle = `rgba(255,255,255,${alpha})`;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  for (const w of el.querySelectorAll('.sw-w')) {
    const r = w.getBoundingClientRect();
    if (!r.width) continue;
    const cs = getComputedStyle(w);
    ctx.font = `${cs.fontStyle} ${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
    if ('letterSpacing' in ctx) ctx.letterSpacing = cs.letterSpacing === 'normal' ? '0px' : cs.letterSpacing;
    const txt = cs.textTransform === 'uppercase' ? w.textContent.toUpperCase() : w.textContent;
    // Inline boxes are centred on the em box, so 'middle' at the rect centre is a close optical match.
    ctx.fillText(txt, r.left, r.top + r.height * 0.52);
  }
}

function roundRect(r, radius) {
  const rad = Math.min(radius, r.height / 2, r.width / 2);
  ctx.beginPath();
  ctx.roundRect(r.left, r.top, r.width, r.height, rad);
}

function drawBox(el, alpha, scale) {
  const r = el.getBoundingClientRect();
  const radius = parseFloat(getComputedStyle(el).borderTopLeftRadius) || 0;
  roundRect(r, radius);
  if (el.dataset.fill) {
    ctx.fillStyle = `rgba(255,255,255,${alpha * parseFloat(el.dataset.fill)})`;
    ctx.fill();
  }
  ctx.strokeStyle = `rgba(255,255,255,${alpha})`;
  ctx.lineWidth = Math.max(1.6, 1.4 / scale);
  ctx.stroke();
  // Label text inside a box (buttons, pills)
  for (const label of el.querySelectorAll(':scope > span')) drawText(label, alpha);
}

function drawImage(el, alpha, scale) {
  const r = el.getBoundingClientRect();
  ctx.save();
  roundRect(r, parseFloat(getComputedStyle(el).borderTopLeftRadius) || 0);
  ctx.clip();
  // A density map of the artwork: a glowing disc over scanlines.
  const cx = r.left + r.width * 0.62;
  const cy = r.top + r.height * 0.58;
  const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, r.width * 0.42);
  g.addColorStop(0, `rgba(255,255,255,${alpha})`);
  g.addColorStop(0.35, `rgba(255,255,255,${alpha * 0.7})`);
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = `rgba(255,255,255,${alpha * 0.07})`;
  ctx.fillRect(r.left, r.top, r.width, r.height);
  ctx.fillStyle = g;
  ctx.fillRect(r.left, r.top, r.width, r.height);
  ctx.globalCompositeOperation = 'destination-out';
  ctx.fillStyle = 'rgba(0,0,0,0.85)';
  for (let y = r.top + 10; y < r.bottom; y += 13) ctx.fillRect(r.left, y, r.width, 3);
  ctx.restore();
  ctx.strokeStyle = `rgba(255,255,255,${alpha})`;
  ctx.lineWidth = Math.max(1.6, 1.4 / scale);
  roundRect(r, parseFloat(getComputedStyle(el).borderTopLeftRadius) || 0);
  ctx.stroke();
}

/**
 * Sample `count` points from a layer's [data-swarm] elements.
 * Returns pixel coordinates (viewport space) as a Float32Array [x0,y0,x1,y1,...].
 */
export function sampleLayer(layer, count, W, H) {
  const scale = Math.min(1, 1280 / W);
  canvas.width = Math.ceil(W * scale);
  canvas.height = Math.ceil(H * scale);
  ctx.setTransform(scale, 0, 0, scale, 0, 0);
  ctx.clearRect(0, 0, W, H);

  for (const el of layer.querySelectorAll('[data-swarm]')) {
    const alpha = parseFloat(el.dataset.weight || '1');
    const type = el.dataset.swarm;
    if (type === 'text') drawText(el, alpha);
    else if (type === 'box') drawBox(el, alpha, scale);
    else if (type === 'image') drawImage(el, alpha, scale);
  }

  const { width, height } = canvas;
  const data = ctx.getImageData(0, 0, width, height).data;
  const candidates = [];
  for (let i = 0, p = 3; i < width * height; i++, p += 4) if (data[p] > 10) candidates.push(i);

  const out = new Float32Array(count * 2);
  if (!candidates.length) {
    for (let i = 0; i < count; i++) {
      out[i * 2] = Math.random() * W;
      out[i * 2 + 1] = Math.random() * H;
    }
    return out;
  }

  // Rejection sampling: acceptance probability = pixel alpha.
  let filled = 0;
  let guard = count * 60;
  while (filled < count && guard-- > 0) {
    const idx = candidates[(Math.random() * candidates.length) | 0];
    if (Math.random() * 255 > data[idx * 4 + 3]) continue;
    out[filled * 2] = ((idx % width) + Math.random()) / scale;
    out[filled * 2 + 1] = (((idx / width) | 0) + Math.random()) / scale;
    filled++;
  }
  for (; filled < count; filled++) {
    const idx = candidates[(Math.random() * candidates.length) | 0];
    out[filled * 2] = ((idx % width) + Math.random()) / scale;
    out[filled * 2 + 1] = (((idx / width) | 0) + Math.random()) / scale;
  }
  return out;
}
