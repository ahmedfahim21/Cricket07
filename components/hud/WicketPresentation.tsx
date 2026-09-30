"use client";

import { useEffect, useRef } from "react";
import type { LiveState } from "@/lib/game/engine";

/** Read the dismissal snapshot, not the next batsman installed by the scorer. */
export function WicketPresentation({ live }: { live: LiveState | null }) {
  const panel = useRef<HTMLDivElement>(null);
  const title = useRef<HTMLDivElement>(null);
  const name = useRef<HTMLDivElement>(null);
  const stats = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!live) return;
    let raf = 0;
    const draw = () => {
      raf = requestAnimationFrame(draw);
      if (!panel.current) return;
      const batter = live.moment?.dismissed;
      panel.current.hidden = !batter;
      if (!batter) return;
      panel.current.style.opacity = String(1 - live.fade);
      // Avoid repeatedly announcing unchanged live-region text on every frame.
      const heading = live.momentShot === "walkoff" ? `DISMISSED · ${batter.dismissal?.toUpperCase()}` : "WICKET!";
      const score = `${batter.runs} RUNS   ·   ${batter.ballsFaced} BALLS`;
      if (title.current && title.current.textContent !== heading) title.current.textContent = heading;
      if (name.current && name.current.textContent !== batter.name) name.current.textContent = batter.name;
      if (stats.current && stats.current.textContent !== score) stats.current.textContent = score;
    };
    draw();
    return () => cancelAnimationFrame(raf);
  }, [live]);
  return <div ref={panel} hidden role="status" aria-live="polite" data-testid="wicket-presentation" className="pointer-events-none absolute bottom-6 left-1/2 z-20 w-[min(90vw,520px)] -translate-x-1/2 border-l-4 border-[#ef795e] bg-[#0b191a]/95 px-6 py-4 shadow-2xl">
    <div ref={title} className="text-xs tracking-[0.22em] text-[#ff9b80]" />
    <div ref={name} className="mt-1 text-2xl font-bold text-white" />
    <div ref={stats} className="tabular mt-1 text-sm tracking-widest text-[#d6e8cf]" />
  </div>;
}
