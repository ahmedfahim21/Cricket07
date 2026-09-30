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
  // Retain the release reading so bat contact cannot turn it into shot speed.
  const speedKph = Math.round((live?.deliverySpeed ?? 0) * 3.6);
  const bars = 16;
  // Full bar at 150kph, which is about as quick as anyone bowls.
  const litBars = Math.round((Math.min(speedKph, 150) / 150) * bars);

  return (
    <div className="broadcast-delivery pointer-events-none">
      <div className="broadcast-lamps" aria-hidden="true"><i>●</i><i /><i /><i /></div>
      <div className="broadcast-delivery-bars flex flex-col-reverse gap-[3px]">
        {Array.from({ length: bars }, (_, i) => (
          <div
            key={i}
            className="min-h-0 flex-1 w-[9px]"
            style={{
              background:
                i < litBars
                  ? "linear-gradient(#fff0a2, #e6c644 55%, #9a7825)"
                  : "rgba(120,150,120,0.16)",
            }}
          />
        ))}
      </div>

      <div className="broadcast-delivery-screen flex flex-col justify-between text-xs">
        <div>
          <div className="tracking-[0.16em] text-[var(--hud-muted)]">BOWLER</div>
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
