export const GAME_WIDTH = 320;
export const GAME_HEIGHT = 224;
export const RENDER_SCALE = 2;
export const PLAYER_X = 82;
export const PLAYER_RADIUS = 10.5;
export const GATE_WIDTH = 36;
export const ROCK_HALF_WIDTH = 23;
export const FIXED_STEP = 1 / 120;
export const MAX_FRAME_TIME = 0.08;
export const START_SPEED = 88;
export const MAX_SPEED = 134;
export const GRAVITY = 450;
export const BOOST_VELOCITY = -158;
export const START_GAP = 60;
export const MIN_GAP = 45;
export const START_SPAWN_DELAY = 1.44;
export const MIN_SPAWN_DELAY = 1.16;
export const BEST_SCORE_KEY = "reviewly:stack-hopper-94:best";

export const WORLD_COLORS = {
  sky: 0x77cde4,
  skyTop: 0x287fc0,
  sun: 0xffd96a,
  cloud: 0xf4f1df,
  mountainFar: 0x7f9690,
  mountainNear: 0x536e68,
  snow: 0xe8e2cf,
  grass: 0x63a35a,
  soil: 0x705a43,
  soilDark: 0x493e34,
  trunk: 0x6d4b36,
  foliage: 0x397652,
  rock: 0x6b7068,
  rockLight: 0x81877c,
  water: 0x168aa1,
  orb: 0xf05b42,
  orbRing: 0xffc45b,
} as const;
