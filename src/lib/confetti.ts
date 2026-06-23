/**
 * Tiny dependency-free confetti. A celebratory burst fired from the two bottom
 * corners — used when the user approves a PR. Self-contained: it mounts a
 * fullscreen canvas, animates particles with simple physics, and removes itself
 * when they settle. No-ops under `prefers-reduced-motion`.
 */

// Brand palette (violet/blue/green/amber) + a magenta pop + white sparkle.
const COLORS = ["#8b7cf6", "#5bb0f7", "#57d98b", "#f2b84b", "#f06cc6", "#ffffff"];

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  size: number;
  color: string;
  rot: number;
  vrot: number;
  round: boolean;
  life: number;
}

export function celebrate(opts?: { particleCount?: number }): void {
  if (typeof window === "undefined" || typeof document === "undefined") return;
  if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;

  const count = opts?.particleCount ?? 150;
  const canvas = document.createElement("canvas");
  canvas.setAttribute("aria-hidden", "true");
  Object.assign(canvas.style, {
    position: "fixed",
    inset: "0",
    width: "100%",
    height: "100%",
    pointerEvents: "none",
    zIndex: "9999",
  } satisfies Partial<CSSStyleDeclaration>);
  document.body.appendChild(canvas);

  const ctx = canvas.getContext("2d");
  if (!ctx) {
    canvas.remove();
    return;
  }

  const dpr = window.devicePixelRatio || 1;
  let w = window.innerWidth;
  let h = window.innerHeight;
  const resize = () => {
    w = window.innerWidth;
    h = window.innerHeight;
    canvas.width = w * dpr;
    canvas.height = h * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  };
  resize();
  window.addEventListener("resize", resize);

  const rand = (a: number, b: number) => a + Math.random() * (b - a);
  const particles: Particle[] = [];

  // Two cannons: bottom-left firing up-right, bottom-right firing up-left.
  const cannons = [
    { x: 0, y: h, angle: -Math.PI / 3 }, // up & to the right
    { x: w, y: h, angle: (-2 * Math.PI) / 3 }, // up & to the left
  ];
  for (const c of cannons) {
    for (let i = 0; i < count / 2; i++) {
      const angle = c.angle + rand(-0.35, 0.35);
      const speed = rand(14, 30);
      particles.push({
        x: c.x,
        y: c.y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        size: rand(5, 11),
        color: COLORS[(Math.random() * COLORS.length) | 0],
        rot: rand(0, Math.PI * 2),
        vrot: rand(-0.3, 0.3),
        round: Math.random() < 0.35,
        life: 1,
      });
    }
  }

  const gravity = 0.38;
  const drag = 0.99;
  let raf = 0;

  const tick = () => {
    ctx.clearRect(0, 0, w, h);
    let alive = false;
    for (const p of particles) {
      p.vx *= drag;
      p.vy = p.vy * drag + gravity;
      p.x += p.vx;
      p.y += p.vy;
      p.rot += p.vrot;
      p.life -= 0.006;
      if (p.life <= 0 || p.y > h + 40) continue;
      alive = true;
      ctx.save();
      ctx.globalAlpha = Math.max(0, Math.min(1, p.life * 1.4));
      ctx.translate(p.x, p.y);
      ctx.rotate(p.rot);
      ctx.fillStyle = p.color;
      if (p.round) {
        ctx.beginPath();
        ctx.arc(0, 0, p.size / 2, 0, Math.PI * 2);
        ctx.fill();
      } else {
        ctx.fillRect(-p.size / 2, -p.size / 2, p.size, p.size * 0.6);
      }
      ctx.restore();
    }
    if (alive) {
      raf = requestAnimationFrame(tick);
    } else {
      window.removeEventListener("resize", resize);
      cancelAnimationFrame(raf);
      canvas.remove();
    }
  };
  raf = requestAnimationFrame(tick);
}
