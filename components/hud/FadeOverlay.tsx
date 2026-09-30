"use client";

import { useEffect, useRef } from "react";
import type { LiveState } from "@/lib/game/engine";

/**
 * The cut to black between deliveries. Reads `live.fade` from its own rAF and
 * writes opacity straight to the element, so it never re-renders React.
 */
export function FadeOverlay({ live }: { live: LiveState | null }) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!live) return;
    let raf = 0;
    const tick = () => {
      raf = requestAnimationFrame(tick);
      if (ref.current) ref.current.style.opacity = String(live.fade);
    };
    tick();
    return () => cancelAnimationFrame(raf);
  }, [live]);

  return <div ref={ref} className="pointer-events-none absolute inset-0 bg-black" style={{ opacity: 0 }} />;
}
