"use client";

import { useEffect, useRef, type ReactNode } from "react";
import type { LiveState } from "@/lib/game/engine";

/** Keep stale delivery/score data out of broadcast cutaways until scoring finishes. */
export function GameplayHud({ live, children }: { live: LiveState | null; children: ReactNode }) {
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let raf = 0;
    const draw = () => {
      raf = requestAnimationFrame(draw);
      if (root.current) root.current.style.display = live?.moment ? "none" : "contents";
    };
    draw();
    return () => cancelAnimationFrame(raf);
  }, [live]);
  return <div ref={root} style={{ display: "contents" }}>{children}</div>;
}
