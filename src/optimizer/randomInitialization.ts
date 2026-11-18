import type { PackingProblem, RectanglePose } from '../types/packing';
import {
  CORNER_STRIDE,
  rectangleHalfDiagonal,
  writeRectangleCorners,
} from '../geometry/rectangle';
import { quadPenetrationDepth } from '../geometry/sat';
import { projectPoseIntoCircle } from '../geometry/circle';
import { boundingCirclesMayOverlap } from '../geometry/collision';
import { sampleAngle, snapAngle } from './rotation';
import type { Rng } from '../utils/math';

/**
 * Random poses whose centres are drawn from the disk of radius R - halfDiag,
 * which guarantees containment whatever the angle. Overlaps are expected and
 * are the optimiser's job to remove.
 */
export function generateRandomSolution(
  problem: PackingProblem,
  count: number,
  rng: Rng,
): RectanglePose[] {
  const { radius, rectangleWidth: width, rectangleHeight: height } = problem;
  const safeRadius = Math.max(0, radius - rectangleHalfDiagonal(width, height));

  const poses: RectanglePose[] = [];
  for (let i = 0; i < count; i++) {
    const { x, y } = rng.inDisk(safeRadius);
    poses.push({ x, y, angle: sampleAngle(problem.rotationMode, width, height, rng) });
  }
  return poses;
}

/** Jitters an existing arrangement so multi-start runs explore nearby basins. */
export function perturbSolution(
  poses: RectanglePose[],
  problem: PackingProblem,
  rng: Rng,
  positionSigma: number,
  angleSigma: number,
): RectanglePose[] {
  const { radius, rectangleWidth: width, rectangleHeight: height } = problem;
  return poses.map((pose) => {
    const moved: RectanglePose = {
      x: pose.x + rng.normal() * positionSigma,
      y: pose.y + rng.normal() * positionSigma,
      angle: snapAngle(
        problem.rotationMode,
        width,
        height,
        pose.angle + rng.normal() * angleSigma,
      ),
    };
    return projectPoseIntoCircle(moved, width, height, radius);
  });
}

/**
 * Picks where to drop one extra rectangle into an existing arrangement.
 *
 * Candidate poses are sampled inside the circle and scored by how much they
 * would overlap what is already there; the least conflicting one wins. It is
 * only a starting point -- the optimiser then moves *every* rectangle, which
 * is what actually makes room for the newcomer.
 */
export function findInsertionPose(
  poses: RectanglePose[],
  problem: PackingProblem,
  rng: Rng,
  samples = 600,
): RectanglePose {
  const { radius, rectangleWidth: width, rectangleHeight: height } = problem;
  const halfWidth = width / 2;
  const halfHeight = height / 2;
  const halfDiagonal = rectangleHalfDiagonal(width, height);
  const safeRadius = Math.max(0, radius - halfDiagonal);

  const existing = new Float64Array(poses.length * CORNER_STRIDE);
  for (let i = 0; i < poses.length; i++) {
    const p = poses[i];
    writeRectangleCorners(p.x, p.y, p.angle, halfWidth, halfHeight, existing, i * CORNER_STRIDE);
  }

  const candidate = new Float64Array(CORNER_STRIDE);
  let bestPose: RectanglePose = { x: 0, y: 0, angle: 0 };
  let bestScore = Infinity;

  for (let s = 0; s < samples; s++) {
    const { x, y } = rng.inDisk(safeRadius);
    const angle = sampleAngle(problem.rotationMode, width, height, rng);
    writeRectangleCorners(x, y, angle, halfWidth, halfHeight, candidate, 0);

    let score = 0;
    for (let i = 0; i < poses.length; i++) {
      const p = poses[i];
      if (!boundingCirclesMayOverlap(x, y, p.x, p.y, halfDiagonal)) continue;
      const depth = quadPenetrationDepth(candidate, 0, existing, i * CORNER_STRIDE);
      if (depth > 0) score += depth * depth;
      if (score >= bestScore) break;
    }

    if (score < bestScore) {
      bestScore = score;
      bestPose = { x, y, angle };
      if (score === 0) break; // a free slot already exists
    }
  }

  return bestPose;
}
