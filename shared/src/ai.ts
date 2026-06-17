import type { Flip7Player, Flip7Room } from "./types.js";
import { bonusTotal, numberTotal } from "./rules.js";

export type AiDecision = "hit" | "stay";

export function decideAiAction(room: Flip7Room, player: Flip7Player): AiDecision {
  if (player.status !== "active") return "stay";
  const uniqueNumbers = player.numberCards.length;
  const currentScore = numberTotal(player) + bonusTotal(player);
  const repeatRisk = Math.max(0.05, uniqueNumbers / 13);
  const protectedRisk = player.secondChances > 0 ? repeatRisk * 0.45 : repeatRisk;
  const closeToTarget = room.targetScore - player.totalScore <= Math.max(18, currentScore);
  if (uniqueNumbers >= 6) return player.secondChances > 0 && currentScore < 45 ? "hit" : "stay";
  if (closeToTarget && currentScore >= 18) return "stay";
  if (currentScore < 12) return "hit";
  if (currentScore >= 32 && protectedRisk > 0.25) return "stay";
  return Math.random() > protectedRisk + currentScore / 120 ? "hit" : "stay";
}

export function chooseAiTarget(room: Flip7Room, source: Flip7Player): Flip7Player | undefined {
  const action = room.pendingAction?.action;
  if (!action) return undefined;
  if (action === "second_chance") return source;
  const activeTargets = room.players.filter((player) => player.status === "active");
  if (activeTargets.length === 0) return undefined;
  return activeTargets.sort((a, b) => {
    const scoreA = a.totalScore + numberTotal(a) + bonusTotal(a);
    const scoreB = b.totalScore + numberTotal(b) + bonusTotal(b);
    return scoreB - scoreA;
  })[0];
}
