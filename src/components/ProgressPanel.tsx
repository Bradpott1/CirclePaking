import type { SearchState } from '../types/packing';

interface Props {
  state: SearchState | null;
  running: boolean;
}

const PHASE_LABELS: Record<string, string> = {
  idle: 'Idle',
  initialising: 'Building starting layouts',
  searching: 'Searching',
  finished: 'Finished',
  stopped: 'Stopped',
  infeasible: 'Impossible',
};

export function ProgressPanel({ state, running }: Props) {
  if (!state) return null;

  const progress = Math.min(1, Math.max(0, 1 - state.temperature));

  return (
    <section className="progress">
      <div className="progress-line">
        <span className={running ? 'badge live' : 'badge'}>
          {PHASE_LABELS[state.phase] ?? state.phase}
        </span>
        {running && (
          <span className="progress-target">
            Current target: <strong>{state.target}</strong> rectangles
          </span>
        )}
        {state.cappedAt !== null && (
          <span className="progress-cap">ceiling {state.cappedAt}</span>
        )}
      </div>

      {running && (
        <>
          <div className="progress-bar">
            <div className="progress-fill" style={{ width: `${progress * 100}%` }} />
          </div>
          <div className="progress-metrics">
            <span>Iterations: {state.iterations.toLocaleString('en-US')}</span>
            <span>Restarts: {state.restarts}</span>
            <span>
              Best penalty:{' '}
              {state.bestPenalty === 0 ? '0' : state.bestPenalty.toExponential(3)}
            </span>
          </div>
        </>
      )}

      {state.message && <p className="progress-message">{state.message}</p>}
    </section>
  );
}
