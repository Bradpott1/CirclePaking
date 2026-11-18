import type { PackingProblem, RectanglePose } from '../types/packing';
import { generateRowSolution } from './gridInitialization';

interface RingOption {
  /** Extent of the rectangle along the radial direction. */
  radial: number;
  /** Extent along the tangential direction. */
  tangential: number;
  /** Pose angle offset relative to the polar angle of the rectangle. */
  angleOffset: number;
}

const RING_OPTIONS: RingOption[] = [
  // Width laid along the circle, height pointing outwards.
  { radial: 0, tangential: 0, angleOffset: Math.PI / 2 },
  // Height laid along the circle, width pointing outwards.
  { radial: 0, tangential: 0, angleOffset: 0 },
];

/**
 * Concentric-ring construction.
 *
 * Near the boundary a circle rewards rectangles that follow the curve, which
 * no axis-aligned grid can do. Each ring is placed so its outer corners touch
 * the current free radius, and neighbours are spaced by the angular sector
 * they occupy as seen from the centre -- a conservative criterion that makes
 * the ring provably overlap-free. Whatever disk is left in the middle is then
 * filled with the best row arrangement.
 *
 * Only meaningful when arbitrary rotations are permitted.
 */
export function generateRingSolution(
  problem: PackingProblem,
  forceFirstOption: number | null = null,
): RectanglePose[] {
  if (problem.rotationMode !== 'free') return [];

  const { radius, rectangleWidth: width, rectangleHeight: height } = problem;
  const options: RingOption[] = [
    { radial: height, tangential: width, angleOffset: RING_OPTIONS[0].angleOffset },
    { radial: width, tangential: height, angleOffset: RING_OPTIONS[1].angleOffset },
  ];

  const poses: RectanglePose[] = [];
  let free = radius;

  for (let ring = 0; ring < 500; ring++) {
    let best: { count: number; inner: number; poses: RectanglePose[] } | null = null;

    const candidates =
      ring === 0 && forceFirstOption !== null ? [options[forceFirstOption]] : options;

    for (const option of candidates) {
      const { radial, tangential, angleOffset } = option;
      const halfTangential = tangential / 2;

      const outerReach = free * free - halfTangential * halfTangential;
      if (outerReach <= 0) continue;

      const centreDistance = Math.sqrt(outerReach) - radial / 2;
      const inner = centreDistance - radial / 2;
      if (inner < 0) continue;

      // Angular half-width of the rectangle seen from the centre, measured at
      // its inner edge where it is widest in angle.
      const alpha = inner <= 1e-12 ? Math.PI / 2 : Math.atan(halfTangential / inner);
      if (alpha <= 0) continue;

      const count = Math.floor(Math.PI / alpha);
      if (count < 3) continue;

      const ringPoses: RectanglePose[] = [];
      for (let k = 0; k < count; k++) {
        const phi = (2 * Math.PI * k) / count;
        ringPoses.push({
          x: centreDistance * Math.cos(phi),
          y: centreDistance * Math.sin(phi),
          angle: phi + angleOffset,
        });
      }

      if (!best || count > best.count || (count === best.count && inner > best.inner)) {
        best = { count, inner, poses: ringPoses };
      }
    }

    if (!best || best.inner >= free - 1e-12) break;
    poses.push(...best.poses);
    free = best.inner;
  }

  poses.push(...fillCore(free, width, height));
  return poses;
}

/** Best row arrangement inside the leftover central disk. */
function fillCore(radius: number, width: number, height: number): RectanglePose[] {
  if (radius <= 0) return [];
  let best: RectanglePose[] = [];
  for (const angle of [0, Math.PI / 2]) {
    const fh = angle === 0 ? height : width;
    for (let s = 0; s < 16; s++) {
      const offsetY = -fh / 2 + (fh * s) / 16;
      const candidate = generateRowSolution(radius, width, height, angle, offsetY);
      if (candidate.length > best.length) best = candidate;
    }
  }
  return best;
}

/** A handful of structurally different ring layouts for multi-start seeding. */
export function generateRingVariants(problem: PackingProblem): RectanglePose[][] {
  if (problem.rotationMode !== 'free') return [];
  const variants = [
    generateRingSolution(problem, null),
    generateRingSolution(problem, 0),
    generateRingSolution(problem, 1),
  ].filter((v) => v.length > 0);
  variants.sort((a, b) => b.length - a.length);
  return variants;
}
