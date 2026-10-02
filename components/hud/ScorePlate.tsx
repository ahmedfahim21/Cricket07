"use client";

import type { MatchState } from "@/lib/game/match/state";
import type { LiveState } from "@/lib/game/engine";
import { oversText, scoreText } from "@/lib/game/match/state";
import {
  currentBowler,
  figuresText,
  overText,
  partnershipText,
  rateText,
  requiredRate,
  runRate,
} from "@/lib/game/match/scorecard";

export interface Chase {
  runsNeeded: number;
  ballsRemaining: number;
}

/**
 * The broadcast strip.
 *
 * Everything on it is derived from the scorebook on render rather than stored,
 * so a number on screen can never disagree with the balls that produced it; see
 * `match/scorecard.ts`. The release speed is the exception — it is a reading
 * taken at a moment, held by the engine, and deliberately unaffected by bat
 * contact or by a fielder's throw.
 *
 * Priority runs left to right, because that is the order the media queries drop
 * things in: score, speed and overs always survive; the over's reading, the
 * partnership and the rates go first on a narrow viewport.
 */
export function ScorePlate({
  match,
  team,
  live,
  chase,
}: {
  match: MatchState;
  team: string;
  live: LiveState | null;
  chase?: Chase;
}) {
  const striker = match.batsmen[match.striker];
  const nonStriker = match.batsmen[match.nonStriker];
  const bowler = currentBowler(match);
  const required = chase ? requiredRate(chase.runsNeeded, chase.ballsRemaining) : null;
  const over = overText(match);

  return (
    <div className="broadcast-score pointer-events-none" aria-label="Score, delivery speed and match figures">
      <div className="broadcast-score-team">
        <span>{team}</span>
        <span className="tabular">{scoreText(match)}</span>
      </div>
      <span className="broadcast-speed tabular">{live?.deliverySpeed ? Math.round(live.deliverySpeed * 2.236936) : "—"} MPH</span>
      <span className="broadcast-overs tabular">{oversText(match)} OV</span>

      {/* The over as a commentator reads it out. Empty between overs. */}
      {over && (
        <span className="broadcast-thisover" aria-label={`This over: ${over}`}>
          <Label>THIS OVER</Label>
          <span className="broadcast-thisover-balls tabular">{over}</span>
        </span>
      )}

      {/* One right-aligned group: the strip's inset belongs to it, not to each
          item, so dropping any of them at a narrow width cannot lose it. */}
      <div className="broadcast-right text-xs">
        <div className="broadcast-batsmen">
          <Batsman name={striker.name} runs={striker.runs} balls={striker.ballsFaced} onStrike />
          <Batsman name={nonStriker.name} runs={nonStriker.runs} balls={nonStriker.ballsFaced} />
        </div>

        <span className="broadcast-partnership">
          <Label>P&apos;SHIP</Label>
          <span className="tabular text-[var(--hud-text)]">{partnershipText(match)}</span>
        </span>

        {bowler && (
          <span className="broadcast-bowler" aria-label={`Bowling: ${bowler.name}, ${figuresText(bowler)}`}>
            <Label>BOWLING</Label>
            <span className="text-[var(--hud-text)]">{bowler.name}</span>
            <span className="tabular text-[var(--hud-amber)]">{figuresText(bowler)}</span>
          </span>
        )}

        <span className="broadcast-rates">
          <span>
            <Label>RR</Label>
            <span className="tabular text-[var(--hud-text)]">{rateText(runRate(match))}</span>
          </span>
          {required !== null && (
            <span>
              <Label>REQ</Label>
              <span className="tabular text-[var(--hud-amber)]">{rateText(required)}</span>
            </span>
          )}
        </span>
      </div>
    </div>
  );
}

/** The strip's small caps caption. Spacing carries it, not weight. */
function Label({ children }: { children: string }) {
  return <span className="broadcast-label">{children}</span>;
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
