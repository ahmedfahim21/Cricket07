"use client";

import { useEffect, useRef, useState } from "react";
import { Game, type LiveState, type Telemetry } from "@/lib/game/engine";
import { CONTROL_HELP } from "@/lib/game/input/bindings";
import { DeliveryPanel } from "./hud/DeliveryPanel";
import { FadeOverlay } from "./hud/FadeOverlay";
import { FieldRadar } from "./hud/FieldRadar";
import { ScorePlate } from "./hud/ScorePlate";
import { ShotMeter } from "./hud/ShotMeter";

/**
 * Canvas host and HUD tree.
 *
 * React owns only slow-changing content — the scoreboard, the last event.
 * Everything that moves per frame reads `game.live` directly from its own rAF
 * inside the individual HUD components.
 */
export default function GameCanvas() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const gameRef = useRef<Game | null>(null);
  const [telemetry, setTelemetry] = useState<Telemetry | null>(null);
  const [live, setLive] = useState<LiveState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!canvasRef.current) return;
    const game = new Game(canvasRef.current, { onTelemetry: setTelemetry });
    gameRef.current = game;

    game
      .start()
      .then(() => {
        setLive(game.live);
        setLoading(false);
        // Debug handle, so the game can be driven from the console or from a
        // headless browser without playing it by hand.
        if (process.env.NODE_ENV !== "production") {
          (window as unknown as { __game: Game }).__game = game;
        }
      })
      .catch((e: unknown) => {
        setError(e instanceof Error ? e.message : String(e));
        setLoading(false);
      });

    return () => {
      game.dispose();
      gameRef.current = null;
    };
  }, []);

  return (
    <main className="relative h-screen w-screen overflow-hidden">
      <canvas ref={canvasRef} />
      <FadeOverlay live={live} />

      {loading && (
        <div className="absolute inset-0 grid place-items-center bg-[#0a0d0b]">
          <div className="text-center">
            <div className="text-sm tracking-[0.3em] text-[var(--hud-muted)]">
              PREPARING THE GROUND
            </div>
            <div className="mx-auto mt-4 h-px w-40 overflow-hidden bg-[var(--hud-green-dim)]">
              <div className="h-full w-1/3 animate-pulse bg-[var(--hud-green)]" />
            </div>
          </div>
        </div>
      )}

      {error && (
        <div className="absolute inset-0 grid place-items-center bg-[#0a0d0b] p-8">
          <div className="max-w-lg">
            <div className="text-sm tracking-[0.2em] text-[#e2554a]">FAILED TO START</div>
            <pre className="mt-3 overflow-auto text-xs text-[var(--hud-muted)]">{error}</pre>
          </div>
        </div>
      )}

      {!loading && !error && telemetry && (
        <>
          <DeliveryPanel live={live} telemetry={telemetry} />
          <FieldRadar live={live} />
          <ShotMeter live={live} />
          <ScorePlate match={telemetry.match} team="IND" />

          {/* Event banner — only while there is something to say. */}
          {telemetry.lastEvent && telemetry.phase === "idle" && (
            <div className="pointer-events-none absolute left-1/2 top-[22%] -translate-x-1/2">
              <div className="hud-plate hud-angled px-8 py-2.5 text-2xl tracking-wide">
                {telemetry.lastEvent}
              </div>
            </div>
          )}

          {/* Controls, shown between deliveries so they never cover the ball. */}
          {telemetry.phase === "idle" && (
            <div className="hud-plate pointer-events-none absolute bottom-4 right-4 p-3 text-xs">
              <div className="mb-1.5 tracking-[0.16em] text-[var(--hud-muted)]">CONTROLS</div>
              <table className="tabular">
                <tbody>
                  {CONTROL_HELP.map((c) => (
                    <tr key={c.action}>
                      <td className="pr-3 text-[var(--hud-green)]">{c.keys}</td>
                      <td className="text-[var(--hud-muted)]">{c.action}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </main>
  );
}
