"use client";

import { useEffect, useRef } from "react";
import type { LiveState } from "@/lib/game/engine";
import { TIMING_BANDS } from "@/lib/game/match/shot";

const W = 210;
const H = 250;
const SEGMENTS = 21;

/** Curved broadcast gauge: pace in the main ribbon, batting timing on the narrow rail. */
export function ShotMeter({ live, balls }: { live: LiveState | null; balls: number }) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    const dpr = Math.min(window.devicePixelRatio, 2);
    canvas.width = W * dpr;
    canvas.height = H * dpr;
    ctx.scale(dpr, dpr);

    // Bow the ribbon outward at its base, like the reference's curved speed ladder.
    const edge = (t: number) => 48 + 72 * (t - 0.35) ** 2;
    const ribbon = (t0: number, t1: number, offset: number, width: number) => {
      ctx.beginPath();
      ctx.moveTo(edge(t0) + offset, 24 + t0 * 180);
      ctx.lineTo(edge(t0) + offset + width, 24 + t0 * 180);
      ctx.lineTo(edge(t1) + offset + width, 24 + t1 * 180);
      ctx.lineTo(edge(t1) + offset, 24 + t1 * 180);
      ctx.closePath();
    };

    let raf = 0;
    const draw = () => {
      raf = requestAnimationFrame(draw);
      ctx.clearRect(0, 0, W, H);
      const bowling = live?.mode === "bowling";
      const error = live?.phase === "flight" ? live.timingError : null;
      const progress = error === null ? 0 : Math.max(0, Math.min(1, (error + 0.3) / 0.6));
      const goodWindow = TIMING_BANDS.find((b) => b.band === "good")!.within;
      const pace = bowling && (live.phase === "idle" || live.phase === "runup")
        ? live.bowling.aim.pace : Math.min(1, (live?.deliverySpeed ?? 0) * 3.6 / 160);

      // The dark backing keeps the narrow illuminated bars legible over bright grass.
      for (let i = 0; i < SEGMENTS; i++) {
        const t = i / SEGMENTS;
        const bottom = (i + 0.76) / SEGMENTS;
        ribbon(t, (i + 1) / SEGMENTS, -4, 79);
        ctx.fillStyle = "#171e18";
        ctx.fill();
        ribbon(t, bottom, 0, 68);
        const gradient = ctx.createLinearGradient(0, 24 + t * 180, 0, 31 + t * 180);
        const lit = 1 - t <= pace;
        const color = t < 0.28 ? "#ed9946" : t < 0.7 ? "#e5ce59" : "#7dbb49";
        gradient.addColorStop(0, lit ? "#f5eab0" : "#586052");
        gradient.addColorStop(0.35, lit ? color : "#323b30");
        gradient.addColorStop(1, "#1d291a");
        ctx.fillStyle = gradient;
        ctx.fill();

        ribbon(t, bottom, -23, 13);
        const segmentError = (1 - t) * 0.6 - 0.3;
        const inWindow = Math.abs(segmentError) <= goodWindow;
        ctx.fillStyle = bowling ? "#6fa849" : inWindow ? "#a6ef67" : "#385e32";
        ctx.fill();
        ctx.strokeStyle = "#142114";
        ctx.lineWidth = 2;
        ctx.stroke();
      }
      ribbon(-0.12, 0, 0, 68);
      ctx.fillStyle = "rgba(31,40,32,.83)";
      ctx.fill();
      ctx.strokeStyle = "#7e8976";
      ctx.lineWidth = 2;
      ctx.stroke();

      const cursor = bowling ? 1 - pace : 1 - progress;
      const y = 24 + cursor * 180;
      ctx.fillStyle = "#131b13";
      ctx.fillRect(edge(cursor) - 30, y - 3, 108, 7);
      ctx.fillStyle = "#b4bf9e";
      ctx.fillRect(edge(cursor) - 30, y - 3, 108, 2);

      ctx.font = "bold 10px Arial, sans-serif";
      ctx.textAlign = "left";
      ctx.fillStyle = "#f2e7ad";
      ctx.shadowColor = "#000";
      ctx.shadowBlur = 4;
      const label = bowling ? "DELIVERY PACE" : live?.lastBand ? live.shotFeedback.toUpperCase()
        : error !== null && Math.abs(error) <= goodWindow ? "HIT NOW" : "TIME YOUR SHOT";
      ctx.fillText(label, 20, 244);
      ctx.shadowBlur = 0;
    };
    draw();
    return () => cancelAnimationFrame(raf);
  }, [live]);

  return <div className="broadcast-meter pointer-events-none">
    <canvas ref={ref} aria-label="Curved delivery pace and shot timing gauge" style={{ width: "100%", height: "auto", aspectRatio: `${W}/${H}` }} />
    <div className="broadcast-over" aria-label={`${balls} balls completed this over`}>
      {Array.from({ length: 6 }, (_, i) => <span key={i} className={i < balls ? "is-bowled" : ""} />)}
    </div>
  </div>;
}
