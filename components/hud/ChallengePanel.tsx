"use client";

import type { Telemetry } from "@/lib/game/engine";
import { CHALLENGES } from "@/lib/game/match/challenges";

interface Props {
  telemetry: Telemetry;
  select: (level: number) => void;
  bowl: () => void;
  menu: () => void;
  bowling: () => void;
}

/** Slow-changing challenge UI; the engine remains the authority for unlocks and results. */
export function ChallengePanel({ telemetry: t, select, bowl, menu, bowling }: Props) {
  const c = t.challenge;
  const level = CHALLENGES[c.level];
  const button = "rounded border border-[#7dd66a]/50 bg-[#14261d] px-4 py-2 text-sm text-[#e1efdd] hover:bg-[#25422d] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#7dd66a] disabled:cursor-not-allowed disabled:opacity-40";
  const finished = c.result !== "playing" && t.phase === "idle";
  const overlay = c.screen === "select" || c.screen === "ready" || finished;

  return <>
    {!overlay && <div className="hud-plate pointer-events-none absolute left-1/2 top-4 -translate-x-1/2 px-5 py-3 text-center">
      <div className="text-xs tracking-widest text-[var(--hud-muted)]">LEVEL {level.id + 1} · TARGET {level.target}</div>
      <div className="mt-1 text-lg tabular-nums">{c.runsNeeded} from {c.ballsRemaining} balls</div>
      <div className="text-xs text-[var(--hud-muted)]">{c.wicketsRemaining} wickets left</div>
    </div>}
    {!overlay && t.phase === "idle" && <button className={`${button} absolute right-4 top-1/3`} onClick={menu}>Levels</button>}
    {overlay && <div className="absolute inset-0 z-20 flex items-center justify-center overflow-y-auto bg-[#07110c]/80 p-5">
      <section aria-label="Challenge ladder" className="hud-plate my-auto w-full max-w-xl rounded-lg p-6 sm:p-8">
        <p className="text-xs tracking-[0.24em] text-[var(--hud-green)]">CRICKET · CHALLENGE LADDER</p>
        {c.screen === "select" ? <>
          <h1 className="mt-3 text-3xl">Chase it down</h1>
          <p className="mt-2 text-sm text-[var(--hud-muted)]">Five chases. Three wickets each. Find the gaps and clear the rope.</p>
          <button className={`${button} mt-4 w-full border-[#ffe078]/60 text-[#ffe078]`} onClick={bowling}>Try bowling · defend 24 runs</button>
          <div className="mt-5 grid gap-2">
            {CHALLENGES.map((l) => <button key={l.id} disabled={l.id > c.progress.unlocked} className={`${button} flex items-center justify-between text-left`} onClick={() => select(l.id)}>
              <span><span className="mr-3 text-[var(--hud-green)]">0{l.id + 1}</span>{l.name}
                {c.progress.best[l.id] !== undefined && <span className="ml-2 text-xs text-[var(--hud-green)]">✓ Best {c.progress.best[l.id]}</span>}</span>
              <span className="ml-3 text-xs text-[var(--hud-muted)]">{l.id > c.progress.unlocked ? "Locked" : `${l.target} in ${l.overs} overs`}</span>
            </button>)}
          </div>
        </> : c.screen === "ready" ? <>
          <h1 className="mt-3 text-3xl">{level.name}</h1>
          <p className="mt-3 text-xl">Score {level.target} in {level.overs} overs</p>
          <p className="mt-2 text-sm text-[var(--hud-muted)]">Three wickets. Automatic footwork. Generous timing.</p>
          <div className="my-5 space-y-2 text-sm text-[var(--hud-muted)]">
            <p><span className="text-[var(--hud-green)]">WASD</span> — move during the run-up. Watch the ring settle on the bounce point.</p>
            <p><span className="text-[var(--hud-green)]">← →</span> — aim · <span className="text-[var(--hud-green)]">↑ ↓</span> — override footwork</p>
            <p><span className="text-[var(--hud-green)]">X / Space</span> — ground shot · <span className="text-[var(--hud-green)]">C</span> — loft · <span className="text-[var(--hud-green)]">Z</span> — defend</p>
            <p>Press your shot key as the timing meter enters green.</p>
          </div>
          <div className="flex gap-3"><button className={button} onClick={bowl}>Play · R</button><button className={button} onClick={menu}>Levels</button></div>
        </> : <>
          <h1 className="mt-3 text-3xl">{c.result === "won" ? c.level === CHALLENGES.length - 1 ? "Ladder complete!" : "Chase complete!" : "Give it another go"}</h1>
          <p className="mt-3 text-xl tabular-nums">{t.match.runs}/{t.match.wickets} · Target {level.target}</p>
          <p className="mt-2 text-sm text-[var(--hud-muted)]">{c.result === "won" ? `${c.ballsRemaining} balls to spare.` : c.wicketsRemaining === 0 ? "Three wickets down." : "Out of deliveries."}</p>
          <div className="mt-6 flex flex-wrap gap-3">
            {c.result === "won" && c.level < CHALLENGES.length - 1 && <button className={button} onClick={() => select(c.level + 1)}>Next level</button>}
            <button className={button} onClick={() => select(c.level)}>Retry</button>
            <button className={button} onClick={menu}>Level select</button>
          </div>
        </>}
      </section>
    </div>}
  </>;
}
