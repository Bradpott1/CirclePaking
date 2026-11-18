import { describe, expect, it } from 'vitest';
import {
  getRectangleCorners,
  rectangleHalfDiagonal,
} from '../src/geometry/rectangle';
import {
  rectanglePenetrationDepth,
  rectanglesOverlap,
} from '../src/geometry/sat';
import {
  circleOverflow,
  isRectangleInsideCircle,
  projectPoseIntoCircle,
  rectangleFitsInCircle,
} from '../src/geometry/circle';
import {
  areaUpperBound,
  calculatePackingDensity,
  validatePacking,
} from '../src/geometry/collision';
import type { PackingProblem } from '../src/types/packing';
import { toDegrees, toRadians } from '../src/utils/math';

const W = 3;
const H = 2;

describe('getRectangleCorners', () => {
  it('returns the four corners of an unrotated rectangle', () => {
    const corners = getRectangleCorners({ x: 0, y: 0, angle: 0 }, W, H);
    expect(corners).toEqual([
      { x: -1.5, y: -1 },
      { x: 1.5, y: -1 },
      { x: 1.5, y: 1 },
      { x: -1.5, y: 1 },
    ]);
  });

  it('rotates a rectangle by 90 degrees into its swapped footprint', () => {
    const corners = getRectangleCorners({ x: 0, y: 0, angle: Math.PI / 2 }, W, H);
    const xs = corners.map((c) => c.x);
    const ys = corners.map((c) => c.y);
    expect(Math.max(...xs) - Math.min(...xs)).toBeCloseTo(H, 12);
    expect(Math.max(...ys) - Math.min(...ys)).toBeCloseTo(W, 12);
  });

  it('translates with the centre', () => {
    const corners = getRectangleCorners({ x: 5, y: -2, angle: 0 }, W, H);
    expect(corners[0]).toEqual({ x: 3.5, y: -3 });
    expect(corners[2]).toEqual({ x: 6.5, y: -1 });
  });

  it('keeps every corner at the half diagonal from the centre', () => {
    const half = rectangleHalfDiagonal(W, H);
    for (const angle of [0, 0.3, 1.1, 2.9]) {
      for (const corner of getRectangleCorners({ x: 1, y: -1, angle }, W, H)) {
        expect(Math.hypot(corner.x - 1, corner.y + 1)).toBeCloseTo(half, 12);
      }
    }
  });
});

describe('rectangle overlap (Separating Axis Theorem)', () => {
  // Test 1 from the brief.
  it('reports no overlap for two clearly separated rectangles', () => {
    expect(rectanglesOverlap({ x: 0, y: 0, angle: 0 }, { x: 10, y: 0, angle: 0 }, W, H)).toBe(false);
    expect(rectanglesOverlap({ x: 0, y: 0, angle: 0 }, { x: 0, y: 7, angle: 0 }, W, H)).toBe(false);
  });

  // Test 2: touching is explicitly allowed.
  it('reports no overlap for rectangles sharing exactly one side', () => {
    expect(rectanglesOverlap({ x: 0, y: 0, angle: 0 }, { x: W, y: 0, angle: 0 }, W, H)).toBe(false);
    expect(rectanglesOverlap({ x: 0, y: 0, angle: 0 }, { x: 0, y: H, angle: 0 }, W, H)).toBe(false);
  });

  it('reports no overlap for rectangles touching at a single corner', () => {
    expect(rectanglesOverlap({ x: 0, y: 0, angle: 0 }, { x: W, y: H, angle: 0 }, W, H)).toBe(false);
  });

  // Test 3.
  it('reports an overlap for a slight interpenetration', () => {
    expect(rectanglesOverlap({ x: 0, y: 0, angle: 0 }, { x: W - 1e-4, y: 0, angle: 0 }, W, H)).toBe(true);
    expect(rectanglePenetrationDepth({ x: 0, y: 0, angle: 0 }, { x: W - 0.25, y: 0, angle: 0 }, W, H))
      .toBeCloseTo(0.25, 12);
  });

  // Test 4.
  it('reports an overlap between two rotated rectangles', () => {
    const a = { x: 0, y: 0, angle: toRadians(30) };
    const b = { x: 1.2, y: 0.6, angle: toRadians(75) };
    expect(rectanglesOverlap(a, b, W, H)).toBe(true);
  });

  it('separates two rotated rectangles that are genuinely apart', () => {
    const a = { x: 0, y: 0, angle: toRadians(30) };
    const b = { x: 6, y: 4, angle: toRadians(75) };
    expect(rectanglesOverlap(a, b, W, H)).toBe(false);
  });

  it('detects containment of one rectangle in another as an overlap', () => {
    expect(rectanglesOverlap({ x: 0, y: 0, angle: 0 }, { x: 0, y: 0, angle: toRadians(20) }, W, H)).toBe(true);
  });

  it('tolerates contact reached through floating point noise', () => {
    // A gap of 1e-12 must not be read as an overlap.
    expect(rectanglesOverlap({ x: 0, y: 0, angle: 0 }, { x: W + 1e-12, y: 0, angle: 0 }, W, H)).toBe(false);
  });
});

describe('rectangle inside circle', () => {
  const half = rectangleHalfDiagonal(W, H);

  // Test 5.
  it('accepts a rectangle comfortably inside the circle', () => {
    expect(isRectangleInsideCircle({ x: 0, y: 0, angle: 0 }, W, H, 10)).toBe(true);
    expect(isRectangleInsideCircle({ x: 4, y: 3, angle: 1 }, W, H, 10)).toBe(true);
  });

  // Test 6.
  it('rejects a rectangle whose corner leaves the circle', () => {
    expect(isRectangleInsideCircle({ x: 9.5, y: 0, angle: 0 }, W, H, 10)).toBe(false);
    expect(circleOverflow({ x: 9.5, y: 0, angle: 0 }, W, H, 10)).toBeGreaterThan(0);
  });

  // Test 7.
  it('accepts a rectangle exactly inscribed in the circle', () => {
    expect(isRectangleInsideCircle({ x: 0, y: 0, angle: 0 }, W, H, half)).toBe(true);
    expect(isRectangleInsideCircle({ x: 0, y: 0, angle: 0.7 }, W, H, half)).toBe(true);
    expect(circleOverflow({ x: 0, y: 0, angle: 0 }, W, H, half)).toBeCloseTo(0, 12);
  });

  it('rejects the inscribed rectangle once the circle shrinks', () => {
    expect(isRectangleInsideCircle({ x: 0, y: 0, angle: 0 }, W, H, half - 1e-6)).toBe(false);
  });

  it('knows when no rectangle fits at all', () => {
    expect(rectangleFitsInCircle(W, H, half)).toBe(true);
    expect(rectangleFitsInCircle(W, H, half - 1e-6)).toBe(false);
  });
});

describe('projectPoseIntoCircle', () => {
  it('pulls an outside rectangle back in, at every angle', () => {
    for (const angle of [0, 0.4, 1.0, 2.2, 3.0]) {
      const projected = projectPoseIntoCircle({ x: 12, y: -7, angle }, W, H, 10);
      expect(isRectangleInsideCircle(projected, W, H, 10)).toBe(true);
      expect(projected.angle).toBe(angle);
    }
  });

  it('leaves an already-contained rectangle untouched', () => {
    const pose = { x: 1, y: 2, angle: 0.5 };
    const projected = projectPoseIntoCircle(pose, W, H, 10);
    expect(projected.x).toBeCloseTo(pose.x, 12);
    expect(projected.y).toBeCloseTo(pose.y, 12);
  });
});

describe('packing level helpers', () => {
  const problem: PackingProblem = {
    radius: 10,
    rectangleWidth: W,
    rectangleHeight: H,
    rotationMode: 'free',
  };

  it('computes the area upper bound', () => {
    expect(areaUpperBound(problem)).toBe(Math.floor((Math.PI * 100) / 6));
  });

  it('computes the packing density', () => {
    expect(calculatePackingDensity(31, problem)).toBeCloseTo((31 * 6) / (Math.PI * 100), 12);
  });

  it('validates a clean two-rectangle packing', () => {
    const report = validatePacking(
      [
        { x: -1.5, y: 0, angle: 0 },
        { x: 1.5, y: 0, angle: 0 },
      ],
      problem,
    );
    expect(report.valid).toBe(true);
    expect(report.overlappingPairs).toHaveLength(0);
    expect(report.outsideIndices).toHaveLength(0);
  });

  it('flags the offending pair when two rectangles overlap', () => {
    const report = validatePacking(
      [
        { x: 0, y: 0, angle: 0 },
        { x: 1, y: 0, angle: 0 },
      ],
      problem,
    );
    expect(report.valid).toBe(false);
    expect(report.overlappingPairs).toEqual([[0, 1]]);
    expect(report.maxPenetration).toBeCloseTo(2, 12);
  });

  it('flags a rectangle that leaves the circle', () => {
    const report = validatePacking([{ x: 9.8, y: 0, angle: 0 }], problem);
    expect(report.valid).toBe(false);
    expect(report.outsideIndices).toEqual([0]);
    expect(report.maxCornerOverflow).toBeGreaterThan(0);
  });
});

describe('angle conversion', () => {
  it('round-trips degrees and radians', () => {
    expect(toDegrees(Math.PI)).toBeCloseTo(180, 12);
    expect(toRadians(90)).toBeCloseTo(Math.PI / 2, 12);
    expect(toDegrees(toRadians(37.4))).toBeCloseTo(37.4, 12);
  });
});
