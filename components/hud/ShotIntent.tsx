"use client";

import { useEffect, useRef } from "react";
import type { LiveState } from "@/lib/game/engine";

/**
 * What the batsman is about to do, as the keys are held.
 *
 * Nearly every batting control in Cricket 07's scheme is a modifier — Shift
 * lofts, the up arrow defends, the arrows aim, A leaves, D charges — and none
 * of them moves anything on screen on its own. Held down with nothing to show
 * for it, a working modifier is indistinguishable from an unbound key, and the
 * first time you learn Shift registered is when the ball is already in the air.
 *
 * So this is a readout of `live.intent`, lit as each key goes down. It is the
 * confirmation the scheme needs to be learnable, not decoration.
 *
 * Drawn from its own rAF against `live` rather than from React state: it
 * changes on nearly every frame, and re-rendering a React tree at 60Hz to light
 * a chip costs more than the scene behind it.
 */
export function ShotIntent({ live }: { live: LiveState | null }) {
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = root.current;
    if (!el) return;
    const chips = Array.from(el.querySelectorAll<HTMLElement>("[data-chip]"));
    let raf = 0;
    const draw = () => {
      raf = requestAnimationFrame(draw);
      if (!live) return;
      // Only while there is a ball to play at, and never for the AI's innings.
      const batting = live.mode === "batting" && (live.phase === "runup" || live.phase === "flight");
      el.style.visibility = batting ? "visible" : "hidden";
      if (!batting) return;

      const i = live.intent;
      const state: Record<string, boolean> = {
        front: live.footwork === "front",
        back: live.footwork === "back",
        defensive: i.shot === "defensive",
        ground: i.shot === "ground",
        lofted: i.shot === "lofted",
        off: i.aim < 0,
        leg: i.aim > 0,
        square: i.square,
        leave: i.leave,
        advance: i.advance,
      };
      for (const chip of chips) {
        const on = state[chip.dataset.chip!] === true;
        chip.classList.toggle("is-on", on);
      }
      // The foot is chosen for you unless you hold S or W; say which it was,
      // because "FRONT" lit by itself looks like your input when it is not.
      el.dataset.auto = String(!i.manualFootwork);
    };
    draw();
    return () => cancelAnimationFrame(raf);
  }, [live]);

  return (
    <div ref={root} className="broadcast-intent" aria-hidden="true">
      <span className="broadcast-intent-row">
        <i data-chip="front">FRONT</i>
        <i data-chip="back">BACK</i>
        <b className="broadcast-intent-auto">AUTO</b>
      </span>
      <span className="broadcast-intent-row">
        <i data-chip="defensive">DEFEND</i>
        <i data-chip="ground">GROUND</i>
        <i data-chip="lofted">LOFT</i>
      </span>
      <span className="broadcast-intent-row">
        <i data-chip="off">◀ OFF</i>
        <i data-chip="square">SQUARE</i>
        <i data-chip="leg">LEG ▶</i>
      </span>
      <span className="broadcast-intent-row">
        <i data-chip="leave">LEAVING</i>
        <i data-chip="advance">CHARGING</i>
      </span>
    </div>
  );
}
