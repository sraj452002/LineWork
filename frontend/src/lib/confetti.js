/* A soft burst of confetti from a point (a finished workflow, a new file). Pieces drift down slowly and
   fade; nothing blinks. Skipped for people who ask their system for less motion. */

const COLORS = ['#6c8cff', '#8b6cf0', '#38c6a3', '#f2b84b', '#f07aa0', '#4cc3f0'];

export function confetti({ x = innerWidth / 2, y = innerHeight / 3, count = 70 } = {}) {
  if (matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;
  const c = document.createElement('canvas');
  c.className = 'lw-confetti';
  c.width = innerWidth * devicePixelRatio; c.height = innerHeight * devicePixelRatio;
  document.body.appendChild(c);
  const g = c.getContext('2d');
  g.scale(devicePixelRatio, devicePixelRatio);
  const bits = Array.from({ length: count }, () => {
    const a = -Math.PI / 2 + (Math.random() - .5) * Math.PI * .9, v = 4 + Math.random() * 5;
    return { x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, r: Math.random() * Math.PI, vr: (Math.random() - .5) * .12, w: 6 + Math.random() * 5, h: 3 + Math.random() * 4, color: COLORS[Math.floor(Math.random() * COLORS.length)] };
  });
  const start = performance.now(), life = 2600;
  const frame = now => {
    const t = now - start;
    g.clearRect(0, 0, innerWidth, innerHeight);
    for (const b of bits) {
      b.vx *= .985; b.vy = b.vy * .985 + .12; b.x += b.vx; b.y += b.vy; b.r += b.vr;
      g.save(); g.globalAlpha = Math.max(0, 1 - t / life); g.translate(b.x, b.y); g.rotate(b.r); g.fillStyle = b.color; g.fillRect(-b.w / 2, -b.h / 2, b.w, b.h); g.restore();
    }
    if (t < life) requestAnimationFrame(frame); else c.remove();
  };
  requestAnimationFrame(frame);
}
