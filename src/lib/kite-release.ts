/**
 * A celebratory release of brand kites — fired when the user approves a PR.
 * Self-contained: mounts a fullscreen overlay, sends a flock of kites rising and
 * swaying up into the sky, banking as they go, then removes itself when they've
 * drifted off the top. No-ops under prefers-reduced-motion.
 */

const KITE_SVG = `<svg width="34" height="50" viewBox="0 0 24 36" fill="none" xmlns="http://www.w3.org/2000/svg">
<path d="M12 22 Q14 26 12 30 Q10 33 12 35" stroke="#5A3B1E" stroke-width="0.9" fill="none" opacity="0.8"/>
<path d="M11 25 l2 -1 v2 z M13 25 l-2 -1 v2 z" fill="#FBBC05"/>
<path d="M12 2 L12 11 L4 11 Z" fill="#FBBC05"/>
<path d="M12 2 L12 11 L20 11 Z" fill="#EA4335"/>
<path d="M12 21 L12 11 L20 11 Z" fill="#4285F4"/>
<path d="M12 21 L12 11 L4 11 Z" fill="#34A853"/>
<path d="M12 1 L12 22 M3 11 L21 11" stroke="#5A3B1E" stroke-width="0.9" stroke-linecap="round"/>
</svg>`;

interface Kite {
  el: HTMLDivElement;
  x: number;
  y: number;
  vy: number;
  swayAmp: number;
  swayFreq: number;
  swayPhase: number;
  drift: number;
  scale: number;
  bankAmp: number;
  born: number;
}

export function celebrate(opts?: { count?: number }): void {
  if (typeof window === "undefined" || typeof document === "undefined") return;
  if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;

  const w = window.innerWidth;
  const h = window.innerHeight;
  const count = opts?.count ?? 14;

  const layer = document.createElement("div");
  layer.setAttribute("aria-hidden", "true");
  Object.assign(layer.style, {
    position: "fixed",
    inset: "0",
    pointerEvents: "none",
    overflow: "hidden",
    zIndex: "9999",
  } satisfies Partial<CSSStyleDeclaration>);
  document.body.appendChild(layer);

  const rand = (a: number, b: number) => a + Math.random() * (b - a);
  const kites: Kite[] = [];
  for (let i = 0; i < count; i++) {
    const el = document.createElement("div");
    el.style.position = "absolute";
    el.style.willChange = "transform, opacity";
    el.style.opacity = "0";
    el.innerHTML = KITE_SVG;
    layer.appendChild(el);
    kites.push({
      el,
      x: rand(w * 0.1, w * 0.9), // launched across the bottom, like a release
      y: h + rand(0, 60),
      vy: rand(-9, -5.5),
      swayAmp: rand(14, 42),
      swayFreq: rand(0.02, 0.05),
      swayPhase: rand(0, Math.PI * 2),
      drift: rand(-0.5, 0.5),
      scale: rand(0.65, 1.15),
      bankAmp: rand(8, 20),
      born: Math.round(rand(0, 20)), // a small stagger → a rising wave
    });
  }

  let frame = 0;
  let raf = 0;
  const tick = () => {
    frame++;
    let alive = false;
    for (const k of kites) {
      if (frame < k.born) {
        alive = true;
        continue;
      }
      const age = frame - k.born;
      k.y += k.vy;
      k.x += k.drift;
      const sway = Math.sin(age * k.swayFreq + k.swayPhase);
      const sx = k.x + sway * k.swayAmp;
      const bank = sway * k.bankAmp;
      // Fade in on launch; fade out as it climbs into the top of the screen.
      const fadeIn = Math.min(1, age / 12);
      const fadeOut = Math.min(1, Math.max(0, k.y / (h * 0.25)));
      k.el.style.opacity = (fadeIn * fadeOut).toFixed(2);
      k.el.style.transform = `translate(${sx.toFixed(1)}px, ${k.y.toFixed(1)}px) rotate(${bank.toFixed(1)}deg) scale(${k.scale.toFixed(2)})`;
      if (k.y > -90) alive = true;
    }
    if (alive && frame < 600) {
      raf = requestAnimationFrame(tick);
    } else {
      cancelAnimationFrame(raf);
      layer.remove();
    }
  };
  raf = requestAnimationFrame(tick);
}
