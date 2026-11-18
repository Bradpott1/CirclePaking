import type { RectanglePose } from '../types/packing';
import { EPSILON } from '../utils/math';
import {
  CORNER_STRIDE,
  maxCornerRadius,
  rectangleHalfDiagonal,
  writeRectangleCorners,
} from './rectangle';

export function isPointInsideCircle(
  x: number,
  y: number,
  radius: number,
  epsilon: number = EPSILON,
): boolean {
  const limit = radius + epsilon;
  return x * x + y * y <= limit * limit;
}

/**
 * A disk is convex, so a rectangle lies inside it exactly when its four
 * corners do. Tangency is allowed, which is why the test is `<=` with a
 * tolerance.
 */
export function isRectangleInsideCircle(
  pose: RectanglePose,
  width: number,
  height: number,
  radius: number,
  epsilon: number = EPSILON,
): boolean {
  const buffer = new Float64Array(CORNER_STRIDE);
  writeRectangleCorners(pose.x, pose.y, pose.angle, width / 2, height / 2, buffer, 0);
  return maxCornerRadius(buffer, 0) <= radius + epsilon;
}

/** How far the most distant corner sticks out of the circle; 0 when inside. */
export function circleOverflow(
  pose: RectanglePose,
  width: number,
  height: number,
  radius: number,
): number {
  const buffer = new Float64Array(CORNER_STRIDE);
  writeRectangleCorners(pose.x, pose.y, pose.angle, width / 2, height / 2, buffer, 0);
  return Math.max(0, maxCornerRadius(buffer, 0) - radius);
}

/** Squared-overflow penalty used by the cost function. */
export function containmentPenalty(
  pose: RectanglePose,
  width: number,
  height: number,
  radius: number,
): number {
  const buffer = new Float64Array(CORNER_STRIDE);
  writeRectangleCorners(pose.x, pose.y, pose.angle, width / 2, height / 2, buffer, 0);
  let penalty = 0;
  for (let k = 0; k < 4; k++) {
    const d = Math.hypot(buffer[k * 2], buffer[k * 2 + 1]);
    if (d > radius) {
      const excess = d - radius;
      penalty += excess * excess;
    }
  }
  return penalty;
}

/**
 * Slides a rectangle centre towards the origin until every corner sits within
 * `radius - margin`, writing the corrected centre into `out`.
 *
 * `localCorners` holds the four corner offsets *relative to the centre*, which
 * depend only on the angle. Passing them in means the projection needs no
 * trigonometry at all -- the optimiser calls this on every single move, so it
 * caches those offsets and only recomputes them when an angle actually changes.
 *
 * Pulling the centre straight along the offending corner's radial direction
 * fixes that corner exactly; a handful of passes settles the remaining ones.
 * The final clamp is a guaranteed-safe fallback: a centre no further than
 * `radius - halfDiagonal` from the origin is always fully contained.
 *
 * This is what makes "inside the circle" a hard invariant rather than
 * something the cost function has to negotiate.
 */
export function projectCentreIntoCircle(
  x: number,
  y: number,
  localCorners: ArrayLike<number>,
  offset: number,
  radius: number,
  margin: number,
  out: Float64Array,
): void {
  const limit = radius - margin;
  const limitSquared = limit * limit;
  let cx = x;
  let cy = y;

  for (let pass = 0; pass < 8; pass++) {
    let worstSquared = limitSquared;
    let worstX = 0;
    let worstY = 0;

    for (let k = 0; k < 8; k += 2) {
      const px = cx + localCorners[offset + k];
      const py = cy + localCorners[offset + k + 1];
      const squared = px * px + py * py;
      if (squared > worstSquared) {
        worstSquared = squared;
        worstX = px;
        worstY = py;
      }
    }

    if (worstSquared === limitSquared) {
      out[0] = cx;
      out[1] = cy;
      return;
    }

    const distance = Math.sqrt(worstSquared);
    const shift = (distance - limit) / distance;
    cx -= worstX * shift;
    cy -= worstY * shift;
  }

  // Fallback that cannot fail as long as the rectangle fits in the circle.
  const halfDiagonal = Math.sqrt(
    localCorners[offset] * localCorners[offset] +
      localCorners[offset + 1] * localCorners[offset + 1],
  );
  const safeRadius = Math.max(0, limit - halfDiagonal);
  const distance = Math.sqrt(cx * cx + cy * cy);
  if (distance > safeRadius && distance > 0) {
    const k = safeRadius / distance;
    cx *= k;
    cy *= k;
  }
  out[0] = cx;
  out[1] = cy;
}

/** Same projection, starting from an angle instead of cached corner offsets. */
export function projectIntoCircle(
  x: number,
  y: number,
  angle: number,
  halfWidth: number,
  halfHeight: number,
  radius: number,
  margin: number,
  out: Float64Array,
): void {
  const local = new Float64Array(CORNER_STRIDE);
  writeRectangleCorners(0, 0, angle, halfWidth, halfHeight, local, 0);
  projectCentreIntoCircle(x, y, local, 0, radius, margin, out);
}

/** Pose-level wrapper around `projectIntoCircle`. */
export function projectPoseIntoCircle(
  pose: RectanglePose,
  width: number,
  height: number,
  radius: number,
  margin = 0,
): RectanglePose {
  const out = new Float64Array(2);
  projectIntoCircle(pose.x, pose.y, pose.angle, width / 2, height / 2, radius, margin, out);
  return { x: out[0], y: out[1], angle: pose.angle };
}

/** A single rectangle fits in the circle exactly when its half diagonal does. */
export function rectangleFitsInCircle(
  width: number,
  height: number,
  radius: number,
  epsilon: number = EPSILON,
): boolean {
  return rectangleHalfDiagonal(width, height) <= radius + epsilon;
}
