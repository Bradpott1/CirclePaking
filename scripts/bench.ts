import { searchMaximumPacking } from '../src/optimizer/packingOptimizer';
import { areaUpperBound, validatePacking } from '../src/geometry/collision';
import { generateGridSolution } from '../src/optimizer/gridInitialization';
import { generateRingSolution } from '../src/optimizer/ringInitialization';
import type { PackingProblem, RotationMode, SearchQuality } from '../src/types/packing';

const cases: Array<[number, number, number, RotationMode]> = [
  [10, 3, 2, 'free'],
  [10, 3, 2, 'orthogonal'],
  [10, 3, 2, 'fixed'],
  [5, 2, 2, 'orthogonal'],
  [10, 1, 1, 'fixed'],
  [3, 2, 1, 'free'],
];

const quality = (process.argv[2] ?? 'balanced') as SearchQuality;

for (const [radius, w, h, rotationMode] of cases) {
  const problem: PackingProblem = {
    radius, rectangleWidth: w, rectangleHeight: h, rotationMode,
  };
  const grid = generateGridSolution(problem).length;
  const ring = generateRingSolution(problem).length;
  const t0 = Date.now();
  const state = searchMaximumPacking(problem, { quality, seed: 20240922 });
  const ms = Date.now() - t0;
  const report = validatePacking(state.best, problem);
  console.log(
    `R=${radius} ${w}x${h} ${rotationMode.padEnd(10)} ` +
    `grid=${String(grid).padStart(3)} ring=${String(ring).padStart(3)} ` +
    `=> best=${String(state.bestCount).padStart(3)} / bound=${String(areaUpperBound(problem)).padStart(3)} ` +
    `density=${(state.density * 100).toFixed(1)}% valid=${report.valid} ` +
    `restarts=${state.restarts} iters=${state.iterations.toLocaleString('en-US')} ${ms}ms`,
  );
}
