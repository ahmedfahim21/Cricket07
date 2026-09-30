"use client";

import type { MatchState } from "@/lib/game/match/state";
import { oversText, scoreText } from "@/lib/game/match/state";

/**
 * The score plate along the bottom — the original's `AUS 23/9` bar.
 *
 * Angled ends and a green key line, with the score itself carrying the
 * hierarchy through size rather than weight.
 */
export function ScorePlate({ match, team }: { match: MatchState; team: string }) {
  const striker = match.batsmen[match.striker];
  const nonStriker = match.batsmen[match.nonStriker];

  return (
    <div className="pointer-events-none absolute bottom-0 left-1/2 flex -translate-x-1/2 items-stretch gap-px">
      <div className="hud-plate hud-angled flex items-center gap-3 px-6 py-1">
        <span className="text-xs tracking-[0.2em] text-[var(--hud-muted)]">{team}</span>
        <span className="tabular text-2xl leading-none text-[var(--hud-text)]">
          {scoreText(match)}
        </span>
        <span className="tabular text-xs text-[var(--hud-muted)]">({oversText(match)})</span>
      </div>

      <div className="hud-plate hud-angled-right flex items-center gap-5 px-6 py-1 text-xs">
        <Batsman name={striker.name} runs={striker.runs} balls={striker.ballsFaced} onStrike />
        <Batsman name={nonStriker.name} runs={nonStriker.runs} balls={nonStriker.ballsFaced} />
      </div>
    </div>
  );
}

function Batsman({
  name,
  runs,
  balls,
  onStrike,
}: {
  name: string;
  runs: number;
  balls: number;
  onStrike?: boolean;
}) {
  return (
    <span className={onStrike ? "text-[var(--hud-text)]" : "text-[var(--hud-muted)]"}>
      {onStrike ? "• " : ""}
      {name} <span className="tabular">{runs}</span>
      <span className="tabular text-[var(--hud-muted)]"> ({balls})</span>
    </span>
  );
}
