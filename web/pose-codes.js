// Gameplay pose codes, in their own module so both rigged-player.js and
// rigged-animation-controller.js can import them without a circular-initialisation
// TDZ error (the controller keys its priority table by these at module load).

export const POSE = Object.freeze({
  STANCE: 0, RUN: 1, BLOCK: 2, DOWN: 3, THROW: 4, CATCH: 5, KICK: 6,
  HOLD: 7, CELEBRATE: 8, BACKPEDAL: 9, WRAP: 10, KNEEL: 11,
});
