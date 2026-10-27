import { describe, expect, test } from "bun:test";
import {
  BOOST_VELOCITY,
  FIXED_STEP,
  GAME_HEIGHT,
  MAX_SPEED,
  MIN_GAP,
  PLAYER_RADIUS,
  START_SPEED,
} from "../src/features/arcade/stack-hopper-config";
import { advanceGame, boost, createGameState } from "../src/features/arcade/stack-hopper-engine";
import {
  circleIntersectsTriangle,
  orbHitsCaveGate,
} from "../src/features/arcade/stack-hopper-physics";

describe("Stack Hopper cave collision", () => {
  test("registers contact exactly when the orb touches a rock face", () => {
    const triangle = [
      { x: 0, y: 0 },
      { x: 20, y: 0 },
      { x: 10, y: 20 },
    ] as const;
    expect(circleIntersectsTriangle({ x: 10, y: 25 }, 5, [...triangle])).toBe(true);
    expect(circleIntersectsTriangle({ x: 10, y: 25.01 }, 5, [...triangle])).toBe(false);
  });

  test("follows the tapered cave silhouette instead of a rectangular gate", () => {
    const collision = {
      playerX: 82,
      radius: 10.5,
      gateX: 64,
      gateWidth: 36,
      gapTop: 70,
      gapBottom: 140,
      worldHeight: 224,
      rockHalfWidth: 23,
    };
    expect(orbHitsCaveGate({ ...collision, playerY: 68 })).toBe(true);
    expect(orbHitsCaveGate({ ...collision, playerY: 105 })).toBe(false);
  });
});

describe("Stack Hopper engine", () => {
  test("does not advance while paused", () => {
    const game = createGameState("paused");
    const snapshot = structuredClone(game);
    expect(advanceGame(game, FIXED_STEP, () => 0.5)).toEqual({ scored: false, finished: false });
    expect(game).toEqual(snapshot);
  });

  test("applies a predictable boost without replacing the run", () => {
    const game = createGameState("running");
    game.y = 100;
    boost(game, () => 0.5);
    expect(game.velocity).toBe(BOOST_VELOCITY);
    expect(game.particles).toHaveLength(6);
    expect(game.phase).toBe("running");
  });

  test("uses exact world bounds for the orb", () => {
    const safe = createGameState("running");
    safe.y = PLAYER_RADIUS + 1;
    safe.velocity = 0;
    expect(advanceGame(safe, FIXED_STEP, () => 0.5).finished).toBe(false);

    const outside = createGameState("running");
    outside.y = GAME_HEIGHT - PLAYER_RADIUS;
    outside.velocity = 1;
    expect(advanceGame(outside, FIXED_STEP, () => 0.5).finished).toBe(true);
  });

  test("spawns deterministically when a random source is supplied", () => {
    const game = createGameState("running");
    game.spawnIn = 0;
    advanceGame(game, FIXED_STEP, () => 0.25);
    expect(game.gates).toHaveLength(1);
    expect(game.gates[0].variant).toBe(0);
    expect(game.gates[0].gapY).toBeGreaterThan(0);
  });

  test("tightens the course while keeping difficulty bounded", () => {
    const game = createGameState("running");
    game.score = 100;
    game.spawnIn = 0;
    advanceGame(game, FIXED_STEP, () => 1);
    expect(game.speed).toBe(MAX_SPEED);
    expect(game.speed).toBeGreaterThan(START_SPEED);
    expect(game.gates[0].gap).toBe(MIN_GAP);
  });

  test("limits vertical jumps between consecutive passages", () => {
    const game = createGameState("running");
    game.gates.push({ x: 200, gapY: 60, gap: 60, passed: false, variant: 0 });
    game.spawnIn = 0;
    advanceGame(game, FIXED_STEP, () => 1);
    expect(game.gates[1].gapY - game.gates[0].gapY).toBeLessThanOrEqual(58);
  });
});
