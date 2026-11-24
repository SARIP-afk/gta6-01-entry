// K21_ Fase 2 — Visual Asset Quality Upgrade (ronde #16).
// Procedural canvas textures only: 0 tris, 0 draw calls, deterministic
// (seeded hash only, never Math.random).
// - K21_glassTexture: sunset-reflection glass for the hero car + the
//   traffic fleet. The old flat dark glass (0x101c28 / 0x16202c) read as
//   a black slab from behind — one big unlit rectangle with no depth.
//   This texture gives the pane a vertical story: warm gold sky
//   reflection at the top (the sunset the car drives into), deep
//   blue-grey glass in the middle, dark interior at the bottom, two
//   diagonal glints, faint headrest silhouettes + defroster lines on
//   the rear pane so the glass reads as a window into a cabin, not a
//   painted board. Used with a WHITE base material so the map shows
//   true (Lambert multiplies map x color).
import * as THREE from '../vendor/three.module.min.js';

function K21_canvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return c;
}

export function K21_glassTexture() {
  const W = 256, H = 128;
  const cv = K21_canvas(W, H);
  const ctx = cv.getContext('2d');
  // Vertical story: gold sky -> warm haze -> deep glass -> dark interior.
  const g = ctx.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0.00, '#f7d795');
  g.addColorStop(0.22, '#e9ac68');
  g.addColorStop(0.42, '#8a6a58');
  g.addColorStop(0.55, '#46586c');
  g.addColorStop(0.78, '#22303f');
  g.addColorStop(1.00, '#10161f');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);
  // Two diagonal glints: a strong one upper-left, a faint one mid-right.
  // (Same trick the facade atlases use — it is what sells a pane as
  // glass at 2K instead of a grey gradient.)
  const slash = (x0, x1, alpha) => {
    ctx.fillStyle = `rgba(255,244,214,${alpha})`;
    ctx.beginPath();
    ctx.moveTo(x0, H); ctx.lineTo(x0 + 26, 0);
    ctx.lineTo(x1, 0); ctx.lineTo(x1 - 26, H);
    ctx.closePath(); ctx.fill();
  };
  slash(18, 44, 0.38);
  slash(150, 168, 0.20);
  // Headrest silhouettes + a faint dashboard line at the bottom: the
  // rear pane now hints at a cabin interior instead of void black.
  ctx.fillStyle = 'rgba(6,9,13,0.55)';
  const headrest = (x, w) => {
    ctx.beginPath();
    ctx.roundRect(x, 92, w, 26, 8);
    ctx.fill();
    ctx.fillRect(x + w / 2 - 4, 116, 8, 12);
  };
  headrest(52, 52);
  headrest(152, 52);
  ctx.fillStyle = 'rgba(6,9,13,0.35)';
  ctx.fillRect(0, 118, W, 10);
  // Rear-window defroster lines: three hairlines across the lower half.
  ctx.fillStyle = 'rgba(255,255,255,0.09)';
  for (const y of [62, 78, 94]) ctx.fillRect(0, y, W, 1.5);
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
}
