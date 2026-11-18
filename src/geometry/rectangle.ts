import type { Point, RectanglePose } from '../types/packing';

/**
 * Number of floats used to describe one rectangle in a packed corner buffer:
 * four corners, two coordinates each.
 */
export const CORNER_STRIDE = 8;

/**
 * Writes the four corners of a rotated rectangle into `out`, starting at
 * `offset`, in counter-clockwise order:
 *   (-w/2,-h/2) -> (+w/2,-h/2) -> (+w/2,+h/2) -> (-w/2,+h/2)
 *
 * Rotation follows the standard convention
 *   X = x + dx*cos(t) - dy*sin(t)
 *   Y = y + dx*sin(t) + dy*cos(t)
 *
 * The flat-buffer form exists because the optimiser rewrites corners millions
 * of times and cannot afford to allocate.
 */
export function writeRectangleCorners(
  x: number,
  y: number,
  angle: number,
  halfWidth: number,
  halfHeight: number,
  out: Float64Array | number[],
  offset = 0,
): void {
  const c = Math.cos(angle);
  const s = Math.sin(angle);

  const wc = halfWidth * c;
  const ws = halfWidth * s;
  const hc = halfHeight * c;
  const hs = halfHeight * s;

  out[offset] = x - wc + hs;
  out[offset + 1] = y - ws - hc;
  out[offset + 2] = x + wc + hs;
  out[offset + 3] = y + ws - hc;
  out[offset + 4] = x + wc - hs;
  out[offset + 5] = y + ws + hc;
  out[offset + 6] = x - wc - hs;
  out[offset + 7] = y - ws + hc;
}

/** Convenience wrapper returning the four corners as points. */
export function getRectangleCorners(
  pose: RectanglePose,
  width: number,
  height: number,
): Point[] {
  const buffer = new Float64Array(CORNER_STRIDE);
  writeRectangleCorners(pose.x, pose.y, pose.angle, width / 2, height / 2, buffer, 0);
  return [
    { x: buffer[0], y: buffer[1] },
    { x: buffer[2], y: buffer[3] },
    { x: buffer[4], y: buffer[5] },
    { x: buffer[6], y: buffer[7] },
  ];
}

/** Distance from the rectangle centre to any of its corners. */
export function rectangleHalfDiagonal(width: number, height: number): number {
  return Math.hypot(width, height) / 2;
}

/** Largest distance from the origin to one of the rectangle's corners. */
export function maxCornerRadius(corners: ArrayLike<number>, offset = 0): number {
  let best = 0;
  for (let k = 0; k < 4; k++) {
    const cx = corners[offset + k * 2];
    const cy = corners[offset + k * 2 + 1];
    const d2 = cx * cx + cy * cy;
    if (d2 > best) best = d2;
  }
  return Math.sqrt(best);
}
