import type { PackingProblem, SearchState, ValidationReport } from '../types/packing';
import { calculatePackingDensity } from '../geometry/collision';

interface Props {
  problem: PackingProblem | null;
  state: SearchState | null;
  displayedCount: number;
  report: ValidationReport | null;
  editing: boolean;
}

function formatInteger(value: number): string {
  return value.toLocaleString('en-US');
}

/**
 * Wording here is deliberate: the search returns the best packing it *found*.
 * Nothing in this project proves optimality, so nothing in this panel claims it.
 */
export function StatsPanel({ problem, state, displayedCount, report, editing }: Props) {
  if (!problem) return null;

  const bestCount = state?.bestCount ?? 0;
  const density = calculatePackingDensity(displayedCount, problem);
  const bound = state?.areaUpperBound ?? 0;
  const seconds = ((state?.elapsedMs ?? 0) / 1000).toFixed(1);

  return (
    <section className="stats">
      <div className="stats-headline">
        <span className="stats-label">Best packing found</span>
        <span className="stats-count">{bestCount}</span>
        <span className="stats-unit">rectangles</span>
      </div>

      <dl className="stats-grid">
        <div><dt>Circle radius</dt><dd>{problem.radius}</dd></div>
        <div>
          <dt>Rectangle</dt>
          <dd>{problem.rectangleWidth} &times; {problem.rectangleHeight}</dd>
        </div>
        <div><dt>Area efficiency</dt><dd>{(density * 100).toFixed(1)} %</dd></div>
        <div><dt>Area upper bound</dt><dd>{bound}</dd></div>
        <div><dt>Search time</dt><dd>{seconds} s</dd></div>
        <div><dt>Restarts</dt><dd>{formatInteger(state?.restarts ?? 0)}</dd></div>
        <div><dt>Iterations</dt><dd>{formatInteger(state?.iterations ?? 0)}</dd></div>
        <div><dt>Displayed</dt><dd>{displayedCount} rectangles</dd></div>
      </dl>

      {bestCount > 0 && bound > bestCount && (
        <p className="disclaimer">
          The true maximum lies somewhere between <strong>{bestCount}</strong> and{' '}
          <strong>{bound}</strong>. Failing to place {bestCount + 1} rectangles is not a proof that
          it is impossible, so this is the best solution found, not a proven optimum.
        </p>
      )}
      {bestCount > 0 && bound === bestCount && (
        <p className="disclaimer good">
          This packing matches the area upper bound exactly, so no larger packing can exist.
        </p>
      )}

      {report && (
        <p className={report.valid ? 'verdict good' : 'verdict bad'}>
          {report.valid ? (
            <>
              Independent check passed: {displayedCount} rectangles, none outside the circle, no
              overlapping pair.
            </>
          ) : (
            <>
              Independent check failed{editing ? ' on the manual edit' : ''}:{' '}
              {report.outsideIndices.length} outside the circle,{' '}
              {report.overlappingPairs.length} overlapping pairs (deepest{' '}
              {report.maxPenetration.toExponential(2)}).
            </>
          )}
        </p>
      )}
    </section>
  );
}
