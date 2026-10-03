"use client";

import { useEffect, useRef, useState } from "react";
import { Game, type LiveState, type Telemetry } from "@/lib/game/engine";
import { CONTROL_HELP, BOWLING_CONTROL_HELP, EXTRA_CONTROL_HELP } from "@/lib/game/input/bindings";
import { DeliveryPanel } from "./hud/DeliveryPanel";
import { FadeOverlay } from "./hud/FadeOverlay";
import { FieldRadar } from "./hud/FieldRadar";
import { ScorePlate } from "./hud/ScorePlate";
import { ShotMeter } from "./hud/ShotMeter";
import { ShotIntent } from "./hud/ShotIntent";
import { ChallengePanel } from "./hud/ChallengePanel";
import { BoundaryCelebration } from "./hud/BoundaryCelebration";
import { WicketPresentation } from "./hud/WicketPresentation";
import { GameplayHud } from "./hud/GameplayHud";
import { BowlingPanel } from "./hud/BowlingPanel";

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
      <canvas ref={canvasRef} tabIndex={0} aria-label="Cricket game" className="outline-none" />
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
          <BoundaryCelebration live={live} />
          <WicketPresentation live={live} />
          <GameplayHud live={live}>
            <DeliveryPanel live={live} telemetry={telemetry} />
            <FieldRadar live={live} />
            <ShotMeter live={live} balls={telemetry.match.ballsThisOver} />
            <ShotIntent live={live} />
            <ScorePlate
              match={telemetry.match}
              live={live}
              team={telemetry.mode === "bowling" ? "IND · AI" : "IND"}
              // Whoever is batting is chasing something, so the strip can ask
              // for a required rate in either mode.
              chase={telemetry.mode === "bowling" ? telemetry.bowling : telemetry.challenge}
            />
            {telemetry.mode === "batting"
              ? <ChallengePanel telemetry={telemetry} select={(level) => gameRef.current?.selectLevel(level)} bowl={() => gameRef.current?.bowl()} menu={() => gameRef.current?.showLevelSelect()} bowling={() => gameRef.current?.startBowling()} />
              : <BowlingPanel live={live} telemetry={telemetry} selectBowler={(i) => gameRef.current?.selectPlayerBowler(i)} pace={(value) => gameRef.current?.setPlayerPace(value)} bowl={() => gameRef.current?.bowl()} retry={() => gameRef.current?.startBowling()} menu={() => gameRef.current?.showLevelSelect()} nextOver={() => gameRef.current?.confirmBowlerChange()} />}
          </GameplayHud>

          {/* Event banner — only while there is something to say. */}
          {telemetry.lastEvent && telemetry.phase === "idle" && telemetry.lastEvent !== "FOUR" && telemetry.lastEvent !== "SIX" && (
            <div className="pointer-events-none absolute left-1/2 top-[22%] -translate-x-1/2">
              <div className="hud-plate hud-angled px-8 py-2.5 text-2xl tracking-wide">
                {telemetry.lastEvent}
              </div>
            </div>
          )}

          {/* Controls, shown between deliveries so they never cover the ball. */}
          {telemetry.phase === "idle" && (
            <div className="hud-plate broadcast-controls pointer-events-none absolute right-4 p-3 text-xs">
              <div className="mb-1.5 tracking-[0.16em] text-[var(--hud-muted)]">CRICKET 07 CONTROLS</div>
              <table className="tabular">
                <tbody>
                  {(telemetry.mode === "bowling" ? BOWLING_CONTROL_HELP : CONTROL_HELP).map((c) => (
                    <tr key={c.action}>
                      <td className="pr-3 text-[var(--hud-green)]">{c.keys}</td>
                      <td className="text-[var(--hud-muted)]">{c.action}</td>
                    </tr>
                  ))}
                  {/* Ours, not the original's: kept visibly apart. */}
                  <tr><td colSpan={2} className="pt-2 text-[var(--hud-muted)] opacity-60">— this build —</td></tr>
                  {EXTRA_CONTROL_HELP.map((c) => (
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
