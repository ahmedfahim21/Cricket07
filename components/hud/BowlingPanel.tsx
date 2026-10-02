"use client";

import type { LiveState, Telemetry } from "@/lib/game/engine";
import { BOWLERS, BOWLING_TARGET, BOWLING_OVERS, isSpinner } from "@/lib/game/match/player-bowling";
import { classifyLength } from "@/lib/game/physics/pitch";

interface Props {
  live: LiveState | null;
  telemetry: Telemetry;
  selectBowler: (index: number) => void;
  pace: (value: number) => void;
  bowl: () => void;
  retry: () => void;
  menu: () => void;
  nextOver: () => void;
}
const button = "rounded border border-[#7dd66a]/50 bg-[#14261d] px-4 py-2 text-sm text-[#e1efdd] hover:bg-[#25422d] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#7dd66a] disabled:cursor-not-allowed disabled:opacity-40";

/** One control set for every specialist; delivery locking remains engine-authoritative. */
export function BowlingPanel({ live, telemetry: t, selectBowler, pace, bowl, retry, menu, nextOver }: Props) {
  if (!live) return null;
  const b = t.bowling;
  const profile = BOWLERS[b.bowler];
  const aim = live.bowling.aim;
  const kph = Math.round(profile.minKph + (profile.maxKph - profile.minKph) * aim.pace);
  const finished = b.result !== "playing" && t.phase === "idle";
  const ready = t.challenge.screen === "ready";
  const changeBowler = b.changePending && t.phase === "idle" && !finished;
  const editable = t.phase === "idle" || (t.phase === "runup" && !live.bowling.locked);
  // A/D mean different things to a seamer and a spinner, so they are named for
  // whoever is actually bowling rather than with a word that fits neither.
  const variation = isSpinner(profile.style) ? "A / D — turn" : "A / D — swing";
  const selectors = <>
    <label className="block text-xs tracking-wider text-[var(--hud-muted)]" htmlFor="player-bowler">YOUR BOWLER</label>
    <select id="player-bowler" value={b.bowler} disabled={t.phase !== "idle"} onChange={(e) => selectBowler(Number(e.target.value))} className="mt-2 w-full rounded border border-[#7dd66a]/40 bg-[#14261d] p-2 text-sm disabled:opacity-60">
      {BOWLERS.map((p, i) => <option key={p.name} value={i}>{p.name} · {p.style.replace(/-/g, " ")}</option>)}
    </select>
    <p className="mt-2 text-xs text-[var(--hud-muted)]">{profile.description}</p>
    <label htmlFor="bowling-pace" className="mt-4 flex justify-between text-sm"><span>Delivery pace</span><span className="tabular-nums text-[var(--hud-green)]">{kph} km/h</span></label>
    <input id="bowling-pace" aria-label="Delivery pace" type="range" min="0" max="100" value={Math.round(aim.pace * 100)} disabled={!editable} onChange={(e) => pace(Number(e.target.value) / 100)} className="mt-2 w-full accent-[#7dd66a] disabled:opacity-50" />
    <div className="flex justify-between text-[10px] text-[var(--hud-muted)]"><span>{profile.minKph} km/h · S slower</span><span>W quicker · {profile.maxKph} km/h</span></div>
    <p className="mt-3 text-xs text-[var(--hud-muted)]">{variation}: <span className="tabular-nums text-[var(--hud-green)]">{aim.swing === 0 ? "stock ball" : `${aim.swing > 0 ? "+" : ""}${Math.round(aim.swing * 100)}%`}</span></p>
  </>;

  if (ready || finished || changeBowler) return <div className="absolute inset-0 z-20 flex items-center justify-center overflow-y-auto bg-[#07110c]/80 p-5">
    <section aria-label="Bowling challenge" className="hud-plate my-auto w-full max-w-xl rounded-lg p-6 sm:p-8">
      <p className="text-xs tracking-[0.24em] text-[var(--hud-green)]">YOU BOWL · AI BATS</p>
      <h1 className="mt-3 text-3xl">{finished ? b.result === "won" ? "Defence complete!" : "Target chased down" : changeBowler ? "Over complete — choose your bowler" : "Defend the total"}</h1>
      <p className="mt-3 text-xl">{finished || changeBowler ? `Opposition ${t.match.runs}/${t.match.wickets}` : `Keep them below ${BOWLING_TARGET} in ${BOWLING_OVERS} overs`}</p>
      <p className="mt-2 text-sm text-[var(--hud-muted)]">{changeBowler ? `${t.match.overs} over complete · AI needs ${b.runsNeeded} from ${b.ballsRemaining} balls. Choose your next bowler and confirm when ready.` : finished ? `${b.ballsRemaining} balls left · ${t.match.extras} extras conceded` : "Take three wickets or defend the target. Wide balls cost a run and must be bowled again."}</p>
      {!finished && <div className="my-5">{selectors}
        {!changeBowler && <div className="mt-5 space-y-2 text-sm text-[var(--hud-muted)]">
          <p><span className="text-[var(--hud-green)]">← ↑ ↓ →</span> — move the landing ring during the run-up. Up is fuller; down is shorter.</p>
          <p><span className="text-[var(--hud-green)]">W / S</span> — the quicker and slower ball, within your bowler’s range.</p>
          <p><span className="text-[var(--hud-green)]">A / D</span> — {isSpinner(profile.style) ? "less or more turn off the pitch. Which way it turns is his action, not your choice." : "tilt the seam: swing it away from the right-hander, or into him."}</p>
          <p><span className="text-[var(--hud-green)]">Space</span> — lock the delivery, or let it lock automatically just before the crease.</p>
          <p>The AI reads the released ball, chooses footwork and plays its own shots. Fielding is automatic.</p>
        </div>}
      </div>}
      <div className="mt-5 flex gap-3"><button className={button} onClick={finished ? retry : changeBowler ? nextOver : bowl}>{finished ? "Bowl again" : changeBowler ? "Start next over" : "Start bowling · Space"}</button><button className={button} onClick={menu}>Batting challenges</button></div>
    </section>
  </div>;

  return <>
    <div className="hud-plate pointer-events-none absolute left-1/2 top-4 -translate-x-1/2 px-5 py-3 text-center">
      <div className="text-xs tracking-widest text-[var(--hud-muted)]">YOU BOWL · DEFEND {BOWLING_TARGET}</div>
      <div className="mt-1 text-lg tabular-nums">AI needs {b.runsNeeded} from {b.ballsRemaining} balls</div>
      <div className="text-xs text-[var(--hud-muted)]">{b.wicketsRemaining} wickets to win · {t.match.extras} extras</div>
    </div>
    <section aria-label="Bowling controls" className="hud-plate broadcast-bowling-panel absolute w-72 max-w-[calc(100vw-2rem)] rounded p-4">
      {selectors}
      <div className="mt-4 border-t border-white/10 pt-3 text-xs">
        <div className="font-bold tracking-widest text-[var(--hud-green)]">{t.phase === "idle" ? "READY TO BOWL" : t.phase === "runup" ? live.bowling.locked ? "DELIVERY LOCKED" : "AIM YOUR DELIVERY" : "BALL IN PLAY"}</div>
        <p className="mt-1 capitalize">{classifyLength(aim.length).replace(/-/g, " ")} · {aim.length.toFixed(1)} m · {Math.abs(aim.line) < 0.1 ? "middle" : `${Math.abs(aim.line).toFixed(2)} m ${aim.line < 0 ? "off" : "leg"}`}</p>
        {t.phase === "runup" && <><div className="my-2 h-1 overflow-hidden rounded bg-white/10"><div className="h-full bg-[#7dd66a]" style={{ width: `${live.bowling.runup * 100}%` }} /></div><p className="text-[var(--hud-muted)]">Arrows aim · W/S pace · A/D {isSpinner(profile.style) ? "turn" : "swing"} · Space lock</p></>}
        {live.bowling.aiDecision && <p className="mt-2 text-[var(--hud-muted)]">AI: {live.bowling.aiDecision}</p>}
      </div>
      {t.phase === "idle" && <div className="mt-3 flex gap-2"><button className={button} onClick={bowl}>Bowl · Space</button><button className={button} onClick={menu}>Menu</button></div>}
    </section>
  </>;
}
