import { describe, expect, it } from 'vitest';
import type { PackingProblem } from '../src/types/packing';
import { areaUpperBound, validatePacking } from '../src/geometry/collision';
import { generateGridSolution, generateRowSolution } from '../src/optimizer/gridInitialization';
import { generateRingSolution } from '../src/optimizer/ringInitialization';
import { generateRandomSolution } from '../src/optimizer/randomInitialization';
import { PackingEngine } from '../src/optimizer/simulatedAnnealing';
import { searchMaximumPacking } from '../src/optimizer/packingOptimizer';
import { createRng } from '../src/utils/math';
import { isRectangleInsideCircle } from '../src/geometry/circle';
import { snapAngle, allowedAngles } from '../src/optimizer/rotation';

const problem: PackingProblem = {
  radius: 10,
  rectangleWidth: 3,
  rectangleHeight: 2,
  rotationMode: 'free',
};

describe('constructive initialisation', () => {
  it('produces a valid row packing', () => {
    const poses = generateRowSolution(10, 3, 2, 0, 0);
    expect(poses.length).toBeGreaterThan(10);
    expect(validatePacking(poses, problem).valid).toBe(true);
  });

  it('snaps an arbitrary angle onto the nearest right angle', () => {
    for (const pose of generateRowSolution(10, 3, 2, 1.2, 0)) {
      expect(pose.angle).toBeCloseTo(Math.PI / 2, 12);
    }
    for (const pose of generateRowSolution(10, 3, 2, 0.3, 0)) {
      expect(pose.angle).toBe(0);
    }
  });

  it('produces a valid staggered row packing', () => {
    const poses = generateRowSolution(10, 3, 2, 0, -0.5, 0.5);
    expect(poses.length).toBeGreaterThan(10);
    expect(validatePacking(poses, problem).valid).toBe(true);
  });

  it('produces a valid best-grid packing that beats a single rectangle', () => {
    const poses = generateGridSolution(problem);
    expect(poses.length).toBeGreaterThan(20);
    expect(validatePacking(poses, problem).valid).toBe(true);
  });

  it('produces a valid concentric-ring packing under free rotation', () => {
    const poses = generateRingSolution(problem);
    expect(poses.length).toBeGreaterThan(10);
    expect(validatePacking(poses, problem).valid).toBe(true);
  });

  it('never returns rings when rotation is restricted', () => {
    expect(generateRingSolution({ ...problem, rotationMode: 'orthogonal' })).toEqual([]);
    expect(generateRingSolution({ ...problem, rotationMode: 'fixed' })).toEqual([]);
  });

  it('keeps every random start inside the circle', () => {
    const rng = createRng(7);
    for (const pose of generateRandomSolution(problem, 40, rng)) {
      expect(isRectangleInsideCircle(pose, 3, 2, 10)).toBe(true);
    }
  });
});

describe('rotation modes', () => {
  it('restricts fixed mode to a single angle', () => {
    expect(allowedAngles('fixed', 3, 2)).toEqual([0]);
    expect(snapAngle('fixed', 3, 2, 1.2)).toBe(0);
  });

  it('collapses orthogonal mode for a square', () => {
    expect(allowedAngles('orthogonal', 2, 2)).toEqual([0]);
    expect(allowedAngles('orthogonal', 3, 2)).toEqual([0, Math.PI / 2]);
  });

  it('snaps to the nearest right angle', () => {
    expect(snapAngle('orthogonal', 3, 2, 1.4)).toBeCloseTo(Math.PI / 2, 12);
    expect(snapAngle('orthogonal', 3, 2, 0.2)).toBe(0);
    expect(snapAngle('orthogonal', 3, 2, 3.0)).toBe(0);
  });

  it('leaves free mode continuous', () => {
    expect(allowedAngles('free', 3, 2)).toBeNull();
    expect(snapAngle('free', 3, 2, 1.234)).toBeCloseTo(1.234, 12);
  });
});

describe('PackingEngine', () => {
  const unit: PackingProblem = {
    radius: 1,
    rectangleWidth: 0.3,
    rectangleHeight: 0.2,
    rotationMode: 'free',
  };

  it('repairs an overlapping start into a strictly feasible packing', () => {
    const rng = createRng(42);
    const start = [
      { x: 0, y: 0, angle: 0 },
      { x: 0.05, y: 0.02, angle: 0.3 },
      { x: -0.04, y: -0.03, angle: 1.1 },
    ];
    const engine = new PackingEngine(start, 0.3, 0.2, 'free', rng);
    expect(engine.penalty).toBeGreaterThan(0);
    expect(engine.repair(500)).toBe(true);
    expect(engine.penalty).toBe(0);
    expect(validatePacking(engine.snapshot(), unit).valid).toBe(true);
  });

  it('keeps every rectangle inside the circle at all times', () => {
    const rng = createRng(11);
    const engine = new PackingEngine(
      generateRandomSolution(unit, 25, rng),
      0.3, 0.2, 'free', rng,
    );
    engine.anneal(5_000, 0, 1);
    for (const pose of engine.snapshot()) {
      expect(isRectangleInsideCircle(pose, 0.3, 0.2, 1, 1e-9)).toBe(true);
    }
  });

  it('reduces the overlap penalty of a random start', () => {
    const rng = createRng(2024);
    const engine = new PackingEngine(
      generateRandomSolution(unit, 20, rng),
      0.3, 0.2, 'free', rng,
    );
    const before = engine.penalty;
    engine.anneal(20_000, 0, 0.8);
    engine.relax(40, 1e-7);
    expect(engine.penalty).toBeLessThan(before);
  });

  it('restores an exact snapshot of a saved state', () => {
    const rng = createRng(5);
    const engine = new PackingEngine(
      generateRandomSolution(unit, 10, rng),
      0.3, 0.2, 'free', rng,
    );
    const saved = engine.saveState();
    const before = engine.snapshot();
    engine.anneal(2_000, 0, 1);
    engine.loadState(saved);
    expect(engine.snapshot()).toEqual(before);
  });
});

describe('searchMaximumPacking', () => {
  it('returns a strictly validated packing', { timeout: 30_000 }, () => {
    const state = searchMaximumPacking(problem, {
      quality: 'fast',
      seed: 123456,
      timeBudgetMs: 3_000,
    });
    expect(state.bestCount).toBeGreaterThan(0);
    expect(validatePacking(state.best, problem).valid).toBe(true);
  });

  it('never exceeds the area upper bound', { timeout: 30_000 }, () => {
    const state = searchMaximumPacking(problem, {
      quality: 'fast',
      seed: 99,
      timeBudgetMs: 3_000,
    });
    expect(state.bestCount).toBeLessThanOrEqual(areaUpperBound(problem));
  });

  // A wall-clock budget stops the search at a machine-dependent point, so
  // reproducibility is asserted against an iteration budget, which is the
  // level at which the seed actually guarantees it.
  it('reproduces a run move for move under a fixed iteration budget', { timeout: 60_000 }, () => {
    const run = () =>
      searchMaximumPacking(problem, {
        quality: 'fast', seed: 777, timeBudgetMs: 60_000, maxIterations: 80_000,
      });
    const a = run();
    const b = run();
    expect(b.bestCount).toBe(a.bestCount);
    expect(b.restarts).toBe(a.restarts);
    expect(b.iterations).toBe(a.iterations);
    expect(b.best).toEqual(a.best);
  });

  it('explores differently for a different seed', { timeout: 60_000 }, () => {
    const options = { quality: 'fast' as const, timeBudgetMs: 60_000, maxIterations: 80_000 };
    const a = searchMaximumPacking(problem, { ...options, seed: 777 });
    const b = searchMaximumPacking(problem, { ...options, seed: 778 });
    expect(b.best).not.toEqual(a.best);
  });

  it('reports zero when the rectangle cannot fit', () => {
    const state = searchMaximumPacking(
      { radius: 1, rectangleWidth: 3, rectangleHeight: 2, rotationMode: 'free' },
      { quality: 'fast', seed: 1, timeBudgetMs: 500 },
    );
    expect(state.bestCount).toBe(0);
    expect(state.phase).toBe('infeasible');
  });

  it('honours the fixed rotation mode', { timeout: 30_000 }, () => {
    const state = searchMaximumPacking(
      { ...problem, rotationMode: 'fixed' },
      { quality: 'fast', seed: 3, timeBudgetMs: 3_000 },
    );
    for (const pose of state.best) expect(pose.angle).toBeCloseTo(0, 9);
    expect(validatePacking(state.best, { ...problem, rotationMode: 'fixed' }).valid).toBe(true);
  });

  it('honours the orthogonal rotation mode', { timeout: 30_000 }, () => {
    const orthogonal: PackingProblem = { ...problem, rotationMode: 'orthogonal' };
    const state = searchMaximumPacking(orthogonal, {
      quality: 'fast', seed: 4, timeBudgetMs: 3_000,
    });
    for (const pose of state.best) {
      const angle = Math.abs(pose.angle % Math.PI);
      const isRightAngle =
        Math.min(angle, Math.abs(angle - Math.PI / 2), Math.abs(angle - Math.PI)) < 1e-9;
      expect(isRightAngle).toBe(true);
    }
    expect(validatePacking(state.best, orthogonal).valid).toBe(true);
  });

  it('handles a square rectangle', { timeout: 30_000 }, () => {
    const square: PackingProblem = {
      radius: 5, rectangleWidth: 2, rectangleHeight: 2, rotationMode: 'orthogonal',
    };
    const state = searchMaximumPacking(square, { quality: 'fast', seed: 8, timeBudgetMs: 3_000 });
    expect(state.bestCount).toBeGreaterThanOrEqual(12);
    expect(validatePacking(state.best, square).valid).toBe(true);
  });
});
