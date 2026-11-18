import { EPSILON } from '../utils/math';
import { CORNER_STRIDE, writeRectangleCorners } from './rectangle';
import type { RectanglePose } from '../types/packing';

/**
 * Separating Axis Theorem specialised for *rectangles* given as flat corner
 * buffers (x0,y0,x1,y1,x2,y2,x3,y3 from the supplied offsets, in order).
 *
 * Adjacent edges of a rectangle are perpendicular, so its two edge normals are
 * simply a unit vector and its perpendicular: one square root per shape is
 * enough, which matters because this runs millions of times per search.
 *
 * Returns the penetration depth along the minimum translation axis:
 *   > 0  the interiors intersect, and the value is how deep;
 *   <= 0 the rectangles are disjoint or merely touching, the magnitude being
 *        the gap along the first separating axis found.
 *
 * Exact contact yields 0, which callers treat as "not overlapping".
 */
export function quadPenetrationDepth(
  a: ArrayLike<number>,
  aOffset: number,
  b: ArrayLike<number>,
  bOffset: number,
): number {
  let minDepth = Infinity;

  for (let shape = 0; shape < 2; shape++) {
    const source = shape === 0 ? a : b;
    const offset = shape === 0 ? aOffset : bOffset;

    const ex = source[offset + 2] - source[offset];
    const ey = source[offset + 3] - source[offset + 1];
    const length = Math.sqrt(ex * ex + ey * ey);
    if (length < EPSILON) continue; // degenerate shape, no usable axis

    const ux = ex / length;
    const uy = ey / length;

    for (let axis = 0; axis < 2; axis++) {
      const nx = axis === 0 ? -uy : ux;
      const ny = axis === 0 ? ux : uy;

      let aMin = Infinity;
      let aMax = -Infinity;
      let bMin = Infinity;
      let bMax = -Infinity;

      for (let k = 0; k < 8; k += 2) {
        const pa = a[aOffset + k] * nx + a[aOffset + k + 1] * ny;
        if (pa < aMin) aMin = pa;
        if (pa > aMax) aMax = pa;

        const pb = b[bOffset + k] * nx + b[bOffset + k + 1] * ny;
        if (pb < bMin) bMin = pb;
        if (pb > bMax) bMax = pb;
      }

      const overlap = (aMax < bMax ? aMax : bMax) - (aMin > bMin ? aMin : bMin);
      if (overlap <= 0) return overlap; // separating axis: done
      if (overlap < minDepth) minDepth = overlap;
    }
  }

  return minDepth === Infinity ? 0 : minDepth;
}

/**
 * Minimum Translation Vector between two rectangles.
 *
 * Writes `[nx, ny, depth]` into `out`, where translating rectangle A by
 * `+(nx, ny) * depth` is the shortest move that separates the pair. `depth` is
 * 0 when they do not overlap, in which case the axis is meaningless.
 *
 * This is what lets the relaxation step push overlapping rectangles apart
 * along the cheapest direction instead of guessing.
 */
export function quadMinimumTranslation(
  a: ArrayLike<number>,
  aOffset: number,
  b: ArrayLike<number>,
  bOffset: number,
  out: Float64Array,
): void {
  let bestDepth = Infinity;
  let bestX = 0;
  let bestY = 0;

  for (let shape = 0; shape < 2; shape++) {
    const source = shape === 0 ? a : b;
    const offset = shape === 0 ? aOffset : bOffset;

    const ex = source[offset + 2] - source[offset];
    const ey = source[offset + 3] - source[offset + 1];
    const length = Math.sqrt(ex * ex + ey * ey);
    if (length < EPSILON) continue;

    const ux = ex / length;
    const uy = ey / length;

    for (let axis = 0; axis < 2; axis++) {
      const nx = axis === 0 ? -uy : ux;
      const ny = axis === 0 ? ux : uy;

      let aMin = Infinity;
      let aMax = -Infinity;
      let bMin = Infinity;
      let bMax = -Infinity;

      for (let k = 0; k < 8; k += 2) {
        const pa = a[aOffset + k] * nx + a[aOffset + k + 1] * ny;
        if (pa < aMin) aMin = pa;
        if (pa > aMax) aMax = pa;

        const pb = b[bOffset + k] * nx + b[bOffset + k + 1] * ny;
        if (pb < bMin) bMin = pb;
        if (pb > bMax) bMax = pb;
      }

      const overlap = (aMax < bMax ? aMax : bMax) - (aMin > bMin ? aMin : bMin);
      if (overlap <= 0) {
        out[0] = 0;
        out[1] = 0;
        out[2] = 0;
        return;
      }
      if (overlap < bestDepth) {
        bestDepth = overlap;
        // Orient the axis so that it points from B towards A.
        const sign = (aMin + aMax) / 2 < (bMin + bMax) / 2 ? -1 : 1;
        bestX = nx * sign;
        bestY = ny * sign;
      }
    }
  }

  if (bestDepth === Infinity) {
    out[0] = 0;
    out[1] = 0;
    out[2] = 0;
    return;
  }
  out[0] = bestX;
  out[1] = bestY;
  out[2] = bestDepth;
}

/**
 * Penetration depth between two rectangle poses sharing the same dimensions.
 * Convenience wrapper over `quadPenetrationDepth`.
 */
export function rectanglePenetrationDepth(
  a: RectanglePose,
  b: RectanglePose,
  width: number,
  height: number,
): number {
  const buffer = new Float64Array(CORNER_STRIDE * 2);
  const halfWidth = width / 2;
  const halfHeight = height / 2;
  writeRectangleCorners(a.x, a.y, a.angle, halfWidth, halfHeight, buffer, 0);
  writeRectangleCorners(b.x, b.y, b.angle, halfWidth, halfHeight, buffer, CORNER_STRIDE);
  return quadPenetrationDepth(buffer, 0, buffer, CORNER_STRIDE);
}

/**
 * True when two rectangles share interior area. Touching along an edge or at a
 * corner is explicitly allowed and reports false, with `epsilon` absorbing
 * floating point noise around exact contact.
 */
export function rectanglesOverlap(
  a: RectanglePose,
  b: RectanglePose,
  width: number,
  height: number,
  epsilon: number = EPSILON,
): boolean {
  return rectanglePenetrationDepth(a, b, width, height) > epsilon;
}
