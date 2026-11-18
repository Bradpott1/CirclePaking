import type { RotationMode } from '../types/packing';
import { normalizeAngle, type Rng } from '../utils/math';

/**
 * Discrete angles a pose may take, or `null` when rotation is continuous.
 * A square is invariant under a quarter turn, so 'orthogonal' collapses to a
 * single angle in that case.
 */
export function allowedAngles(
  mode: RotationMode,
  width: number,
  height: number,
): number[] | null {
  if (mode === 'fixed') return [0];
  if (mode === 'orthogonal') {
    return width === height ? [0] : [0, Math.PI / 2];
  }
  return null;
}

/** Draws an angle compatible with the rotation mode. */
export function sampleAngle(
  mode: RotationMode,
  width: number,
  height: number,
  rng: Rng,
): number {
  const discrete = allowedAngles(mode, width, height);
  if (discrete) return discrete[rng.int(discrete.length)];
  return rng.next() * Math.PI;
}

/** Forces an angle onto the closest value the rotation mode permits. */
export function snapAngle(
  mode: RotationMode,
  width: number,
  height: number,
  angle: number,
): number {
  const discrete = allowedAngles(mode, width, height);
  if (!discrete) return normalizeAngle(angle);
  const target = normalizeAngle(angle);
  let best = discrete[0];
  let bestDistance = Infinity;
  for (const candidate of discrete) {
    const raw = Math.abs(target - candidate);
    const distance = Math.min(raw, Math.PI - raw);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = candidate;
    }
  }
  return best;
}

export function rotationAllowsFreeAngles(mode: RotationMode): boolean {
  return mode === 'free';
}
