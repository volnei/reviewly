import {
  GAME_HEIGHT,
  GAME_WIDTH,
  GATE_WIDTH,
  PLAYER_RADIUS,
  PLAYER_X,
  RENDER_SCALE,
  ROCK_HALF_WIDTH,
} from "./stack-hopper-config";
import type { GameState } from "./stack-hopper-engine";

export type StackHopperScene = {
  canvas: HTMLCanvasElement;
  context: CanvasRenderingContext2D;
};

const TAU = Math.PI * 2;

function wrap(value: number, span: number) {
  return ((value % span) + span) % span;
}

function roundedPolygon(
  context: CanvasRenderingContext2D,
  points: readonly (readonly [number, number])[],
) {
  context.beginPath();
  context.moveTo(points[0][0], points[0][1]);
  for (const [x, y] of points.slice(1)) context.lineTo(x, y);
  context.closePath();
}

function drawSky(context: CanvasRenderingContext2D) {
  const sky = context.createLinearGradient(0, 0, 0, GAME_HEIGHT);
  sky.addColorStop(0, "#55a9d5");
  sky.addColorStop(0.72, "#a1dcd9");
  sky.addColorStop(1, "#d2e8c5");
  context.fillStyle = sky;
  context.fillRect(0, 0, GAME_WIDTH, GAME_HEIGHT);

  const halo = context.createRadialGradient(252, 47, 8, 252, 47, 32);
  halo.addColorStop(0, "rgba(255, 235, 145, .9)");
  halo.addColorStop(0.5, "rgba(255, 224, 115, .28)");
  halo.addColorStop(1, "rgba(255, 224, 115, 0)");
  context.fillStyle = halo;
  context.fillRect(218, 13, 68, 68);
  context.fillStyle = "#ffe07d";
  context.beginPath();
  context.arc(252, 47, 15, 0, TAU);
  context.fill();
}

const CLOUDS = [
  { x: 18, y: 43, scale: 0.72 },
  { x: 102, y: 27, scale: 0.48 },
  { x: 190, y: 55, scale: 0.82 },
  { x: 282, y: 31, scale: 0.58 },
] as const;

function drawClouds(context: CanvasRenderingContext2D, distance: number) {
  const span = 390;
  for (let copy = -1; copy <= 1; copy++) {
    for (let index = 0; index < CLOUDS.length; index++) {
      const cloud = CLOUDS[index];
      const x = cloud.x + copy * span - wrap(distance * 0.045, span);
      const y = cloud.y + (index % 2) * 4;
      context.save();
      context.translate(x, y);
      context.scale(cloud.scale, cloud.scale);
      context.fillStyle = "rgba(53, 91, 95, .18)";
      context.beginPath();
      context.ellipse(1, 8, 24, 7, 0, 0, TAU);
      context.fill();
      context.fillStyle = "#f4f3df";
      context.beginPath();
      context.arc(-15, 2, 10, 0, TAU);
      context.arc(-2, -5, 15, 0, TAU);
      context.arc(14, 2, 11, 0, TAU);
      context.ellipse(0, 6, 28, 10, 0, 0, TAU);
      context.fill();
      context.restore();
    }
  }
}

function drawBird(
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
  scale: number,
  wing: number,
  tilt: number,
) {
  context.save();
  context.translate(x, y);
  context.rotate(tilt);
  context.scale(scale, scale);

  const upperReach = 7.5 + wing * 3.2;
  const lowerReach = 5.8 - wing * 2.4;
  context.fillStyle = "rgba(72, 112, 112, .78)";
  context.beginPath();
  context.moveTo(-0.8, 0.4);
  context.bezierCurveTo(1.2, 2, 3.8, lowerReach, 7.2, lowerReach + 0.8);
  context.bezierCurveTo(5.8, 2.8, 4.3, 0.8, 1.4, -0.1);
  context.closePath();
  context.fill();

  context.fillStyle = "#285d62";
  roundedPolygon(context, [
    [4.2, -0.7],
    [9.2, -3],
    [7.8, 0],
    [9.4, 2.7],
    [4, 1.2],
  ]);
  context.fill();

  context.fillStyle = "#3e7d79";
  context.beginPath();
  context.ellipse(0, 0, 5.8, 2.7, 0.08, 0, TAU);
  context.fill();

  context.fillStyle = "#315f67";
  context.beginPath();
  context.moveTo(-1.2, -0.5);
  context.bezierCurveTo(-0.2, -3.8, 1.8, -upperReach, 6.2, -upperReach - 1.1);
  context.bezierCurveTo(5.4, -5.2, 4.2, -1.8, 1.4, 0.2);
  context.closePath();
  context.fill();

  context.fillStyle = "#315f67";
  context.beginPath();
  context.arc(-5, -0.7, 2.35, 0, TAU);
  context.fill();
  context.fillStyle = "#315f67";
  roundedPolygon(context, [
    [-7.1, -0.9],
    [-10.4, -0.1],
    [-7, 0.2],
  ]);
  context.fill();
  context.restore();
}

function drawSkyLife(context: CanvasRenderingContext2D, game: GameState) {
  const birdSpan = 430;
  const ambientTime = performance.now() / 1000;
  for (let index = 0; index < 2; index++) {
    const flight = game.distance * 0.018 + ambientTime * (7 + index * 0.7);
    const x = wrap(108 + index * 205 - flight, birdSpan) - 30;
    const wing = Math.sin(ambientTime * (7.2 + index * 0.45) + index * 1.3);
    const y = 76 + index * 14 + Math.sin(ambientTime * 1.6 + index) * 2.4;
    const tilt = Math.cos(ambientTime * 1.6 + index) * 0.08;
    drawBird(context, x, y, 0.82 + index * 0.08, wing, tilt);
  }

  const windStrength = Math.max(0, Math.min(1, (game.speed - 96) / 26));
  if (windStrength === 0) return;
  context.strokeStyle = `rgba(244, 250, 224, ${0.12 + windStrength * 0.16})`;
  context.lineWidth = 0.8;
  for (let index = 0; index < 6; index++) {
    const span = 378;
    const x = wrap(index * 79 - game.distance * (0.5 + index * 0.025), span) - 36;
    const y = 45 + ((index * 31) % 104);
    const length = 8 + windStrength * 14 + (index % 3) * 3;
    context.beginPath();
    context.moveTo(x, y);
    context.lineTo(x + length, y);
    context.stroke();
  }
}

function drawMountainLayer(
  context: CanvasRenderingContext2D,
  distance: number,
  speed: number,
  baseline: number,
  color: string,
  shadow: string,
  peaks: readonly number[],
) {
  const width = 520;
  const offset = wrap(distance * speed, width);
  for (let copy = -1; copy <= 1; copy++) {
    const start = copy * width - offset;
    const step = width / (peaks.length - 1);
    const points = peaks.map((height, index) => [start + index * step, baseline - height] as const);
    context.beginPath();
    context.moveTo(points[0][0], points[0][1]);
    for (let index = 1; index < points.length - 1; index++) {
      const point = points[index];
      const next = points[index + 1];
      context.quadraticCurveTo(
        point[0],
        point[1],
        (point[0] + next[0]) / 2,
        (point[1] + next[1]) / 2,
      );
    }
    context.lineTo(points.at(-1)?.[0] ?? start + width, baseline);
    context.lineTo(start + width, baseline);
    context.closePath();
    const mountainFill = context.createLinearGradient(
      0,
      baseline - Math.max(...peaks),
      0,
      baseline,
    );
    mountainFill.addColorStop(0, color);
    mountainFill.addColorStop(1, shadow);
    context.fillStyle = mountainFill;
    context.fill();
  }
}

function drawMountainMist(context: CanvasRenderingContext2D) {
  const mist = context.createLinearGradient(0, 128, 0, 169);
  mist.addColorStop(0, "rgba(212, 232, 215, 0)");
  mist.addColorStop(1, "rgba(212, 232, 215, .28)");
  context.fillStyle = mist;
  context.fillRect(0, 128, GAME_WIDTH, 41);
}

function groundY(worldX: number) {
  return 165 + Math.sin(worldX * 0.018) * 5.5 + Math.sin(worldX * 0.043 + 1.7) * 2;
}

function traceTerrain(context: CanvasRenderingContext2D, terrainOffset: number) {
  context.beginPath();
  context.moveTo(0, groundY(terrainOffset));
  for (let x = 0; x <= GAME_WIDTH; x += 3) context.lineTo(x, groundY(x + terrainOffset));
  context.lineTo(GAME_WIDTH, GAME_HEIGHT);
  context.lineTo(0, GAME_HEIGHT);
  context.closePath();
}

function drawTree(context: CanvasRenderingContext2D, x: number, y: number, variant: number) {
  context.fillStyle = "#654632";
  context.fillRect(x - 1.8, y - 18, 3.6, 19);
  const crown = context.createLinearGradient(x - 10, y - 38, x + 8, y - 12);
  crown.addColorStop(0, "#7fbd5e");
  crown.addColorStop(0.48, "#3f8b50");
  crown.addColorStop(1, "#245e45");
  context.fillStyle = crown;
  if (variant % 2 === 0) {
    context.beginPath();
    context.arc(x, y - 25, 10 + (variant % 3), 0, TAU);
    context.fill();
    context.fillStyle = "rgba(255,255,210,.22)";
    context.beginPath();
    context.arc(x - 3, y - 29, 3, 0, TAU);
    context.fill();
  } else {
    roundedPolygon(context, [
      [x, y - 43],
      [x - 12, y - 14],
      [x + 12, y - 14],
    ]);
    context.fill();
  }
}

function drawTerrain(context: CanvasRenderingContext2D, distance: number) {
  const terrainOffset = distance * 0.34;
  traceTerrain(context, terrainOffset);
  const soil = context.createLinearGradient(0, 160, 0, GAME_HEIGHT);
  soil.addColorStop(0, "#b96f3d");
  soil.addColorStop(0.5, "#8c4e32");
  soil.addColorStop(1, "#57362c");
  context.fillStyle = soil;
  context.fill();

  context.save();
  traceTerrain(context, terrainOffset);
  context.clip();
  const tileWidth = 28;
  const tileHeight = 18;
  const tileShift = wrap(terrainOffset, tileWidth * 2);
  for (let row = 0; row < 5; row++) {
    const y = 174 + row * tileHeight;
    for (let column = -2; column < 18; column++) {
      if ((row + column) % 2 !== 0) continue;
      const x = column * tileWidth - tileShift + (row % 2) * (tileWidth / 2);
      context.fillStyle = row % 2 === 0 ? "rgba(255, 190, 92, .16)" : "rgba(67, 31, 32, .16)";
      roundedPolygon(context, [
        [x + tileWidth / 2, y],
        [x + tileWidth, y + tileHeight / 2],
        [x + tileWidth / 2, y + tileHeight],
        [x, y + tileHeight / 2],
      ]);
      context.fill();
    }
  }
  context.restore();

  context.beginPath();
  for (let x = 0; x <= GAME_WIDTH; x += 3) {
    const y = groundY(x + terrainOffset);
    if (x === 0) context.moveTo(x, y);
    else context.lineTo(x, y);
  }
  for (let x = GAME_WIDTH; x >= 0; x -= 3) {
    context.lineTo(x, groundY(x + terrainOffset) + 13);
  }
  context.closePath();
  const topsoil = context.createLinearGradient(0, 160, 0, 179);
  topsoil.addColorStop(0, "#69ba42");
  topsoil.addColorStop(0.42, "#318848");
  topsoil.addColorStop(1, "#246247");
  context.fillStyle = topsoil;
  context.fill();

  context.beginPath();
  for (let x = 0; x <= GAME_WIDTH; x += 3) {
    const y = groundY(x + terrainOffset);
    if (x === 0) context.moveTo(x, y);
    else context.lineTo(x, y);
  }
  context.strokeStyle = "#4da53c";
  context.lineWidth = 7;
  context.stroke();

  const detailSpan = 236;
  const detailShift = wrap(terrainOffset, detailSpan);
  for (let copy = -1; copy <= 2; copy++) {
    for (let index = 0; index < 3; index++) {
      const x = copy * detailSpan + 34 + index * 69 - detailShift;
      if (x < -10 || x > GAME_WIDTH + 10) continue;
      const y = groundY(x + terrainOffset) - 4;
      if (index === 1) {
        context.strokeStyle = "#2e7546";
        context.lineWidth = 1.2;
        context.beginPath();
        context.moveTo(x, y + 4);
        context.lineTo(x, y - 3);
        context.stroke();
        context.fillStyle = copy % 2 === 0 ? "#ffd85d" : "#f27b58";
        for (let petal = 0; petal < 4; petal++) {
          const angle = (petal / 4) * TAU;
          context.beginPath();
          context.arc(x + Math.cos(angle) * 2, y - 4 + Math.sin(angle) * 2, 1.4, 0, TAU);
          context.fill();
        }
        context.fillStyle = "#fff0a6";
        context.beginPath();
        context.arc(x, y - 4, 1, 0, TAU);
        context.fill();
      } else {
        context.strokeStyle = "#286943";
        context.lineWidth = 1.4;
        context.beginPath();
        context.moveTo(x, y + 4);
        context.quadraticCurveTo(x - 1, y - 3, x + (index === 0 ? -4 : 4), y - 8);
        context.moveTo(x, y + 2);
        context.quadraticCurveTo(x + 1, y - 2, x + (index === 0 ? 4 : -4), y - 5);
        context.stroke();
      }
    }
  }
  context.strokeStyle = "#b4e867";
  context.lineWidth = 2;
  context.stroke();

  context.strokeStyle = "rgba(54, 94, 48, .72)";
  context.lineWidth = 1.3;
  context.beginPath();
  for (let x = 0; x <= GAME_WIDTH; x += 3) {
    const y = groundY(x + terrainOffset) + 9;
    if (x === 0) context.moveTo(x, y);
    else context.lineTo(x, y);
  }
  context.stroke();

  const span = 460;
  const landmarks = [42, 126, 238, 352] as const;
  for (let copy = -1; copy <= 1; copy++) {
    for (let index = 0; index < landmarks.length; index++) {
      const world = landmarks[index] + copy * span;
      const x = world - wrap(terrainOffset, span);
      if (x < -30 || x > GAME_WIDTH + 30) continue;
      drawTree(context, x, groundY(x + terrainOffset) - 2, index);
    }
  }
}

function rockGradient(context: CanvasRenderingContext2D, x: number, width: number) {
  const gradient = context.createLinearGradient(x - width, 0, x + width, 0);
  gradient.addColorStop(0, "#314842");
  gradient.addColorStop(0.45, "#718077");
  gradient.addColorStop(0.7, "#4d625b");
  gradient.addColorStop(1, "#263b38");
  return gradient;
}

function drawRockFormation(
  context: CanvasRenderingContext2D,
  centerX: number,
  tipY: number,
  fromTop: boolean,
  variant: number,
) {
  const edgeY = fromTop ? 0 : GAME_HEIGHT;
  const direction = fromTop ? 1 : -1;
  const width = ROCK_HALF_WIDTH;
  const length = Math.abs(tipY - edgeY);
  const baseGradient = rockGradient(context, centerX, width);
  context.fillStyle = baseGradient;
  for (const [offset, reach, halfWidth] of [
    [-14, 0.48, 9],
    [14, 0.58, 10],
  ] as const) {
    roundedPolygon(context, [
      [centerX + offset - halfWidth, edgeY],
      [centerX + offset + halfWidth, edgeY],
      [centerX + offset + 5, edgeY + direction * length * reach * 0.62],
      [centerX + offset, edgeY + direction * length * reach],
      [centerX + offset - 5, edgeY + direction * length * reach * 0.7],
    ]);
    context.fill();
  }

  context.fillStyle = rockGradient(context, centerX, width);
  roundedPolygon(context, [
    [centerX - width, edgeY],
    [centerX + width, edgeY],
    [centerX + 18, edgeY + direction * length * 0.16],
    [centerX + 11, edgeY + direction * length * 0.38],
    [centerX + 7, edgeY + direction * length * 0.62],
    [centerX, tipY],
    [centerX - 6, edgeY + direction * length * 0.7],
    [centerX - 13, edgeY + direction * length * 0.42],
    [centerX - 19, edgeY + direction * length * 0.2],
  ]);
  context.fill();

  context.fillStyle = "rgba(31, 51, 46, .56)";
  roundedPolygon(context, [
    [centerX - width - 2, edgeY],
    [centerX + width + 2, edgeY],
    [centerX + width - 3, edgeY + direction * 7],
    [centerX + 9, edgeY + direction * 5],
    [centerX - 4, edgeY + direction * 9],
    [centerX - width + 4, edgeY + direction * 6],
  ]);
  context.fill();

  context.fillStyle = "rgba(211, 219, 191, .2)";
  const side = variant % 2 === 0 ? -1 : 1;
  roundedPolygon(context, [
    [centerX + side * 2, edgeY],
    [centerX + side * 16, edgeY],
    [centerX + side * 10, edgeY + direction * length * 0.34],
    [centerX + side * 4, edgeY + direction * length * 0.7],
    [centerX, tipY],
  ]);
  context.fill();

  context.strokeStyle = "rgba(25, 43, 40, .48)";
  context.lineWidth = 1;
  context.beginPath();
  context.moveTo(centerX - side * 11, edgeY + direction * length * 0.12);
  context.lineTo(centerX - side * 5, edgeY + direction * length * 0.3);
  context.lineTo(centerX - side * 9, edgeY + direction * length * 0.42);
  context.stroke();
}

function drawGates(context: CanvasRenderingContext2D, game: GameState) {
  for (const gate of game.gates) {
    const centerX = gate.x + GATE_WIDTH / 2;
    const gapTop = gate.gapY - gate.gap / 2;
    const gapBottom = gate.gapY + gate.gap / 2;
    drawRockFormation(context, centerX, gapTop, true, gate.variant);
    drawRockFormation(context, centerX, gapBottom, false, gate.variant + 1);
  }
}

function drawPlayer(context: CanvasRenderingContext2D, game: GameState) {
  context.save();
  context.translate(PLAYER_X, game.y);
  context.rotate(game.rotation);
  context.shadowColor = "rgba(74, 32, 20, .32)";
  context.shadowBlur = 8;
  context.shadowOffsetY = 5;
  const orb = context.createRadialGradient(-4, -5, 1, 0, 0, PLAYER_RADIUS + 2);
  orb.addColorStop(0, "#fff0bd");
  orb.addColorStop(0.16, "#ffad61");
  orb.addColorStop(0.58, "#ef593d");
  orb.addColorStop(1, "#8f2426");
  context.fillStyle = orb;
  context.beginPath();
  context.arc(0, 0, PLAYER_RADIUS, 0, TAU);
  context.fill();
  context.shadowColor = "transparent";
  context.strokeStyle = "rgba(92, 25, 30, .65)";
  context.lineWidth = 0.8;
  context.beginPath();
  context.arc(0, 0, PLAYER_RADIUS, 0, TAU);
  context.stroke();
  context.fillStyle = "rgba(255, 247, 210, .72)";
  context.beginPath();
  context.ellipse(-3.8, -4.5, 2.2, 1.5, -0.6, 0, TAU);
  context.fill();
  context.restore();
}

function drawParticles(context: CanvasRenderingContext2D, game: GameState) {
  for (const particle of game.particles) {
    context.globalAlpha = Math.max(0, Math.min(1, particle.life));
    context.fillStyle = particle.color;
    context.beginPath();
    context.arc(particle.x, particle.y, Math.max(0.7, particle.life * 2), 0, TAU);
    context.fill();
  }
  context.globalAlpha = 1;
}

export function createStackHopperScene(canvas: HTMLCanvasElement): StackHopperScene {
  const context = canvas.getContext("2d", { alpha: false });
  if (!context) throw new Error("Canvas 2D is unavailable");
  context.imageSmoothingEnabled = true;
  context.setTransform(RENDER_SCALE, 0, 0, RENDER_SCALE, 0, 0);
  return { canvas, context };
}

export function renderStackHopperScene(view: StackHopperScene, game: GameState) {
  const { context } = view;
  context.clearRect(0, 0, GAME_WIDTH, GAME_HEIGHT);
  drawSky(context);
  drawClouds(context, game.distance);
  drawSkyLife(context, game);
  drawMountainLayer(
    context,
    game.distance,
    0.025,
    158,
    "#b6c9c0",
    "#9eb4aa",
    [0, 18, 50, 24, 58, 20, 42, 0],
  );
  drawMountainLayer(
    context,
    game.distance,
    0.065,
    167,
    "#6f9185",
    "#4d7468",
    [0, 12, 31, 17, 40, 14, 28, 0],
  );
  drawMountainMist(context);
  drawTerrain(context, game.distance);
  drawGates(context, game);
  drawParticles(context, game);
  drawPlayer(context, game);
}

export function disposeStackHopperScene(view: StackHopperScene) {
  view.context.setTransform(1, 0, 0, 1, 0, 0);
  view.context.clearRect(0, 0, view.canvas.width, view.canvas.height);
}
