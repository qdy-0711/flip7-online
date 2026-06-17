import { flip7Config } from "./config.js";
import type { Flip7Action, Flip7Card, Flip7Config, Flip7Player, Flip7Room, Flip7RoundSummary, PublicFlip7Room } from "./types.js";

const actions: Flip7Action[] = ["second_chance", "freeze", "flip_three"];

export function createFlip7Deck(config: Flip7Config = flip7Config): Flip7Card[] {
  const deck: Flip7Card[] = [];
  for (let value = 0; value <= 12; value += 1) {
    const copies = value === 0 ? 1 : value;
    for (let copy = 0; copy < copies; copy += 1) {
      deck.push({ id: `n-${value}-${copy}`, type: "number", value });
    }
  }
  for (const action of actions) {
    for (let copy = 0; copy < config.actionCopies; copy += 1) {
      deck.push({ id: `a-${action}-${copy}`, type: "action", action });
    }
  }
  config.bonusValues.forEach((value, index) => {
    deck.push({ id: `b-${value}-${index}`, type: "bonus", value });
  });
  return deck;
}

export function shuffleDeck<T>(items: T[], random = Math.random): T[] {
  const copy = [...items];
  for (let index = copy.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(random() * (index + 1));
    [copy[index], copy[swapIndex]] = [copy[swapIndex], copy[index]];
  }
  return copy;
}

export function numberTotal(player: Flip7Player): number {
  return player.numberCards.reduce((sum, card) => sum + (card.type === "number" ? card.value : 0), 0);
}

export function bonusTotal(player: Flip7Player): number {
  return player.bonusCards.reduce((sum, card) => sum + (card.type === "bonus" ? card.value : 0), 0);
}

export function visibleRoundScore(player: Flip7Player): number {
  if (player.status === "busted") return 0;
  return numberTotal(player) + bonusTotal(player);
}

export function recalculateRoundScore(player: Flip7Player): void {
  player.roundScore = visibleRoundScore(player);
}

export function makePlayer(id: string, nickname: string, seatIndex: number, isAI = false): Flip7Player {
  return {
    id,
    nickname,
    seatIndex,
    connected: true,
    ready: isAI,
    isAI,
    status: "active",
    numberCards: [],
    bonusCards: [],
    bustedCards: [],
    secondChances: 0,
    roundScore: 0,
    totalScore: 0,
    roundResult: "active"
  };
}

export function startRound(room: Flip7Room, config: Flip7Config = flip7Config, random = Math.random): void {
  room.phase = "playing";
  room.deck = shuffleDeck(createFlip7Deck(config), random);
  room.discardPile = [];
  room.currentTurnIndex = firstActiveSeat(room);
  room.pendingAction = undefined;
  room.pendingActionQueue = [];
  room.recentCard = undefined;
  room.roundSummary = undefined;
  room.roundLog = [`第 ${room.roundNumber} 轮开始`];
  for (const player of room.players) {
    player.status = "active";
    player.numberCards = [];
    player.bonusCards = [];
    player.bustedCards = [];
    player.secondChances = 0;
    player.roundScore = 0;
    player.roundResult = "active";
  }
}

export function drawCard(room: Flip7Room): Flip7Card {
  if (room.deck.length === 0) {
    room.deck = shuffleDeck(createFlip7Deck());
    room.discardPile = [];
  }
  const card = room.deck.shift();
  if (!card) throw new Error("牌堆为空");
  room.recentCard = card;
  return card;
}

export function applyCardToPlayer(room: Flip7Room, player: Flip7Player, card: Flip7Card, config: Flip7Config = flip7Config): "ok" | "bust" | "flip7" | "action" {
  if (card.type === "action") {
    room.roundLog.push(`${player.nickname} 翻出了行动牌 ${actionLabel(card.action)}`);
    return "action";
  }
  if (player.status !== "active") {
    if (card.type === "number" || card.type === "bonus") room.discardPile.push(card);
    return "ok";
  }
  if (card.type === "bonus") {
    player.bonusCards.push(card);
    recalculateRoundScore(player);
    room.roundLog.push(`${player.nickname} 翻出了奖励 +${card.value}`);
    return "ok";
  }
  const repeated = player.numberCards.some((owned) => owned.type === "number" && owned.value === card.value);
  if (repeated && player.secondChances > 0) {
    player.secondChances -= 1;
    room.discardPile.push(card);
    recalculateRoundScore(player);
    room.roundLog.push(`${player.nickname} 使用 Second Chance，弃掉重复的 ${card.value}`);
    return "ok";
  }
  if (repeated) {
    player.status = "busted";
    player.roundScore = 0;
    player.roundResult = "bust";
    player.bustedCards.push(card);
    room.discardPile.push(card);
    room.roundLog.push(`${player.nickname} 翻出重复的 ${card.value}，爆牌`);
    return "bust";
  }
  player.numberCards.push(card);
  recalculateRoundScore(player);
  room.roundLog.push(`${player.nickname} 翻出了 ${card.value}`);
  if (player.numberCards.length >= 7) {
    player.roundScore = numberTotal(player) + bonusTotal(player) + config.flip7Bonus;
    player.status = "stayed";
    player.roundResult = "flip7";
    room.roundLog.push(`${player.nickname} 触发 Flip 7，额外 +${config.flip7Bonus}`);
    return "flip7";
  }
  return "ok";
}

export function stayPlayer(room: Flip7Room, player: Flip7Player): void {
  if (player.status !== "active") return;
  player.status = "stayed";
  player.roundResult = "stay";
  recalculateRoundScore(player);
  room.roundLog.push(`${player.nickname} 停手保分`);
}

export function shouldEndRound(room: Flip7Room): boolean {
  return room.players.length > 0 && room.players.every((player) => player.status !== "active");
}

export function buildRoundSummary(room: Flip7Room, config: Flip7Config = flip7Config): Flip7RoundSummary[] {
  return room.players.map((player) => {
    const flip7 = player.roundResult === "flip7" ? config.flip7Bonus : 0;
    return {
      playerId: player.id,
      nickname: player.nickname,
      status: player.roundResult === "flip7" ? "Flip 7" : player.status === "busted" ? "Bust" : "Stay",
      numberTotal: numberTotal(player),
      bonusTotal: bonusTotal(player),
      flip7Bonus: flip7,
      roundScore: player.roundScore,
      totalScore: player.totalScore + player.roundScore
    };
  });
}

export function finishRound(room: Flip7Room, config: Flip7Config = flip7Config): void {
  room.roundSummary = buildRoundSummary(room, config);
  for (const player of room.players) {
    player.totalScore += player.roundScore;
  }
  const winners = room.players.filter((player) => player.totalScore >= room.targetScore);
  if (winners.length > 0) {
    room.phase = "finished";
    const highScore = Math.max(...room.players.map((player) => player.totalScore));
    room.winnerIds = room.players.filter((player) => player.totalScore === highScore).map((player) => player.id);
  } else {
    room.phase = "round_summary";
    room.roundNumber += 1;
  }
}

export function firstActiveSeat(room: Flip7Room): number {
  const index = room.players.findIndex((player) => player.status === "active");
  return Math.max(index, 0);
}

export function advanceTurn(room: Flip7Room): void {
  if (shouldEndRound(room)) return;
  for (let offset = 1; offset <= room.players.length; offset += 1) {
    const nextIndex = (room.currentTurnIndex + offset) % room.players.length;
    if (room.players[nextIndex]?.status === "active") {
      room.currentTurnIndex = nextIndex;
      return;
    }
  }
}

export function sanitizeState(room: Flip7Room): PublicFlip7Room {
  const { deck, ...rest } = room;
  return {
    ...rest,
    players: room.players.map((player) => ({
      ...player,
      numberCards: [...player.numberCards],
      bonusCards: [...player.bonusCards],
      bustedCards: [...player.bustedCards]
    })),
    discardPile: [...room.discardPile],
    pendingActionQueue: [...room.pendingActionQueue],
    deckCount: deck.length
  };
}

export function actionLabel(action: Flip7Action): string {
  if (action === "second_chance") return "Second Chance";
  if (action === "freeze") return "Freeze";
  return "Flip Three";
}
