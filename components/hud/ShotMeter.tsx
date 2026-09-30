"use client";

import { useEffect, useRef } from "react";
import type { LiveState } from "@/lib/game/engine";

const W = 190;
const H = 118;
const SEGMENTS = 14;

/**
 * The bottom-left curved segmented arc from the original.
 *
 * It fills as the ball approaches, so the moment to press is a thing you SEE
 * rather than a thing you guess: the timing window sits at the top of the arc
 * and is marked, and the fill sweeps through it. Same rAF-not-React reasoning
 * as the radar — this redraws every frame while the ball is live.
 */
export function ShotMeter({ live }: { live: LiveState | null }) {
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

    const cx = W / 2;
    const cy = H - 8;
    const rOuter = 86;
    const rInner = 58;
    const START = Math.PI * 1.03;
    const END = Math.PI * 1.97;

    let raf = 0;
    const draw = () => {
      raf = requestAnimationFrame(draw);
      ctx.clearRect(0, 0, W, H);

      const approach = live?.phase === "flight" ? live.approach : 0;
      const lit = Math.round(approach * SEGMENTS);

      for (let i = 0; i < SEGMENTS; i++) {
        const a0 = START + ((END - START) * i) / SEGMENTS;
        const a1 = START + ((END - START) * (i + 1)) / SEGMENTS - 0.012;

        // The timing window is the last few segments; past it you are late.
        const isWindow = i >= SEGMENTS - 4 && i < SEGMENTS - 1;

        ctx.beginPath();
        ctx.arc(cx, cy, rOuter, a0, a1);
        ctx.arc(cx, cy, rInner, a1, a0, true);
        ctx.closePath();

        if (i < lit) {
          ctx.fillStyle = isWindow ? "#7dd66a" : "#4f9e46";
        } else {
          // Unlit segments need to read against bright grass, so they carry a
          // dark fill plus an outline rather than being faintly tinted.
          ctx.fillStyle = isWindow ? "rgba(125,214,106,0.3)" : "rgba(8,14,10,0.62)";
        }
        ctx.fill();
        ctx.strokeStyle = "rgba(150,200,160,0.3)";
        ctx.lineWidth = 1;
        ctx.stroke();
      }

      // Band label.
      if (live?.lastBand && live.phase !== "flight") {
        ctx.fillStyle =
          live.lastBand === "perfect"
            ? "#7dd66a"
            : live.lastBand === "good"
              ? "#c9dd6a"
              : live.lastBand === "missed"
                ? "#e2554a"
                : "#e8c44a";
        ctx.font = "15px ui-sans-serif, system-ui, sans-serif";
        ctx.textAlign = "center";
        ctx.fillText(live.lastBand.toUpperCase(), cx, cy - 26);
      }
    };
    draw();
    return () => cancelAnimationFrame(raf);
  }, [live]);

  return (
    <div className="pointer-events-none absolute bottom-3 left-4">
      <canvas ref={ref} style={{ width: W, height: H }} />
    </div>
  );
}
