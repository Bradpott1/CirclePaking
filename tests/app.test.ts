import { describe, expect, it } from 'vitest';
import { checkForm, type FormValues } from '../src/utils/validation';
import { buildExport, parseImport } from '../src/utils/exporters';
import { createRng, normalizeAngle, randomSeed, scaledEpsilon } from '../src/utils/math';
import { SpatialGrid } from '../src/optimizer/spatialGrid';
import type { PackingProblem } from '../src/types/packing';

const baseForm: FormValues = {
  radius: '10',
  width: '3',
  height: '2',
  rotationMode: 'free',
  quality: 'balanced',
  seed: 1,
  maxRectangles: '400',
};

describe('input validation', () => {
  it('accepts a well formed problem', () => {
    const check = checkForm(baseForm);
    expect(check.errors).toEqual([]);
    expect(check.problem).toEqual({
      radius: 10, rectangleWidth: 3, rectangleHeight: 2, rotationMode: 'free',
    });
  });

  it('rejects zero, negative, empty, NaN and infinite values', () => {
    for (const bad of ['0', '-1', '', 'abc', 'Infinity', 'NaN']) {
      const check = checkForm({ ...baseForm, radius: bad });
      expect(check.problem).toBeNull();
      expect(check.errors.length).toBeGreaterThan(0);
    }
  });

  it('reports each offending field separately', () => {
    const check = checkForm({ ...baseForm, width: '-2', height: '0' });
    expect(check.errors).toHaveLength(2);
    expect(check.errors.join(' ')).toContain('width');
    expect(check.errors.join(' ')).toContain('height');
  });

  it('warns when no rectangle can fit at all', () => {
    const check = checkForm({ ...baseForm, radius: '1' });
    expect(check.errors).toEqual([]);
    expect(check.warnings.join(' ')).toContain('0 rectangles');
  });

  it('warns when the area bound exceeds the ceiling', () => {
    const check = checkForm({ ...baseForm, width: '0.2', height: '0.2', maxRectangles: '50' });
    expect(check.warnings.join(' ')).toContain('ceiling of 50');
  });

  it('rejects an invalid rectangle ceiling', () => {
    expect(checkForm({ ...baseForm, maxRectangles: '0' }).errors.length).toBeGreaterThan(0);
  });
});

describe('export and import', () => {
  const problem: PackingProblem = {
    radius: 10, rectangleWidth: 3, rectangleHeight: 2, rotationMode: 'orthogonal',
  };
  const placements = [
    { x: -1.5, y: 0, angle: 0 },
    { x: 1.5, y: 0, angle: 0 },
  ];

  it('builds an export carrying the count, density and validity', () => {
    const data = buildExport(problem, placements, 42);
    expect(data.count).toBe(2);
    expect(data.radius).toBe(10);
    expect(data.rectangle).toEqual({ width: 3, height: 2 });
    expect(data.seed).toBe(42);
    expect(data.validated).toBe(true);
    expect(data.density).toBeCloseTo(12 / (Math.PI * 100), 12);
  });

  it('marks an invalid packing as such instead of hiding it', () => {
    const data = buildExport(problem, [
      { x: 0, y: 0, angle: 0 },
      { x: 1, y: 0, angle: 0 },
    ]);
    expect(data.validated).toBe(false);
  });

  it('round-trips through JSON', () => {
    const data = buildExport(problem, placements, 7);
    const parsed = parseImport(JSON.stringify(data));
    expect(parsed.problem).toEqual(problem);
    expect(parsed.placements).toEqual(placements);
  });

  it('rejects malformed files with a useful message', () => {
    expect(() => parseImport('{}')).toThrow(/positive radius/);
    expect(() => parseImport(JSON.stringify({ radius: 10, rectangle: { width: 3, height: 2 } })))
      .toThrow(/placements/);
    expect(() =>
      parseImport(JSON.stringify({
        radius: 10, rectangle: { width: 3, height: 2 },
        placements: [{ x: 1, y: 'oops', angle: 0 }],
      })),
    ).toThrow(/Placement 0/);
  });

  it('falls back to free rotation for an unknown mode', () => {
    const parsed = parseImport(JSON.stringify({
      radius: 5, rectangle: { width: 1, height: 1 }, rotationMode: 'weird', placements: [],
    }));
    expect(parsed.problem.rotationMode).toBe('free');
  });
});

describe('seeded random generator', () => {
  it('is deterministic for a given seed', () => {
    const a = createRng(99);
    const b = createRng(99);
    for (let i = 0; i < 50; i++) expect(b.next()).toBe(a.next());
  });

  it('differs between seeds', () => {
    expect(createRng(1).next()).not.toBe(createRng(2).next());
  });

  it('stays inside its ranges', () => {
    const rng = createRng(3);
    for (let i = 0; i < 500; i++) {
      const value = rng.next();
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(1);
      expect(rng.int(7)).toBeLessThan(7);
      const point = rng.inDisk(2);
      expect(Math.hypot(point.x, point.y)).toBeLessThanOrEqual(2);
    }
  });

  it('produces a usable fresh seed', () => {
    const seed = randomSeed();
    expect(Number.isInteger(seed)).toBe(true);
    expect(createRng(seed).next()).toBeGreaterThanOrEqual(0);
  });
});

describe('math helpers', () => {
  it('folds angles into a half turn', () => {
    expect(normalizeAngle(Math.PI + 0.5)).toBeCloseTo(0.5, 12);
    expect(normalizeAngle(-0.25)).toBeCloseTo(Math.PI - 0.25, 12);
    expect(normalizeAngle(0)).toBe(0);
  });

  it('scales the tolerance with the problem size', () => {
    expect(scaledEpsilon(1000)).toBeGreaterThan(scaledEpsilon(1));
    expect(scaledEpsilon(0.1)).toBe(scaledEpsilon(1));
  });
});

describe('SpatialGrid', () => {
  it('returns every neighbour that could possibly overlap', () => {
    const grid = new SpatialGrid(4, 1.2, 0.5);
    const points = [
      [0, 0], [0.2, 0.1], [0.9, 0.9], [-0.8, 0.4],
    ];
    points.forEach(([x, y], i) => grid.insert(i, x, y));

    const out = new Int32Array(4);
    const found = grid.query(0, 0, 0, out);
    const neighbours = Array.from(out.slice(0, found)).sort();
    expect(neighbours).toContain(1); // close by, must be reported
    expect(neighbours).not.toContain(0); // never itself
    expect(neighbours).not.toContain(2); // two cells away
  });

  it('tracks items as they move between cells', () => {
    const grid = new SpatialGrid(2, 1.2, 0.5);
    grid.insert(0, 0, 0);
    grid.insert(1, 1, 1);

    const out = new Int32Array(2);
    expect(grid.query(0, 0, 0, out)).toBe(0);
    grid.move(1, 0.1, 0.1);
    expect(grid.query(0, 0, 0, out)).toBe(1);
    expect(out[0]).toBe(1);

    grid.clear();
    expect(grid.query(0, 0, 0, out)).toBe(0);
  });
});
