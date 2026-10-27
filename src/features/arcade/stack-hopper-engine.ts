import {
  BOOST_VELOCITY,
  GAME_HEIGHT,
  GAME_WIDTH,
  GATE_WIDTH,
  GRAVITY,
  MAX_SPEED,
  MIN_GAP,
  MIN_SPAWN_DELAY,
  PLAYER_RADIUS,
  PLAYER_X,
  ROCK_HALF_WIDTH,
  START_GAP,
  START_SPAWN_DELAY,
  START_SPEED,
} from "./stack-hopper-config";
import { orbHitsCaveGate } from "./stack-hopper-physics";

export type GamePhase = "ready" | "running" | "paused" | "over";
export type Gate = { x: number; gapY: number; gap: number; passed: boolean; variant: number };
export type Particle = {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  color: string;
};
export type GameState = {
  phase: GamePhase;
  y: number;
  velocity: number;
  rotation: number;
  gates: Gate[];
  particles: Particle[];
  elapsed: number;
  distance: number;
  score: number;
  speed: number;
  spawnIn: number;
};

export type GameEvents = { scored: boolean; finished: boolean };

export function createGameState(phase: GamePhase = "ready"): GameState {
  return {
    phase,
    y: GAME_HEIGHT / 2,
    velocity: phase === "running" ? -118 : 0,
    rotation: 0,
    gates: [],
    particles: [],
    elapsed: 0,
    distance: 0,
    score: 0,
    speed: START_SPEED,
    spawnIn: 0.95,
  };
}

export function addBurst(
  game: GameState,
  x: number,
  y: number,
  color: string,
  amount: number,
  random: () => number = Math.random,
) {
  for (let index = 0; index < amount; index++) {
    const angle = random() * Math.PI * 2;
    const speed = 18 + random() * 60;
    game.particles.push({
      x,
      y,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      life: 0.45 + random() * 0.45,
      color,
    });
  }
}

export function boost(game: GameState, random: () => number = Math.random) {
  if (game.phase !== "running") return;
  game.velocity = BOOST_VELOCITY;
  addBurst(game, PLAYER_X - 11, game.y + 5, "#ffbd63", 6, random);
}

function advanceParticles(game: GameState, step: number) {
  for (const particle of game.particles) {
    particle.x += particle.vx * step;
    particle.y += particle.vy * step;
    particle.vy += 80 * step;
    particle.life -= step * 1.8;
  }
  game.particles = game.particles.filter((particle) => particle.life > 0);
}

export function advanceGame(
  game: GameState,
  step: number,
  random: () => number = Math.random,
): GameEvents {
  const events = { scored: false, finished: false };

  if (game.phase === "ready") {
    game.elapsed += step;
    game.y = GAME_HEIGHT / 2 + Math.sin(game.elapsed * 3.5) * 5;
    return events;
  }
  if (game.phase !== "running") return events;

  game.elapsed += step;
  game.speed = Math.min(MAX_SPEED, START_SPEED + game.score * 2.15);
  game.distance += game.speed * step;
  game.spawnIn -= step;
  game.velocity += GRAVITY * step;
  game.y += game.velocity * step;
  const targetRotation = Math.max(-0.42, Math.min(0.72, game.velocity / 210));
  game.rotation += (targetRotation - game.rotation) * Math.min(1, step * 8);

  if (game.spawnIn <= 0) {
    const gap = Math.max(MIN_GAP, START_GAP - game.score * 0.72);
    const edge = 15;
    const minCenter = edge + gap / 2;
    const maxCenter = GAME_HEIGHT - edge - gap / 2;
    const desiredCenter = minCenter + random() * (maxCenter - minCenter);
    const previousCenter = game.gates.at(-1)?.gapY ?? GAME_HEIGHT / 2;
    const maxTravel = Math.max(43, 58 - game.score * 0.45);
    const gapY = Math.max(
      minCenter,
      Math.min(
        maxCenter,
        Math.max(previousCenter - maxTravel, Math.min(previousCenter + maxTravel, desiredCenter)),
      ),
    );
    game.gates.push({
      x: GAME_WIDTH + 16,
      gapY,
      gap,
      passed: false,
      variant: Math.floor(random() * 3),
    });
    game.spawnIn = Math.max(MIN_SPAWN_DELAY, START_SPAWN_DELAY - game.score * 0.018);
  }

  for (const gate of game.gates) {
    gate.x -= game.speed * step;
    if (!gate.passed && gate.x + GATE_WIDTH < PLAYER_X) {
      gate.passed = true;
      game.score += 1;
      events.scored = true;
      addBurst(game, PLAYER_X, game.y, "#ffe08a", 8, random);
    }
    const gapTop = gate.gapY - gate.gap / 2;
    const gapBottom = gate.gapY + gate.gap / 2;
    if (
      orbHitsCaveGate({
        playerX: PLAYER_X,
        playerY: game.y,
        radius: PLAYER_RADIUS,
        gateX: gate.x,
        gateWidth: GATE_WIDTH,
        gapTop,
        gapBottom,
        worldHeight: GAME_HEIGHT,
        rockHalfWidth: ROCK_HALF_WIDTH,
      })
    ) {
      events.finished = true;
    }
  }

  game.gates = game.gates.filter((gate) => gate.x > -ROCK_HALF_WIDTH * 2);
  if (game.y <= PLAYER_RADIUS || game.y >= GAME_HEIGHT - PLAYER_RADIUS) {
    events.finished = true;
  }
  advanceParticles(game, step);
  return events;
}

export function finishGame(game: GameState, random: () => number = Math.random) {
  if (game.phase !== "running") return;
  game.phase = "over";
  addBurst(game, PLAYER_X, game.y, "#fff0b0", 18, random);
}
