import type { Flip7Config } from "./types.js";

export const flip7Config: Flip7Config = {
  minPlayers: 2,
  maxPlayers: 6,
  targetScore: 200,
  flip7Bonus: 15,
  bonusValues: [2, 4, 6, 8, 10, 12],
  actionCopies: 3,
  aiDelayMs: [600, 1200],
  continueFlipThreeActionsAfterBust: true
};
