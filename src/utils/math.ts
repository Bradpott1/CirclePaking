/**
 * Absolute tolerance used by every geometric predicate, expressed in the
 * normalised space where the circle radius equals 1. Callers working in world
 * units scale it with `scaledEpsilon`.
 */
export const EPSILON = 1e-9;

export const TWO_PI = Math.PI * 2;

export function clamp(value: number, min: number, max: number): number {
  return value < min ? min : value > max ? max : value;
}

export function toDegrees(radians: number): number {
  return (radians * 180) / Math.PI;
}

export function toRadians(degrees: number): number {
  return (degrees * Math.PI) / 180;
}

/**
 * Folds an angle into [0, period). Rectangles are symmetric under a half turn,
 * so the natural period for a pose is PI.
 */
export function normalizeAngle(angle: number, period: number = Math.PI): number {
  const wrapped = angle % period;
  return wrapped < 0 ? wrapped + period : wrapped;
}

/** Tolerance in world units for a problem of the given characteristic size. */
export function scaledEpsilon(scale: number): number {
  return EPSILON * Math.max(1, Math.abs(scale));
}

export function isFinitePositive(value: number): boolean {
  return Number.isFinite(value) && value > 0;
}

export interface Rng {
  /** Uniform in [0, 1). */
  next(): number;
  /** Uniform in [min, max). */
  range(min: number, max: number): number;
  /** Uniform integer in [0, n). */
  int(n: number): number;
  /** Standard normal deviate. */
  normal(): number;
  /** Uniform point in the disk of the given radius, centred on the origin. */
  inDisk(radius: number): { x: number; y: number };
}

/**
 * mulberry32 -- small, fast, and fully deterministic for a given 32 bit seed,
 * which is what makes a whole search reproducible from a seed number.
 */
export function createRng(seed: number): Rng {
  let state = (seed >>> 0) || 0x9e3779b9;

  const next = (): number => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };

  return {
    next,
    range: (min, max) => min + next() * (max - min),
    int: (n) => Math.floor(next() * n),
    normal: () => {
      // Box-Muller; the guard keeps log() away from zero.
      const u = Math.max(next(), 1e-12);
      const v = next();
      return Math.sqrt(-2 * Math.log(u)) * Math.cos(TWO_PI * v);
    },
    inDisk: (radius) => {
      const r = radius * Math.sqrt(next());
      const a = next() * TWO_PI;
      return { x: r * Math.cos(a), y: r * Math.sin(a) };
    },
  };
}

export function randomSeed(): number {
  return Math.floor(Math.random() * 0xffffffff) >>> 0;
}
