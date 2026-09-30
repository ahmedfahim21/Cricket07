"use client";

import { useEffect, useRef } from "react";
import { BOUNDARY_SQUARE, BOUNDARY_STRAIGHT, INNER_CIRCLE_RADIUS } from "@/lib/game/dimensions";
import type { LiveState } from "@/lib/game/engine";

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
    // World (x, z) -> radar pixels. The pitch runs vertically, as it does in
    // the original, so Z maps to Y.
    const px = (x: number) => W / 2 + (x / BOUNDARY_SQUARE) * (W / 2 - 8);
    const py = (z: number) => H / 2 - (z / BOUNDARY_STRAIGHT) * (H / 2 - 8);

    const draw = () => {
      raf = requestAnimationFrame(draw);
      ctx.clearRect(0, 0, W, H);

      // The ground.
      ctx.beginPath();
      ctx.ellipse(W / 2, H / 2, W / 2 - 8, H / 2 - 8, 0, 0, Math.PI * 2);
      ctx.fillStyle = "#1c3a1e";
      ctx.fill();
      ctx.strokeStyle = "#4d7a4a";
      ctx.lineWidth = 1;
      ctx.stroke();

      // 30-yard circle.
      ctx.beginPath();
      ctx.ellipse(
        W / 2,
        H / 2,
        (INNER_CIRCLE_RADIUS / BOUNDARY_SQUARE) * (W / 2 - 8),
        (INNER_CIRCLE_RADIUS / BOUNDARY_STRAIGHT) * (H / 2 - 8),
        0,
        0,
        Math.PI * 2
      );
      ctx.strokeStyle = "rgba(160,200,150,0.35)";
      ctx.stroke();

      // The pitch.
      ctx.fillStyle = "#b9a274";
      ctx.fillRect(W / 2 - 2.5, py(10.06), 5, py(-10.06) - py(10.06));

      if (!live) return;

      // Fielders.
      ctx.fillStyle = "#e8d44a";
      for (const f of live.fielders) {
        ctx.beginPath();
        ctx.arc(px(f.x), py(f.z), 2.6, 0, Math.PI * 2);
        ctx.fill();
      }

      // The ball, while it is in play.
      if (live.phase !== "idle") {
        ctx.beginPath();
        ctx.arc(px(live.ballX), py(live.ballZ), 2.4, 0, Math.PI * 2);
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
