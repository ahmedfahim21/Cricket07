"use client";

import type { LiveState } from "@/lib/game/engine";
import type { Telemetry } from "@/lib/game/engine";

/**
 * The top-left picture-in-picture from the original, with the segmented
 * vertical meter down its left edge.
 *
 * Rather than a second render pass of the 3D scene — which would cost a whole
 * extra frame's worth of draw calls for a 150px box — this shows the delivery
 * information the small view was actually there to convey: bowler, pace, and
 * where the ball pitched.
 */
export function DeliveryPanel({
  live,
  telemetry,
}: {
  live: LiveState | null;
  telemetry: Telemetry | null;
}) {
  // Only meaningful while the ball is actually in play; parked between
  // deliveries it is just noise.
  const inPlay = live !== null && live.phase !== "idle";
  const speedKph = inPlay ? Math.round(live.ballSpeed * 3.6) : 0;
  const bars = 10;
  // Full bar at 150kph, which is about as quick as anyone bowls.
  const litBars = Math.round((Math.min(speedKph, 150) / 150) * bars);

  return (
    <div className="hud-plate pointer-events-none absolute left-4 top-4 flex gap-2 p-2">
      <div className="flex flex-col-reverse gap-[3px]">
        {Array.from({ length: bars }, (_, i) => (
          <div
            key={i}
            className="h-[7px] w-[9px]"
            style={{
              background:
                i < litBars
                  ? i > bars - 4
                    ? "var(--hud-amber)"
                    : "var(--hud-green)"
                  : "rgba(120,150,120,0.16)",
            }}
          />
        ))}
      </div>

      <div className="flex w-[150px] flex-col justify-between text-xs">
        <div>
          <div className="tracking-[0.16em] text-[var(--hud-muted)]">BOWLING</div>
          <div className="text-sm text-[var(--hud-text)]">
            {telemetry?.bowlerStyle.replace("-", " ") ?? "—"}
          </div>
        </div>

        <div className="tabular text-2xl leading-none text-[var(--hud-text)]">
          {speedKph > 0 ? speedKph : "—"}
          <span className="ml-1 text-xs text-[var(--hud-muted)]">kph</span>
        </div>

        <div>
          <div className="tracking-[0.16em] text-[var(--hud-muted)]">LENGTH</div>
          <div className="text-sm capitalize text-[var(--hud-text)]">
            {live?.pitchedLength?.replace(/-/g, " ") ?? "—"}
          </div>
        </div>
      </div>
    </div>
  );
}
