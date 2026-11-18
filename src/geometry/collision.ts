import type { PackingProblem, RectanglePose, ValidationReport } from '../types/packing';
import { scaledEpsilon } from '../utils/math';
import {
  CORNER_STRIDE,
  maxCornerRadius,
  rectangleHalfDiagonal,
  writeRectangleCorners,
} from './rectangle';
import { quadPenetrationDepth } from './sat';

/**
 * Broad phase: two rectangles can only intersect if their bounding circles do.
 * Both share the same half diagonal here because every rectangle is identical.
 */
export function boundingCirclesMayOverlap(
  ax: number,
  ay: number,
  bx: number,
  by: number,
  halfDiagonal: number,
): boolean {
  const dx = ax - bx;
  const dy = ay - by;
  const reach = 2 * halfDiagonal;
  return dx * dx + dy * dy < reach * reach;
}

/**
 * Independent, exact re-check of a packing: every corner against the circle,
 * every pair against the Separating Axis Theorem. This runs after the
 * optimiser has finished and is deliberately written without reusing any of
 * the optimiser's incremental bookkeeping.
 */
export function validatePacking(
  rectangles: RectanglePose[],
  problem: PackingProblem,
): ValidationReport {
  const { radius, rectangleWidth: width, rectangleHeight: height } = problem;
  const epsilon = scaledEpsilon(radius);
  const halfWidth = width / 2;
  const halfHeight = height / 2;
  const halfDiagonal = rectangleHalfDiagonal(width, height);
  const count = rectangles.length;

  const corners = new Float64Array(count * CORNER_STRIDE);
  const outsideIndices: number[] = [];
  let maxCornerOverflow = 0;

  for (let i = 0; i < count; i++) {
    const r = rectangles[i];
    writeRectangleCorners(r.x, r.y, r.angle, halfWidth, halfHeight, corners, i * CORNER_STRIDE);
    const overflow = maxCornerRadius(corners, i * CORNER_STRIDE) - radius;
    if (overflow > maxCornerOverflow) maxCornerOverflow = overflow;
    if (overflow > epsilon) outsideIndices.push(i);
  }

  const overlappingPairs: Array<[number, number]> = [];
  let maxPenetration = 0;

  for (let i = 0; i < count; i++) {
    const a = rectangles[i];
    for (let j = i + 1; j < count; j++) {
      const b = rectangles[j];
      if (!boundingCirclesMayOverlap(a.x, a.y, b.x, b.y, halfDiagonal)) continue;

      const depth = quadPenetrationDepth(
        corners,
        i * CORNER_STRIDE,
        corners,
        j * CORNER_STRIDE,
      );
      if (depth > maxPenetration) maxPenetration = depth;
      if (depth > epsilon) overlappingPairs.push([i, j]);
    }
  }

  return {
    valid: outsideIndices.length === 0 && overlappingPairs.length === 0,
    outsideIndices,
    overlappingPairs,
    maxCornerOverflow: Math.max(0, maxCornerOverflow),
    maxPenetration,
  };
}

export function isPackingValid(
  rectangles: RectanglePose[],
  problem: PackingProblem,
): boolean {
  return validatePacking(rectangles, problem).valid;
}

/** N * W * H / (pi * R^2). */
export function calculatePackingDensity(count: number, problem: PackingProblem): number {
  const circleArea = Math.PI * problem.radius * problem.radius;
  if (circleArea <= 0) return 0;
  return (count * problem.rectangleWidth * problem.rectangleHeight) / circleArea;
}

/**
 * floor(pi R^2 / (W H)). A hard ceiling that no packing can exceed, but an
 * unreachable one in practice -- never present it as an achievable count.
 */
export function areaUpperBound(problem: PackingProblem): number {
  const rectArea = problem.rectangleWidth * problem.rectangleHeight;
  if (rectArea <= 0) return 0;
  return Math.floor((Math.PI * problem.radius * problem.radius) / rectArea);
}

/** Per-rectangle validity flags, used to colour the live visualisation. */
export function markInvalidRectangles(
  rectangles: RectanglePose[],
  problem: PackingProblem,
): boolean[] {
  const report = validatePacking(rectangles, problem);
  const flags = new Array<boolean>(rectangles.length).fill(false);
  for (const index of report.outsideIndices) flags[index] = true;
  for (const [i, j] of report.overlappingPairs) {
    flags[i] = true;
    flags[j] = true;
  }
  return flags;
}
