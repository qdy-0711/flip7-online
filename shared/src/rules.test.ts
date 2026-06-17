import { describe, expect, it } from "vitest";
import {
  applyCardToPlayer,
  buildRoundSummary,
  createFlip7Deck,
  decideAiAction,
  finishRound,
  makePlayer,
  sanitizeState,
  shouldEndRound,
  stayPlayer
} from "./index.js";
import type { Flip7Card, Flip7Room } from "./types.js";

function roomWithPlayers(count = 2): Flip7Room {
  return {
    code: "TEST",
    players: Array.from({ length: count }, (_, index) => makePlayer(`p${index}`, `玩家${index + 1}`, index)),
    hostPlayerId: "p0",
    phase: "playing",
    deck: [],
    discardPile: [],
    currentTurnIndex: 0,
    pendingActionQueue: [],
    targetScore: 200,
    roundNumber: 1,
    roundLog: []
  };
}

const numberCard = (value: number, id = `n-${value}`): Flip7Card => ({ id, type: "number", value });
const bonusCard = (value: number): Flip7Card => ({ id: `b-${value}`, type: "bonus", value });

describe("Flip 7 rules", () => {
  it("builds the configured 94-card deck", () => {
    const deck = createFlip7Deck();
    expect(deck).toHaveLength(94);
    expect(deck.filter((card) => card.type === "number" && card.value === 0)).toHaveLength(1);
    expect(deck.filter((card) => card.type === "number" && card.value === 12)).toHaveLength(12);
    expect(deck.filter((card) => card.type === "action")).toHaveLength(9);
    expect(deck.filter((card) => card.type === "bonus")).toHaveLength(6);
  });

  it("busts on a repeated number", () => {
    const room = roomWithPlayers();
    const player = room.players[0];
    applyCardToPlayer(room, player, numberCard(8, "a"));
    applyCardToPlayer(room, player, numberCard(8, "b"));
    expect(player.status).toBe("busted");
    expect(player.roundScore).toBe(0);
    expect(player.bustedCards.map((card) => (card.type === "number" ? card.value : -1))).toEqual([8]);
  });

  it("uses and consumes Second Chance instead of busting", () => {
    const room = roomWithPlayers();
    const player = room.players[0];
    player.secondChances = 1;
    applyCardToPlayer(room, player, numberCard(5, "a"));
    applyCardToPlayer(room, player, numberCard(5, "b"));
    expect(player.status).toBe("active");
    expect(player.secondChances).toBe(0);
    expect(player.numberCards).toHaveLength(1);
  });

  it("keeps round score after Stay", () => {
    const room = roomWithPlayers();
    const player = room.players[0];
    applyCardToPlayer(room, player, numberCard(10));
    applyCardToPlayer(room, player, bonusCard(4));
    stayPlayer(room, player);
    expect(player.status).toBe("stayed");
    expect(player.roundScore).toBe(14);
  });

  it("adds Flip 7 bonus when seven different numbers are visible", () => {
    const room = roomWithPlayers();
    const player = room.players[0];
    for (let value = 1; value <= 7; value += 1) {
      applyCardToPlayer(room, player, numberCard(value));
    }
    expect(player.roundResult).toBe("flip7");
    expect(player.roundScore).toBe(43);
  });

  it("enters summary after all players Stay or Bust", () => {
    const room = roomWithPlayers();
    stayPlayer(room, room.players[0]);
    room.players[1].status = "busted";
    expect(shouldEndRound(room)).toBe(true);
    finishRound(room);
    expect(room.phase).toBe("round_summary");
  });

  it("finishes the game when a player reaches target score", () => {
    const room = roomWithPlayers();
    room.players[0].totalScore = 195;
    room.players[0].roundScore = 8;
    room.players[0].status = "stayed";
    room.players[1].status = "busted";
    finishRound(room);
    expect(room.phase).toBe("finished");
    expect(room.winnerIds).toContain("p0");
  });

  it("records Freeze as a Stay result when applied by server logic", () => {
    const room = roomWithPlayers();
    applyCardToPlayer(room, room.players[1], numberCard(9));
    stayPlayer(room, room.players[1]);
    expect(room.players[1].status).toBe("stayed");
    expect(room.players[1].roundScore).toBe(9);
  });

  it("can represent Flip Three drawing three cards", () => {
    const room = roomWithPlayers();
    const target = room.players[1];
    [numberCard(1), numberCard(2), numberCard(3)].forEach((card) => applyCardToPlayer(room, target, card));
    expect(target.numberCards.map((card) => (card.type === "number" ? card.value : -1))).toEqual([1, 2, 3]);
    expect(target.roundScore).toBe(6);
  });

  it("AI decision never asks an inactive player to hit", () => {
    const room = roomWithPlayers();
    const player = room.players[0];
    player.status = "busted";
    expect(decideAiAction(room, player)).toBe("stay");
  });

  it("sanitizeState hides deck order", () => {
    const room = roomWithPlayers();
    room.deck = [numberCard(1), numberCard(12), bonusCard(6)];
    const state = sanitizeState(room);
    expect(state.deckCount).toBe(3);
    expect("deck" in state).toBe(false);
  });

  it("builds round summary with score details", () => {
    const room = roomWithPlayers();
    applyCardToPlayer(room, room.players[0], numberCard(7));
    stayPlayer(room, room.players[0]);
    const summary = buildRoundSummary(room);
    expect(summary[0]).toMatchObject({ numberTotal: 7, roundScore: 7, status: "Stay" });
  });
});
