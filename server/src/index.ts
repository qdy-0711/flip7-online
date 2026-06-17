import cors from "cors";
import express from "express";
import { createServer } from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Server } from "socket.io";
import {
  actionLabel,
  advanceTurn,
  applyCardToPlayer,
  chooseAiTarget,
  decideAiAction,
  drawCard,
  finishRound,
  flip7Config,
  makePlayer,
  sanitizeState,
  shouldEndRound,
  startRound,
  stayPlayer
} from "@board-games/shared";
import type { Flip7Card, Flip7Player, Flip7Room, PendingAction } from "@board-games/shared";

const app = express();
app.use(cors());
app.use(express.json());

const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: { origin: "*" }
} as ConstructorParameters<typeof Server>[1]);

const rooms = new Map<string, Flip7Room>();
const socketPlayers = new Map<string, { roomCode: string; playerId: string }>();
const aiTimers = new Map<string, NodeJS.Timeout>();

function id(prefix: string): string {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36).slice(-4)}`;
}

function roomCode(): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "";
  for (let index = 0; index < 5; index += 1) {
    code += alphabet[Math.floor(Math.random() * alphabet.length)];
  }
  return rooms.has(code) ? roomCode() : code;
}

function createRoom(nickname: string): Flip7Room {
  const player = makePlayer(id("p"), cleanNickname(nickname), 0);
  return {
    code: roomCode(),
    players: [player],
    hostPlayerId: player.id,
    phase: "lobby",
    deck: [],
    discardPile: [],
    currentTurnIndex: 0,
    pendingActionQueue: [],
    targetScore: flip7Config.targetScore,
    roundNumber: 1,
    roundLog: []
  };
}

function cleanNickname(nickname: string): string {
  return nickname.trim().slice(0, 16) || "玩家";
}

function emitError(socketId: string, message: string): void {
  io.to(socketId).emit("errorMessage", message);
}

function broadcast(room: Flip7Room): void {
  io.to(room.code).emit("gameState", sanitizeState(room));
  if (room.phase === "round_summary") io.to(room.code).emit("roundSummary", room.roundSummary);
  if (room.phase === "finished") io.to(room.code).emit("gameFinished", sanitizeState(room));
  scheduleAi(room);
}

function findPlayer(room: Flip7Room, playerId: string): Flip7Player | undefined {
  return room.players.find((player) => player.id === playerId);
}

function currentPlayer(room: Flip7Room): Flip7Player | undefined {
  return room.players[room.currentTurnIndex];
}

function requireRoomAndPlayer(socketId: string, roomCodeValue: string): { room: Flip7Room; player: Flip7Player } | undefined {
  const room = rooms.get(roomCodeValue.toUpperCase());
  const identity = socketPlayers.get(socketId);
  if (!room || !identity || identity.roomCode !== room.code) {
    emitError(socketId, "没有找到房间，请重新加入");
    return undefined;
  }
  const player = findPlayer(room, identity.playerId);
  if (!player) {
    emitError(socketId, "没有找到你的座位，请重新加入");
    return undefined;
  }
  return { room, player };
}

function canStart(room: Flip7Room): boolean {
  return room.phase === "lobby" && room.players.length >= flip7Config.minPlayers && room.players.every((player) => player.ready || player.isAI);
}

function attachSocket(socketId: string, room: Flip7Room, player: Flip7Player): void {
  socketPlayers.set(socketId, { roomCode: room.code, playerId: player.id });
  const socket = io.sockets.sockets.get(socketId);
  socket?.join(room.code);
  player.connected = true;
}

function activeTargets(room: Flip7Room): Flip7Player[] {
  return room.players.filter((player) => player.status === "active");
}

function finishOrAdvance(room: Flip7Room, advance = true): void {
  if (shouldEndRound(room)) {
    finishRound(room);
    return;
  }
  if (advance) advanceTurn(room);
}

function drawFor(room: Flip7Room, player: Flip7Player): "done" | "targeting" {
  const card = drawCard(room);
  const result = applyCardToPlayer(room, player, card);
  if (result === "action" && card.type === "action") {
    if (card.action === "second_chance") {
      player.secondChances += 1;
      room.roundLog.push(`${player.nickname} 获得 Second Chance`);
      finishOrAdvance(room);
      return "done";
    }
    room.pendingAction = { action: card.action, sourcePlayerId: player.id };
    room.phase = "targeting";
    return "targeting";
  }
  if (result === "flip7") {
    finishRound(room);
    return "done";
  }
  finishOrAdvance(room);
  return "done";
}

function queueOrStartAction(room: Flip7Room, action: PendingAction): void {
  if (room.pendingAction) {
    room.pendingActionQueue.push(action);
  } else {
    room.pendingAction = action;
    room.phase = "targeting";
  }
}

function continuePendingActions(room: Flip7Room): boolean {
  const next = room.pendingActionQueue.shift();
  if (!next) return false;
  room.pendingAction = next;
  room.phase = "targeting";
  return true;
}

function resolveAction(room: Flip7Room, target: Flip7Player): void {
  const pending = room.pendingAction;
  if (!pending) return;
  const source = findPlayer(room, pending.sourcePlayerId);
  room.pendingAction = undefined;
  room.phase = "playing";

  if (pending.action === "second_chance") {
    target.secondChances += 1;
    room.roundLog.push(`${source?.nickname ?? "玩家"} 把 Second Chance 给了 ${target.nickname}`);
  }

  if (pending.action === "freeze") {
    stayPlayer(room, target);
    room.roundLog.push(`${target.nickname} 被 Freeze，立即停手`);
  }

  if (pending.action === "flip_three") {
    room.roundLog.push(`${source?.nickname ?? "玩家"} 让 ${target.nickname} 连翻 3 张`);
    for (let index = 0; index < 3; index += 1) {
      const card = drawCard(room);
      if (card.type === "action") {
        room.roundLog.push(`${target.nickname} 在 Flip Three 中翻出 ${actionLabel(card.action)}`);
        if (card.action === "second_chance") {
          target.secondChances += 1;
          room.roundLog.push(`${target.nickname} 获得 Second Chance`);
          continue;
        }
        queueOrStartAction(room, { action: card.action, sourcePlayerId: source?.id ?? pending.sourcePlayerId });
        continue;
      }
      if (target.status === "busted" && flip7Config.continueFlipThreeActionsAfterBust) {
        room.discardPile.push(card);
        continue;
      }
      const result = applyCardToPlayer(room, target, card);
      if (result === "flip7") {
        finishRound(room);
        return;
      }
    }
  }

  if (continuePendingActions(room)) return;
  finishOrAdvance(room);
}

function validTarget(room: Flip7Room, action: PendingAction, targetPlayerId: string): Flip7Player | undefined {
  const target = findPlayer(room, targetPlayerId);
  if (!target) return undefined;
  if (action.action === "second_chance") return target;
  if (target.status !== "active") return undefined;
  return target;
}

function addAi(room: Flip7Room): Flip7Player | undefined {
  if (room.players.length >= flip7Config.maxPlayers || room.phase !== "lobby") return undefined;
  const usedSeats = new Set(room.players.map((player) => player.seatIndex));
  const seatIndex = Array.from({ length: flip7Config.maxPlayers }, (_, index) => index).find((seat) => !usedSeats.has(seat));
  if (seatIndex === undefined) return undefined;
  const player = makePlayer(id("ai"), `人机 ${room.players.filter((p) => p.isAI).length + 1}`, seatIndex, true);
  room.players.push(player);
  room.players.sort((a, b) => a.seatIndex - b.seatIndex);
  return player;
}

function scheduleAi(room: Flip7Room): void {
  const key = `${room.code}:${room.phase}:${room.currentTurnIndex}:${room.pendingAction?.action ?? "none"}:${room.roundLog.length}`;
  if (aiTimers.has(key)) return;
  const acting = room.phase === "targeting" && room.pendingAction
    ? findPlayer(room, room.pendingAction.sourcePlayerId)
    : currentPlayer(room);
  if (!acting?.isAI) return;
  const [min, max] = flip7Config.aiDelayMs;
  const timer = setTimeout(() => {
    aiTimers.delete(key);
    const fresh = rooms.get(room.code);
    if (!fresh) return;
    if (fresh.phase === "targeting" && fresh.pendingAction) {
      const source = findPlayer(fresh, fresh.pendingAction.sourcePlayerId);
      const target = source ? chooseAiTarget(fresh, source) : undefined;
      if (target && validTarget(fresh, fresh.pendingAction, target.id)) {
        resolveAction(fresh, target);
        broadcast(fresh);
      }
      return;
    }
    const player = currentPlayer(fresh);
    if (!player?.isAI || player.status !== "active" || fresh.phase !== "playing") return;
    if (decideAiAction(fresh, player) === "stay") {
      stayPlayer(fresh, player);
      finishOrAdvance(fresh);
    } else {
      drawFor(fresh, player);
    }
    broadcast(fresh);
  }, min + Math.floor(Math.random() * (max - min + 1)));
  aiTimers.set(key, timer);
}

io.on("connection", (socket) => {
  socket.on("createFlip7Room", ({ nickname }: { nickname: string }) => {
    const room = createRoom(nickname);
    rooms.set(room.code, room);
    attachSocket(socket.id, room, room.players[0]);
    socket.emit("roomCreated", { roomCode: room.code, playerId: room.players[0].id });
    broadcast(room);
  });

  socket.on("joinFlip7Room", ({ roomCode: requestedCode, nickname }: { roomCode: string; nickname: string }) => {
    const room = rooms.get(requestedCode.toUpperCase());
    if (!room) return emitError(socket.id, "房间不存在");
    const name = cleanNickname(nickname);
    const reconnecting = room.players.find((player) => !player.isAI && player.nickname === name && !player.connected);
    if (reconnecting) {
      attachSocket(socket.id, room, reconnecting);
      socket.emit("roomJoined", { roomCode: room.code, playerId: reconnecting.id });
      return broadcast(room);
    }
    if (room.phase !== "lobby") return emitError(socket.id, "游戏已经开始，只能用原昵称重连");
    if (room.players.length >= flip7Config.maxPlayers) return emitError(socket.id, "房间已满");
    const usedSeats = new Set(room.players.map((player) => player.seatIndex));
    const seatIndex = Array.from({ length: flip7Config.maxPlayers }, (_, index) => index).find((seat) => !usedSeats.has(seat)) ?? room.players.length;
    const player = makePlayer(id("p"), name, seatIndex);
    room.players.push(player);
    room.players.sort((a, b) => a.seatIndex - b.seatIndex);
    attachSocket(socket.id, room, player);
    socket.emit("roomJoined", { roomCode: room.code, playerId: player.id });
    broadcast(room);
  });

  socket.on("reconnectFlip7Room", ({ roomCode: requestedCode, playerId }: { roomCode: string; playerId: string }) => {
    const room = rooms.get(requestedCode.toUpperCase());
    const player = room ? findPlayer(room, playerId) : undefined;
    if (!room || !player) return emitError(socket.id, "重连失败，请重新加入房间");
    attachSocket(socket.id, room, player);
    socket.emit("roomJoined", { roomCode: room.code, playerId: player.id });
    broadcast(room);
  });

  socket.on("setReady", ({ roomCode: requestedCode, ready }: { roomCode: string; ready: boolean }) => {
    const context = requireRoomAndPlayer(socket.id, requestedCode);
    if (!context || context.room.phase !== "lobby" || context.player.isAI) return;
    context.player.ready = Boolean(ready);
    broadcast(context.room);
  });

  socket.on("addAI", ({ roomCode: requestedCode }: { roomCode: string }) => {
    const context = requireRoomAndPlayer(socket.id, requestedCode);
    if (!context) return;
    if (context.room.hostPlayerId !== context.player.id) return emitError(socket.id, "只有房主可以添加 AI");
    if (!addAi(context.room)) return emitError(socket.id, "无法继续添加 AI");
    broadcast(context.room);
  });

  socket.on("startFlip7Game", ({ roomCode: requestedCode }: { roomCode: string }) => {
    const context = requireRoomAndPlayer(socket.id, requestedCode);
    if (!context) return;
    if (context.room.hostPlayerId !== context.player.id) return emitError(socket.id, "只有房主可以开始");
    if (!canStart(context.room)) return emitError(socket.id, "需要 2-6 名玩家且所有真人准备");
    context.room.roundNumber = 1;
    for (const player of context.room.players) player.totalScore = 0;
    startRound(context.room);
    broadcast(context.room);
  });

  socket.on("restartFlip7Game", ({ roomCode: requestedCode }: { roomCode: string }) => {
    const context = requireRoomAndPlayer(socket.id, requestedCode);
    if (!context) return;
    if (context.room.hostPlayerId !== context.player.id) return emitError(socket.id, "只有房主可以重新开始");
    context.room.roundNumber = 1;
    context.room.winnerIds = undefined;
    for (const player of context.room.players) {
      player.totalScore = 0;
      player.ready = player.isAI || player.ready;
    }
    startRound(context.room);
    broadcast(context.room);
  });

  socket.on("hit", ({ roomCode: requestedCode }: { roomCode: string }) => {
    const context = requireRoomAndPlayer(socket.id, requestedCode);
    if (!context || context.room.phase !== "playing") return;
    if (currentPlayer(context.room)?.id !== context.player.id) return emitError(socket.id, "还没轮到你");
    if (context.player.status !== "active") return emitError(socket.id, "你本轮已经不能继续翻牌");
    drawFor(context.room, context.player);
    broadcast(context.room);
  });

  socket.on("stay", ({ roomCode: requestedCode }: { roomCode: string }) => {
    const context = requireRoomAndPlayer(socket.id, requestedCode);
    if (!context || context.room.phase !== "playing") return;
    if (currentPlayer(context.room)?.id !== context.player.id) return emitError(socket.id, "还没轮到你");
    stayPlayer(context.room, context.player);
    finishOrAdvance(context.room);
    broadcast(context.room);
  });

  socket.on("chooseActionTarget", ({ roomCode: requestedCode, targetPlayerId }: { roomCode: string; targetPlayerId: string }) => {
    const context = requireRoomAndPlayer(socket.id, requestedCode);
    if (!context || context.room.phase !== "targeting" || !context.room.pendingAction) return;
    if (context.room.pendingAction.sourcePlayerId !== context.player.id) return emitError(socket.id, "这张行动牌不由你选择目标");
    const target = validTarget(context.room, context.room.pendingAction, targetPlayerId);
    if (!target) return emitError(socket.id, "不能选择这个目标");
    resolveAction(context.room, target);
    broadcast(context.room);
  });

  socket.on("nextRound", ({ roomCode: requestedCode }: { roomCode: string }) => {
    const context = requireRoomAndPlayer(socket.id, requestedCode);
    if (!context || context.room.phase !== "round_summary") return;
    if (context.room.hostPlayerId !== context.player.id) return emitError(socket.id, "只有房主可以开下一轮");
    startRound(context.room);
    broadcast(context.room);
  });

  socket.on("backToLobby", ({ roomCode: requestedCode }: { roomCode: string }) => {
    const context = requireRoomAndPlayer(socket.id, requestedCode);
    if (!context) return;
    if (context.room.hostPlayerId !== context.player.id) return emitError(socket.id, "只有房主可以返回房间");
    context.room.phase = "lobby";
    context.room.roundLog = [];
    for (const player of context.room.players) {
      player.ready = player.isAI;
      player.status = "active";
      player.numberCards = [];
      player.bonusCards = [];
      player.secondChances = 0;
      player.roundScore = 0;
    }
    broadcast(context.room);
  });

  socket.on("disconnect", () => {
    const identity = socketPlayers.get(socket.id);
    socketPlayers.delete(socket.id);
    if (!identity) return;
    const room = rooms.get(identity.roomCode);
    const player = room ? findPlayer(room, identity.playerId) : undefined;
    if (!room || !player || player.isAI) return;
    player.connected = false;
    broadcast(room);
  });
});

app.get("/health", (_req: any, res: any) => res.json({ ok: true }));

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const clientDist = path.resolve(__dirname, "../../client/dist");
app.use(express.static(clientDist));
app.get("*", (_req: any, res: any) => {
  res.sendFile(path.join(clientDist, "index.html"));
});

const port = Number(process.env.PORT ?? 3001);
httpServer.listen(port, () => {
  console.log(`Flip 7 server listening on ${port}`);
});
