export type Flip7Action = "second_chance" | "freeze" | "flip_three";

export type Flip7Card =
  | { id: string; type: "number"; value: number }
  | { id: string; type: "bonus"; value: number }
  | { id: string; type: "action"; action: Flip7Action };

export type Flip7PlayerStatus = "active" | "stayed" | "busted";
export type Flip7Phase = "lobby" | "playing" | "targeting" | "round_summary" | "finished";

export type Flip7Player = {
  id: string;
  nickname: string;
  seatIndex: number;
  connected: boolean;
  ready: boolean;
  isAI: boolean;
  status: Flip7PlayerStatus;
  numberCards: Flip7Card[];
  bonusCards: Flip7Card[];
  bustedCards: Flip7Card[];
  secondChances: number;
  roundScore: number;
  totalScore: number;
  roundResult?: "active" | "stay" | "bust" | "flip7";
};

export type PendingAction = {
  action: Flip7Action;
  sourcePlayerId: string;
};

export type Flip7Room = {
  code: string;
  players: Flip7Player[];
  hostPlayerId: string;
  phase: Flip7Phase;
  deck: Flip7Card[];
  discardPile: Flip7Card[];
  currentTurnIndex: number;
  pendingAction?: PendingAction;
  pendingActionQueue: PendingAction[];
  targetScore: number;
  roundNumber: number;
  roundLog: string[];
  recentCard?: Flip7Card;
  roundSummary?: Flip7RoundSummary[];
  winnerIds?: string[];
};

export type Flip7Config = {
  minPlayers: number;
  maxPlayers: number;
  targetScore: number;
  flip7Bonus: number;
  bonusValues: number[];
  actionCopies: number;
  aiDelayMs: [number, number];
  continueFlipThreeActionsAfterBust: boolean;
};

export type Flip7RoundSummary = {
  playerId: string;
  nickname: string;
  status: "Stay" | "Bust" | "Flip 7";
  numberTotal: number;
  bonusTotal: number;
  flip7Bonus: number;
  roundScore: number;
  totalScore: number;
};

export type PublicFlip7Room = Omit<Flip7Room, "deck"> & {
  deckCount: number;
};
