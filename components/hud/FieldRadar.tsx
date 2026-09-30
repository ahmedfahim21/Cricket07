"use client";

import { useEffect, useRef } from "react";
import { BOUNDARY_SQUARE, BOUNDARY_STRAIGHT } from "@/lib/game/dimensions";
import type { LiveState } from "@/lib/game/engine";
import { radarPoint } from "@/lib/game/presentation/radar";

const W = 240;
const H = 182;

/**
 * The top-right fielding radar: a dark green ellipse with a yellow dot per
 * fielder, exactly as in the original.
 *
 * Drawn to a canvas from `live` on its own rAF rather than from React state.
 * The ball marker moves every frame, and re-rendering a React tree at 60Hz to
 * move one dot is the single easiest way to make a HUD cost more than the 3D
 * scene behind it.
 */
export function FieldRadar({ live }: { live: LiveState | null }) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const dpr = Math.min(window.devicePixelRatio, 2);
    canvas.width = W * dpr;
    canvas.height = H * dpr;
    ctx.scale(dpr, dpr);

    let raf = 0;
    // Rotate everything together, using the actual camera rather than the
    // selected mode: the chase camera can be on the opposite side of the pitch.
    const project = (x: number, z: number) => {
      const p = radarPoint(x, z, live?.radarForwardX ?? 0, live?.radarForwardZ ?? 1);
      return { x: W / 2 + p.x * (W / 2 - 8), y: H / 2 + p.y * (H / 2 - 8) };
    };
    const ellipse = (rx: number, rz: number) => {
      ctx.beginPath();
      for (let i = 0; i <= 64; i++) {
        const a = i / 64 * Math.PI * 2;
        const p = project(Math.cos(a) * rx, Math.sin(a) * rz);
        if (i === 0) ctx.moveTo(p.x, p.y); else ctx.lineTo(p.x, p.y);
      }
      ctx.closePath();
    };

    const draw = () => {
      raf = requestAnimationFrame(draw);
      ctx.clearRect(0, 0, W, H);

      // The ground.
      ellipse(BOUNDARY_SQUARE, BOUNDARY_STRAIGHT);
      ctx.fillStyle = "rgba(30, 39, 29, 0.80)";
      ctx.fill();
      ctx.strokeStyle = "#252e23";
      ctx.lineWidth = 3;
      ctx.stroke();

      // The pitch.
      ctx.fillStyle = "rgba(206,210,178,.2)";
      ctx.beginPath();
      for (const [i, [x, z]] of [[-1.5, 10.06], [1.5, 10.06], [1.5, -10.06], [-1.5, -10.06]].entries()) {
        const p = project(x, z);
        if (i === 0) ctx.moveTo(p.x, p.y); else ctx.lineTo(p.x, p.y);
      }
      ctx.closePath();
      ctx.fill();

      if (!live) return;

      // Fielders.
      ctx.fillStyle = "#f5d85c";
      for (const f of live.fielders) {
        const p = project(f.x, f.z);
        ctx.beginPath();
        ctx.ellipse(p.x, p.y, 4.5, 3.3, 0, 0, Math.PI * 2);
        ctx.fill();
      }

      // Green batsmen and a white ball echo the original's sparse field map.
      for (const z of [-10.06, 10.06]) {
        const p = project(0, z);
        ctx.beginPath();
        ctx.ellipse(p.x, p.y, 4.5, 3.3, 0, 0, Math.PI * 2);
        ctx.fillStyle = "#77d746";
        ctx.fill();
      }
      if (live.phase !== "idle") {
        const p = project(live.ballX, live.ballZ);
        ctx.beginPath();
        ctx.arc(p.x, p.y, 2.4, 0, Math.PI * 2);
        ctx.fillStyle = "#fffef1";
        ctx.fill();
      }
    };
    draw();
    return () => cancelAnimationFrame(raf);
  }, [live]);

  return (
    <div className="broadcast-radar pointer-events-none">
      <canvas ref={ref} aria-label="Field positions" style={{ width: "100%", height: "auto", aspectRatio: `${W}/${H}` }} />
    </div>
  );
}
