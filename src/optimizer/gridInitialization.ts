import type { PackingProblem, RectanglePose } from '../types/packing';
import { allowedAngles } from './rotation';

/**
 * Row layouts are built from axis-aligned bands, so the requested angle is
 * snapped to the nearest right angle and reported back together with the
 * footprint it implies. Returning the snapped angle keeps the layout and the
 * poses consistent whatever the caller passes in.
 */
function footprint(
  width: number,
  height: number,
  angle: number,
): { fw: number; fh: number; angle: number } {
  const upright = Math.abs(Math.sin(angle)) > Math.SQRT1_2;
  return upright
    ? { fw: height, fh: width, angle: Math.PI / 2 }
    : { fw: width, fh: height, angle: 0 };
}

/** Relative slack absorbing floating point noise in the "does it fit" test. */
const FIT_TOLERANCE = 1e-9;

/**
 * Row packing: rectangles are stacked in horizontal bands of height `fh`, and
 * every band is filled independently and centred on the vertical axis.
 *
 * This beats a rigid lattice for free, because each row uses the full chord
 * available at its own height instead of inheriting a single global x offset.
 *
 * `rowShift` nudges odd rows sideways (as a fraction of the footprint width)
 * to produce the staggered arrangements asked for in the brief.
 */
export function generateRowSolution(
  radius: number,
  width: number,
  height: number,
  angle: number,
  offsetY: number,
  rowShift = 0,
): RectanglePose[] {
  const { fw, fh, angle: orientation } = footprint(width, height, angle);
  if (fw <= 0 || fh <= 0) return [];

  const poses: RectanglePose[] = [];
  const maxRows = Math.ceil((2 * radius) / fh) + 2;

  for (let k = -maxRows; k <= maxRows; k++) {
    const cy = offsetY + k * fh;
    // The band's worst-case corner sits at |cy| + fh/2 from the horizontal axis.
    const reach = Math.abs(cy) + fh / 2;
    const remaining = radius * radius - reach * reach;
    if (remaining <= 0) continue;

    const halfSpan = Math.sqrt(remaining) - fw / 2;
    if (halfSpan < 0) continue;

    // The tolerance matters: a row that fits *exactly* -- rectangles tangent to
    // the circle, which is allowed -- lands on a floating point cliff where
    // 2*halfSpan/fw evaluates to 1.9999999999999984 instead of 2 and silently
    // costs a rectangle. FIT_TOLERANCE is relative to the footprint, so it
    // stays orders of magnitude below the validator's own tolerance.
    const count = Math.floor((2 * halfSpan) / fw + FIT_TOLERANCE) + 1;
    if (count < 1) continue;

    // Centre the run, then stagger odd rows by as much of the requested shift
    // as the leftover room on the chord allows, so nothing leaves the circle.
    let start = -((count - 1) * fw) / 2;
    if (rowShift !== 0 && (((k % 2) + 2) % 2) === 1) {
      const slack = Math.max(0, halfSpan - ((count - 1) * fw) / 2);
      start += Math.max(-slack, Math.min(slack, rowShift * fw));
    }

    for (let m = 0; m < count; m++) {
      poses.push({ x: start + m * fw, y: cy, angle: orientation });
    }
  }

  return poses;
}

/**
 * Scans row offsets, stagger factors and every orientation the rotation mode
 * allows, and returns the arrangement holding the most rectangles.
 */
export function generateGridSolution(
  problem: PackingProblem,
  offsetSamples = 24,
): RectanglePose[] {
  const { radius, rectangleWidth: width, rectangleHeight: height } = problem;
  const angles = allowedAngles(problem.rotationMode, width, height) ?? [0, Math.PI / 2];

  let best: RectanglePose[] = [];

  for (const angle of angles) {
    const { fh } = footprint(width, height, angle);
    for (const rowShift of [0, 0.5, 0.25]) {
      for (let s = 0; s < offsetSamples; s++) {
        const offsetY = -fh / 2 + (fh * s) / offsetSamples;
        const candidate = generateRowSolution(radius, width, height, angle, offsetY, rowShift);
        if (candidate.length > best.length) best = candidate;
      }
    }
  }

  return best;
}

/**
 * All reasonably distinct row arrangements, used to seed multi-start runs with
 * genuinely different basins rather than N copies of the same grid.
 */
export function generateGridVariants(
  problem: PackingProblem,
  offsetSamples = 12,
): RectanglePose[][] {
  const { radius, rectangleWidth: width, rectangleHeight: height } = problem;
  const angles = allowedAngles(problem.rotationMode, width, height) ?? [0, Math.PI / 2];
  const variants: RectanglePose[][] = [];

  for (const angle of angles) {
    const { fh } = footprint(width, height, angle);
    for (const rowShift of [0, 0.5]) {
      for (let s = 0; s < offsetSamples; s++) {
        const offsetY = -fh / 2 + (fh * s) / offsetSamples;
        const candidate = generateRowSolution(radius, width, height, angle, offsetY, rowShift);
        if (candidate.length > 0) variants.push(candidate);
      }
    }
  }

  variants.sort((a, b) => b.length - a.length);
  return variants;
}
