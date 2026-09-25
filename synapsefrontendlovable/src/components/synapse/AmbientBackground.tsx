import { useEffect, useRef } from "react";

/** Slow drifting graphite particles with faint connecting lines. Disabled for reduced motion. */
export function AmbientBackground() {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let w = 0, h = 0, raf = 0;
    const pts = Array.from({ length: 46 }, () => ({ x: Math.random(), y: Math.random(), vx: (Math.random() - 0.5) * 0.00008, vy: (Math.random() - 0.5) * 0.00008 }));
    const resize = () => {
      w = canvas.width = window.innerWidth * devicePixelRatio;
      h = canvas.height = window.innerHeight * devicePixelRatio;
    };
    resize();
    window.addEventListener("resize", resize);
    const draw = () => {
      const fg = getComputedStyle(document.documentElement).getPropertyValue("--ink-soft").trim() || "gray";
      ctx.clearRect(0, 0, w, h);
      ctx.fillStyle = fg;
      ctx.strokeStyle = fg;
      for (const p of pts) {
        if (!reduce) { p.x = (p.x + p.vx + 1) % 1; p.y = (p.y + p.vy + 1) % 1; }
      }
      for (let i = 0; i < pts.length; i++) {
        const a = pts[i]!;
        ctx.globalAlpha = 0.35;
        ctx.beginPath();
        ctx.arc(a.x * w, a.y * h, 1.2 * devicePixelRatio, 0, Math.PI * 2);
        ctx.fill();
        for (let j = i + 1; j < pts.length; j++) {
          const b = pts[j]!;
          const d = Math.hypot((a.x - b.x) * w, (a.y - b.y) * h);
          const max = 180 * devicePixelRatio;
          if (d < max) {
            ctx.globalAlpha = 0.08 * (1 - d / max);
            ctx.beginPath(); ctx.moveTo(a.x * w, a.y * h); ctx.lineTo(b.x * w, b.y * h); ctx.stroke();
          }
        }
      }
      if (!reduce) raf = requestAnimationFrame(draw);
    };
    draw();
    return () => { cancelAnimationFrame(raf); window.removeEventListener("resize", resize); };
  }, []);
  return <canvas ref={ref} aria-hidden="true" className="pointer-events-none fixed inset-0 z-0 h-full w-full" />;
}
