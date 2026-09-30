"use client";

import type { MatchState } from "@/lib/game/match/state";
import type { LiveState } from "@/lib/game/engine";
import { oversText, scoreText } from "@/lib/game/match/state";

/** Broadcast strip with the release speed, unaffected by bat contact or fielding throws. */
export function ScorePlate({ match, team, live }: { match: MatchState; team: string; live: LiveState | null }) {
  const striker = match.batsmen[match.striker];
  const nonStriker = match.batsmen[match.nonStriker];

  return (
    <div className="broadcast-score pointer-events-none" aria-label="Score and delivery speed">
      <div className="broadcast-score-team">
        <span>{team}</span>
        <span className="tabular">
          {scoreText(match)}
        </span>
      </div>
      <span className="broadcast-speed tabular">{live?.deliverySpeed ? Math.round(live.deliverySpeed * 2.236936) : "—"} MPH</span>
      <span className="broadcast-overs tabular">{oversText(match)} OV</span>
      <div className="broadcast-batsmen flex items-center gap-5 text-xs">
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
