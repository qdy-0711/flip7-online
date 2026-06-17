import { useEffect, useMemo, useState } from "react";
import { io } from "socket.io-client";
import { actionLabel, flip7Config } from "@board-games/shared";
import type { Flip7Card, Flip7Player, PublicFlip7Room } from "@board-games/shared";

const socket = io() as any;
const STORAGE_KEY = "flip7.identity";
const APP_VERSION = "v0.3.2";

type Identity = {
  roomCode: string;
  playerId: string;
  nickname: string;
};

function saveIdentity(identity: Identity): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(identity));
}

function loadIdentity(): Identity | undefined {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as Identity) : undefined;
  } catch {
    return undefined;
  }
}

function cardText(card: Flip7Card): string {
  if (card.type === "number") return String(card.value);
  if (card.type === "bonus") return `+${card.value}`;
  return actionLabel(card.action);
}

function cardClass(card: Flip7Card): string {
  if (card.type === "number") return `card number-card value-${card.value}`;
  if (card.type === "bonus") return `card bonus-card bonus-${card.value}`;
  return `card action-card action-${card.action}`;
}

function numberIcon(value: number): string {
  return ["☆", "◇", "♡", "△", "○", "□", "⬡"][value % 7] ?? "☆";
}

function actionIcon(action: string): string {
  if (action === "second_chance") return "↻";
  if (action === "freeze") return "❄";
  return "▱▰▱";
}

function actionHint(action: string): string {
  if (action === "second_chance") return "本轮可再翻一次牌";
  if (action === "freeze") return "冻结一位玩家";
  return "连续翻三张牌";
}

function statusText(player: Flip7Player): string {
  if (player.status === "active") return "进行中";
  if (player.status === "stayed") return "已停手";
  return "已爆牌";
}

function App() {
  const [view, setView] = useState<"home" | "flip7">("home");
  const [nickname, setNickname] = useState(loadIdentity()?.nickname ?? "");
  const [roomCode, setRoomCode] = useState(loadIdentity()?.roomCode ?? "");
  const [identity, setIdentity] = useState<Identity | undefined>(loadIdentity());
  const [room, setRoom] = useState<PublicFlip7Room | undefined>();
  const [toast, setToast] = useState("");
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => {
    const onState = (state: PublicFlip7Room) => {
      setRoom(state);
      setRoomCode(state.code);
      setView("flip7");
    };
    const onCreated = ({ roomCode: code, playerId }: { roomCode: string; playerId: string }) => {
      const next = { roomCode: code, playerId, nickname: nickname || "玩家" };
      setIdentity(next);
      saveIdentity(next);
      setToast(`房间 ${code} 已创建`);
    };
    const onJoined = ({ roomCode: code, playerId }: { roomCode: string; playerId: string }) => {
      const next = { roomCode: code, playerId, nickname: nickname || loadIdentity()?.nickname || "玩家" };
      setIdentity(next);
      saveIdentity(next);
      setToast(`已进入房间 ${code}`);
    };
    const onError = (message: string) => setToast(message);
    socket.on("gameState", onState);
    socket.on("roomCreated", onCreated);
    socket.on("roomJoined", onJoined);
    socket.on("errorMessage", onError);
    return () => {
      socket.off("gameState", onState);
      socket.off("roomCreated", onCreated);
      socket.off("roomJoined", onJoined);
      socket.off("errorMessage", onError);
    };
  }, [nickname]);

  useEffect(() => {
    const saved = loadIdentity();
    if (saved) socket.emit("reconnectFlip7Room", { roomCode: saved.roomCode, playerId: saved.playerId });
  }, []);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(""), 2600);
    return () => window.clearTimeout(timer);
  }, [toast]);

  const me = useMemo(() => room?.players.find((player) => player.id === identity?.playerId), [identity, room]);
  const currentPlayer = room?.players[room.currentTurnIndex];
  const isHost = Boolean(me && room?.hostPlayerId === me.id);
  const isMyTurn = Boolean(room?.phase === "playing" && me && currentPlayer?.id === me.id && me.status === "active");
  const needsTarget = Boolean(room?.phase === "targeting" && room.pendingAction && me?.id === room.pendingAction.sourcePlayerId);

  const createRoom = () => {
    if (!nickname.trim()) return setToast("先输入昵称");
    socket.emit("createFlip7Room", { nickname });
  };

  const joinRoom = () => {
    if (!nickname.trim()) return setToast("先输入昵称");
    if (!roomCode.trim()) return setToast("输入房间号");
    socket.emit("joinFlip7Room", { roomCode, nickname });
  };

  if (view === "home") {
    return (
      <main className="app-shell home-screen">
        <section className="home-panel">
          <div className="home-brand">
            <h1>Flip 7</h1>
            <p>线上多人翻牌桌游</p>
          </div>
          <div className="home-card-fan" aria-hidden="true">
            {[2, 5, 7, 10, 12].map((value, index) => (
              <CardFace card={{ id: `hero-${value}`, type: "number", value }} key={value} large fanIndex={index} />
            ))}
          </div>
          <div className="home-actions">
            <button className="primary-button" onClick={() => setView("flip7")}>进入 Flip 7</button>
            <span>2-6 人 · AI 补位 · 目标 200 分</span>
          </div>
        </section>
        {toast && <div className="toast">{toast}</div>}
      </main>
    );
  }

  return (
    <main className={`app-shell ${room && room.phase !== "lobby" ? "in-game" : ""}`}>
      <header className="topbar">
        <div className="brand">
          <strong>Flip 7</strong>
          <span className="version-chip">{APP_VERSION}</span>
          {room && <span className="room-chip">房间码：{room.code}</span>}
        </div>
        <div className="header-actions">
          {room && (
            <div className="menu-wrap">
              <button className="ghost-button menu-button" onClick={() => setMenuOpen((value) => !value)}>
                菜单 <span>⌄</span>
              </button>
              {menuOpen && (
                <div className="menu-popover">
                  <div><small>房间码</small><strong>{room.code}</strong></div>
                  {isHost && room.phase !== "lobby" && <button onClick={() => { setMenuOpen(false); socket.emit("restartFlip7Game", { roomCode: room.code }); }}>重新开始</button>}
                  {isHost && room.phase !== "lobby" && <button onClick={() => { setMenuOpen(false); socket.emit("backToLobby", { roomCode: room.code }); }}>返回大厅</button>}
                  <button onClick={() => { setMenuOpen(false); setRoom(undefined); setView("home"); }}>回到入口</button>
                </div>
              )}
            </div>
          )}
        </div>
      </header>

      {!room && (
        <section className="join-panel">
          <label>
            昵称
            <input value={nickname} onChange={(event) => setNickname(event.target.value)} placeholder="输入昵称" />
          </label>
          <div className="join-actions">
            <button className="primary-button" onClick={createRoom}>创建房间</button>
            <label>
              房间号
              <input value={roomCode} onChange={(event) => setRoomCode(event.target.value.toUpperCase())} placeholder="ABCDE" />
            </label>
            <button className="secondary-button" onClick={joinRoom}>加入房间</button>
          </div>
        </section>
      )}

      {room?.phase === "lobby" && (
        <Lobby
          room={room}
          me={me}
          isHost={isHost}
          onReady={(ready) => socket.emit("setReady", { roomCode: room.code, ready })}
          onAddAi={() => socket.emit("addAI", { roomCode: room.code })}
          onStart={() => socket.emit("startFlip7Game", { roomCode: room.code })}
        />
      )}

      {room && room.phase !== "lobby" && (
        <GameTable
          room={room}
          me={me}
          currentPlayer={currentPlayer}
          isHost={isHost}
          isMyTurn={isMyTurn}
          needsTarget={needsTarget}
          onHit={() => socket.emit("hit", { roomCode: room.code })}
          onStay={() => socket.emit("stay", { roomCode: room.code })}
          onTarget={(targetPlayerId) => socket.emit("chooseActionTarget", { roomCode: room.code, targetPlayerId })}
          onNextRound={() => socket.emit("nextRound", { roomCode: room.code })}
          onBackToLobby={() => socket.emit("backToLobby", { roomCode: room.code })}
        />
      )}

      {toast && <div className="toast">{toast}</div>}
    </main>
  );
}

function Lobby({
  room,
  me,
  isHost,
  onReady,
  onAddAi,
  onStart
}: {
  room: PublicFlip7Room;
  me?: Flip7Player;
  isHost: boolean;
  onReady: (ready: boolean) => void;
  onAddAi: () => void;
  onStart: () => void;
}) {
  const seats = Array.from({ length: flip7Config.maxPlayers }, (_, index) => room.players.find((player) => player.seatIndex === index));
  const canStart = room.players.length >= flip7Config.minPlayers && room.players.every((player) => player.ready || player.isAI);
  return (
    <section className="lobby-layout">
      <div className="room-strip">
        <div><span>房间号</span><strong>{room.code}</strong></div>
        <div><span>目标分</span><strong>{room.targetScore}</strong></div>
        <div><span>人数</span><strong>{room.players.length}/6</strong></div>
      </div>
      <div className="seat-grid">
        {seats.map((player, index) => (
          <div className={`seat-card ${player ? "" : "empty"}`} key={index}>
            <span className="seat-index">座位 {index + 1}</span>
            {player ? (
              <>
                <strong>{player.nickname}</strong>
                <div className="badge-row">
                  {room.hostPlayerId === player.id && <span className="badge">房主</span>}
                  {player.isAI && <span className="badge ai">AI</span>}
                  {!player.connected && <span className="badge offline">断线</span>}
                  {!player.isAI && <span className={`badge ${player.ready ? "ready" : ""}`}>{player.ready ? "已准备" : "未准备"}</span>}
                </div>
              </>
            ) : (
              <span className="muted">空位</span>
            )}
          </div>
        ))}
      </div>
      <div className="toolbar">
        {me && !me.isAI && <button className="secondary-button" onClick={() => onReady(!me.ready)}>{me.ready ? "取消准备" : "准备"}</button>}
        {isHost && <button className="secondary-button" onClick={onAddAi}>添加 AI</button>}
        {isHost && <button className="primary-button" disabled={!canStart} onClick={onStart}>开始游戏</button>}
      </div>
    </section>
  );
}

function GameTable({
  room,
  me,
  currentPlayer,
  isHost,
  isMyTurn,
  needsTarget,
  onHit,
  onStay,
  onTarget,
  onNextRound,
  onBackToLobby
}: {
  room: PublicFlip7Room;
  me?: Flip7Player;
  currentPlayer?: Flip7Player;
  isHost: boolean;
  isMyTurn: boolean;
  needsTarget: boolean;
  onHit: () => void;
  onStay: () => void;
  onTarget: (targetPlayerId: string) => void;
  onNextRound: () => void;
  onBackToLobby: () => void;
}) {
  const action = room.pendingAction;
  const validTargets = room.players.filter((player) => {
    if (!action) return false;
    if (action.action === "second_chance") return true;
    return player.status === "active";
  });
  const myProgress = Math.min(100, Math.round(((me?.totalScore ?? 0) / room.targetScore) * 100));
  const actionSource = action ? room.players.find((player) => player.id === action.sourcePlayerId) : undefined;
  const focusPlayer = room.phase === "targeting" ? actionSource : currentPlayer ?? me ?? room.players[0];
  const focusNumbers = focusPlayer?.numberCards ?? [];
  const focusBonus = focusPlayer?.bonusCards ?? [];

  return (
    <section className="game-dashboard">
      <div className="round-strip">
        <span>第 {room.roundNumber} 轮</span>
        <div className="round-dots">
          {Array.from({ length: 8 }, (_, index) => <i className={index < Math.min(room.roundNumber, 8) ? "filled" : ""} key={index} />)}
        </div>
      </div>

      <aside className="players-panel">
        {room.players.map((player) => (
          <PlayerCard
            key={player.id}
            player={player}
            isCurrent={currentPlayer?.id === player.id && room.phase === "playing"}
            isMe={me?.id === player.id}
          />
        ))}
      </aside>

      <main className="play-panel">
        <section className="current-zone">
          <div className="current-heading">
            <span>当前玩家</span>
            <strong>{focusPlayer?.nickname ?? "等待玩家"}</strong>
            {focusPlayer && <em>{statusText(focusPlayer)}</em>}
          </div>
          <div className="current-stats">
            <span>本轮得分 <b>{focusPlayer?.roundScore ?? 0}</b></span>
            <span>已有数字 <b>{focusNumbers.length}/7</b></span>
            <span>第二次机会 <b>{focusPlayer?.secondChances ?? 0}</b></span>
          </div>
          <div className="current-cards">
            {focusNumbers.map((card) => <CardFace card={card} key={card.id} medium />)}
            {focusBonus.map((card) => <CardFace card={card} key={card.id} medium />)}
            {focusNumbers.length + focusBonus.length === 0 && <em>尚未翻牌</em>}
          </div>
        </section>

        <div className="revealed-board">
          {room.players.map((player) => (
            <div className="revealed-row" key={player.id}>
              <span>{player.nickname}</span>
              <div>
                {player.numberCards.map((card) => <CardFace card={card} key={card.id} compact />)}
                {player.numberCards.length === 0 && <em>尚未翻牌</em>}
              </div>
            </div>
          ))}
        </div>

        <div className="draw-stage">
          <div className="deck-column">
            <span>抽牌堆（剩余 {room.deckCount} 张）</span>
            <div className="deck-stack"><strong>FLIP</strong><b>7</b></div>
          </div>
          <div className="recent-column">
            <span>最新翻出的牌</span>
            {room.recentCard ? <CardFace card={room.recentCard} display /> : <div className="empty-card display-card">?</div>}
          </div>
        </div>

        <div className="action-zone">
          <div className="turn-message">
            {room.phase === "playing" && <strong>{isMyTurn ? "轮到你操作" : `等待 ${currentPlayer?.nickname ?? "玩家"} 操作`}</strong>}
            {room.phase === "targeting" && <strong>{needsTarget ? `选择 ${actionLabel(action!.action)} 的目标` : `等待 ${room.players.find((p) => p.id === action?.sourcePlayerId)?.nickname} 选择目标`}</strong>}
            {room.phase === "round_summary" && <strong>本轮结算</strong>}
            {room.phase === "finished" && <strong>游戏结束</strong>}
            <span>目标分数：{room.targetScore} 分</span>
          </div>

          {room.phase === "playing" && (
            <div className="action-buttons">
              <button className="primary-button hit-button" disabled={!isMyTurn} onClick={onHit}>继续翻牌</button>
              <button className="danger-button" disabled={!isMyTurn} onClick={onStay}>停手保分</button>
            </div>
          )}

          {needsTarget && action && (
            <div className="target-panel">
              <span>{actionLabel(action.action)} 目标</span>
              <div className="target-grid">
                {validTargets.map((player) => (
                  <button key={player.id} className="target-button" onClick={() => onTarget(player.id)}>
                    {player.nickname}
                    <small>{player.status === "active" ? `本轮 ${player.roundScore}` : statusText(player)}</small>
                  </button>
                ))}
              </div>
            </div>
          )}

          {(room.phase === "round_summary" || room.phase === "finished") && (
            <SummaryPanel room={room} isHost={isHost} onNextRound={onNextRound} onBackToLobby={onBackToLobby} />
          )}
        </div>

        <div className="goal-progress">
          <span>目标分数：{room.targetScore} 分</span>
          <div><i style={{ width: `${myProgress}%` }}>{myProgress}%</i></div>
          <strong>{me?.totalScore ?? 0} / {room.targetScore}</strong>
        </div>
      </main>

    </section>
  );
}

function PlayerCard({ player, isCurrent, isMe }: { player: Flip7Player; isCurrent: boolean; isMe: boolean }) {
  return (
    <article className={`player-card ${isCurrent ? "current" : ""} ${player.status}`}>
      <div className="avatar">{player.nickname.slice(0, 1).toUpperCase()}</div>
      <div className="player-info">
        <div className="player-title">
          <strong>{isMe ? "你" : player.nickname}</strong>
          <span>{statusText(player)}</span>
        </div>
        <div className="score-grid">
          <span>本轮得分 <b>{player.roundScore}</b></span>
          <span>总分 <b>{player.totalScore}</b></span>
        </div>
        {player.secondChances > 0 && <div className="player-flags"><span>Second Chance × {player.secondChances}</span></div>}
        <div className="player-card-row">
          {player.numberCards.map((card) => <CardFace card={card} key={card.id} compact={isCurrent} mini={!isCurrent} />)}
          {player.bonusCards.map((card) => <CardFace card={card} key={card.id} mini />)}
          {player.bustedCards.map((card) => <CardFace card={card} key={card.id} mini busted />)}
          {player.numberCards.length + player.bonusCards.length + player.bustedCards.length === 0 && <em>尚未翻牌</em>}
        </div>
      </div>
    </article>
  );
}

function CardFace({ card, large = false, medium = false, compact = false, mini = false, display = false, busted = false, fanIndex }: { card: Flip7Card; large?: boolean; medium?: boolean; compact?: boolean; mini?: boolean; display?: boolean; busted?: boolean; fanIndex?: number }) {
  const sizeClass = display ? "display-card" : large ? "large-card" : medium ? "medium-card" : compact ? "compact-card" : mini ? "mini-card" : "";
  const stateClass = busted ? "busted-face" : "";
  const fanStyle = fanIndex === undefined ? undefined : { "--fan-index": fanIndex } as React.CSSProperties;
  if (card.type === "number") {
    return (
      <div className={`${cardClass(card)} ${sizeClass} ${stateClass} ${fanIndex !== undefined ? "fan-card" : ""}`} style={fanStyle}>
        <strong>{card.value}</strong>
        <span className="number-icon">{numberIcon(card.value)}</span>
      </div>
    );
  }
  if (card.type === "bonus") {
    return (
      <div className={`${cardClass(card)} ${sizeClass}`}>
        <strong>+{card.value}</strong>
        <span className="bonus-burst" />
      </div>
    );
  }
  return (
    <div className={`${cardClass(card)} ${sizeClass}`}>
      <strong>{cardText(card)}</strong>
      <span className="action-icon">{actionIcon(card.action)}</span>
      <small>{actionHint(card.action)}</small>
    </div>
  );
}

function SummaryPanel({ room, isHost, onNextRound, onBackToLobby }: { room: PublicFlip7Room; isHost: boolean; onNextRound: () => void; onBackToLobby: () => void }) {
  const rows = room.roundSummary ?? [];
  const ranking = [...room.players].sort((a, b) => b.totalScore - a.totalScore);
  return (
    <div className="summary-panel">
      {room.phase === "finished" && (
        <div className="ranking">
          <span>最终排名</span>
          {ranking.map((player, index) => (
            <p key={player.id}><strong>{index + 1}. {player.nickname}</strong><span>{player.totalScore} 分</span></p>
          ))}
        </div>
      )}
      <div className="summary-table">
        <div className="summary-head">
          <span>玩家</span><span>状态</span><span>数字</span><span>奖励</span><span>Flip 7</span><span>本轮</span><span>总分</span>
        </div>
        {rows.map((row) => (
          <div className="summary-row" key={row.playerId}>
            <span>{row.nickname}</span>
            <span>{row.status}</span>
            <span>{row.numberTotal}</span>
            <span>{row.bonusTotal}</span>
            <span>{row.flip7Bonus}</span>
            <strong>{row.roundScore}</strong>
            <strong>{row.totalScore}</strong>
          </div>
        ))}
      </div>
      <div className="toolbar">
        {isHost && room.phase === "round_summary" && <button className="primary-button" onClick={onNextRound}>下一轮</button>}
        {isHost && <button className="secondary-button" onClick={onBackToLobby}>返回房间</button>}
      </div>
    </div>
  );
}

export default App;
