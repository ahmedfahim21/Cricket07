"use client";

import { useEffect, useRef } from "react";
import { BOUNDARY_SQUARE, BOUNDARY_STRAIGHT, INNER_CIRCLE_RADIUS } from "@/lib/game/dimensions";
import type { LiveState } from "@/lib/game/engine";
import { radarPoint } from "@/lib/game/presentation/radar";

const W = 148;
const H = 132;

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
      ctx.fillStyle = "#1c3a1e";
      ctx.fill();
      ctx.strokeStyle = "#4d7a4a";
      ctx.lineWidth = 1;
      ctx.stroke();

      // 30-yard circle.
      ellipse(INNER_CIRCLE_RADIUS, INNER_CIRCLE_RADIUS);
      ctx.strokeStyle = "rgba(160,200,150,0.35)";
      ctx.stroke();

      // The pitch.
      ctx.fillStyle = "#b9a274";
      ctx.beginPath();
      for (const [i, [x, z]] of [[-1.5, 10.06], [1.5, 10.06], [1.5, -10.06], [-1.5, -10.06]].entries()) {
        const p = project(x, z);
        if (i === 0) ctx.moveTo(p.x, p.y); else ctx.lineTo(p.x, p.y);
      }
      ctx.closePath();
      ctx.fill();

      if (!live) return;

      // Fielders.
      ctx.fillStyle = "#e8d44a";
      for (const f of live.fielders) {
        const p = project(f.x, f.z);
        ctx.beginPath();
        ctx.arc(p.x, p.y, 2.6, 0, Math.PI * 2);
        ctx.fill();
      }

      // The ball, while it is in play.
      if (live.phase !== "idle") {
        const p = project(live.ballX, live.ballZ);
        ctx.beginPath();
        ctx.arc(p.x, p.y, 2.4, 0, Math.PI * 2);
        ctx.fillStyle = "#ff5a4a";
        ctx.fill();
      }
    };
    draw();
    return () => cancelAnimationFrame(raf);
  }, [live]);

  return (
    <div className="hud-plate pointer-events-none absolute right-4 top-4 rounded-sm p-1.5">
      <canvas ref={ref} style={{ width: W, height: H }} />
    </div>
  );
}
