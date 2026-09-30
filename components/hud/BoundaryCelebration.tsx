"use client";

import { useEffect, useRef } from "react";
import type { LiveState } from "@/lib/game/engine";
import { BOUNDARY_HOLD_TIME } from "@/lib/game/presentation/boundary";

const COLORS = ["#ffe078", "#7dd66a", "#eaf3e6", "#67d7ff", "#ff9b66"];

/** Boundary graphics follow the engine clock, starting on the rope-crossing frame. */
export function BoundaryCelebration({ live }: { live: LiveState | null }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const bannerRef = useRef<HTMLDivElement>(null);
  const digitRef = useRef<HTMLDivElement>(null);
  const labelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const banner = bannerRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !banner || !ctx || !live) return;
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
    let width = 0;
    let height = 0;
    const resize = () => {
      width = window.innerWidth;
      height = window.innerHeight;
      const dpr = Math.min(window.devicePixelRatio, 2);
      canvas.width = width * dpr;
      canvas.height = height * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();
    window.addEventListener("resize", resize);
    let previousRuns: number | null = null;
    let raf = 0;
    const draw = () => {
      raf = requestAnimationFrame(draw);
      ctx.clearRect(0, 0, width, height);
      const runs = live.boundaryRuns;
      banner.hidden = runs === null;
      if (runs !== previousRuns) {
        previousRuns = runs;
        if (digitRef.current) digitRef.current.textContent = runs === null ? "" : String(runs);
        if (labelRef.current) labelRef.current.textContent = runs === 6 ? "SIX!" : runs === 4 ? "FOUR!" : "";
      }
      if (runs === null) return;
      const t = live.celebrationTime;
      const alpha = Math.min(1, Math.max(0, (BOUNDARY_HOLD_TIME + 0.25 - t) / 0.35)) * (1 - live.fade);
      banner.style.opacity = String(alpha);
      banner.style.transform = reducedMotion.matches ? "none" : `scale(${1 + 0.16 * Math.exp(-t * 6) * Math.sin(t * 15)})`;
      if (reducedMotion.matches) return;

      // Deterministic bursts use elapsed game time, so pausing or a slow frame
      // never spawns another burst or leaves particles running into the next ball.
      for (let i = 0; i < 84; i++) {
        const seed = Math.sin(i * 127.1 + 13) * 43758.5453;
        const random = seed - Math.floor(seed);
        const angle = Math.PI * (0.12 + random * 0.76);
        const speed = 150 + (i % 11) * 22;
        const direction = i % 2 ? 1 : -1;
        const x = width * (i % 2 ? 0.12 : 0.88) + direction * Math.cos(angle) * speed * t;
        const y = height * 0.33 - Math.sin(angle) * speed * t + 120 * t * t;
        ctx.save();
        ctx.globalAlpha = alpha * Math.min(1, Math.max(0, (3 - t) / 0.7));
        ctx.translate(x, y);
        ctx.rotate(i + t * (random * 8 - 4));
        ctx.fillStyle = COLORS[i % COLORS.length];
        ctx.fillRect(-3, -5, 6, 10 * Math.cos(t * 5 + i));
        ctx.restore();
      }
    };
    draw();
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", resize);
    };
  }, [live]);

  return <div className="pointer-events-none absolute inset-0 z-10" data-testid="boundary-celebration">
    <canvas ref={canvasRef} aria-hidden="true" className="absolute inset-0" />
    <div ref={bannerRef} hidden role="status" aria-live="polite" className="absolute left-[9%] top-[28%] text-center" style={{ textShadow: "0 4px 24px #07110c, 0 2px 3px #07110c" }}>
      <div ref={digitRef} className="text-[clamp(80px,12vw,180px)] font-black leading-none text-[#ffe078]" />
      <div ref={labelRef} className="mt-1 text-3xl font-bold tracking-[0.2em] text-white" />
      <div className="mt-3 text-xs tracking-[0.25em] text-[#d6e8cf]">BOUNDARY</div>
    </div>
  </div>;
}
