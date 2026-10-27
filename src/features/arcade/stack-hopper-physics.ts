type Point = { x: number; y: number };

type CaveGateCollision = {
  playerX: number;
  playerY: number;
  radius: number;
  gateX: number;
  gateWidth: number;
  gapTop: number;
  gapBottom: number;
  worldHeight: number;
  rockHalfWidth: number;
};

function squaredDistanceToSegment(point: Point, start: Point, end: Point) {
  const segmentX = end.x - start.x;
  const segmentY = end.y - start.y;
  const lengthSquared = segmentX * segmentX + segmentY * segmentY;
  if (lengthSquared === 0) {
    const dx = point.x - start.x;
    const dy = point.y - start.y;
    return dx * dx + dy * dy;
  }

  const projection = Math.max(
    0,
    Math.min(1, ((point.x - start.x) * segmentX + (point.y - start.y) * segmentY) / lengthSquared),
  );
  const closestX = start.x + projection * segmentX;
  const closestY = start.y + projection * segmentY;
  const dx = point.x - closestX;
  const dy = point.y - closestY;
  return dx * dx + dy * dy;
}

function pointInsideTriangle(point: Point, [first, second, third]: [Point, Point, Point]) {
  const sign = (a: Point, b: Point, c: Point) =>
    (a.x - c.x) * (b.y - c.y) - (b.x - c.x) * (a.y - c.y);
  const firstSide = sign(point, first, second);
  const secondSide = sign(point, second, third);
  const thirdSide = sign(point, third, first);
  const hasNegative = firstSide < 0 || secondSide < 0 || thirdSide < 0;
  const hasPositive = firstSide > 0 || secondSide > 0 || thirdSide > 0;
  return !(hasNegative && hasPositive);
}

export function circleIntersectsTriangle(
  center: Point,
  radius: number,
  triangle: [Point, Point, Point],
) {
  if (pointInsideTriangle(center, triangle)) return true;
  const radiusSquared = radius * radius;
  return triangle.some(
    (point, index) =>
      squaredDistanceToSegment(center, point, triangle[(index + 1) % triangle.length]) <=
      radiusSquared,
  );
}

export function orbHitsCaveGate({
  playerX,
  playerY,
  radius,
  gateX,
  gateWidth,
  gapTop,
  gapBottom,
  worldHeight,
  rockHalfWidth,
}: CaveGateCollision) {
  const centerX = gateX + gateWidth / 2;
  const topRock: [Point, Point, Point] = [
    { x: centerX - rockHalfWidth, y: 0 },
    { x: centerX + rockHalfWidth, y: 0 },
    { x: centerX, y: gapTop },
  ];
  const bottomRock: [Point, Point, Point] = [
    { x: centerX, y: gapBottom },
    { x: centerX - rockHalfWidth, y: worldHeight },
    { x: centerX + rockHalfWidth, y: worldHeight },
  ];
  const center = { x: playerX, y: playerY };
  return (
    circleIntersectsTriangle(center, radius, topRock) ||
    circleIntersectsTriangle(center, radius, bottomRock)
  );
}
