/** Rotation freedom offered to the optimizer. */
export type RotationMode = 'fixed' | 'orthogonal' | 'free';

/** Preset controlling how much computation the search is allowed to spend. */
export type SearchQuality = 'fast' | 'balanced' | 'deep';

/** Pose of one rectangle: centre position plus rotation angle in radians. */
export interface RectanglePose {
  x: number;
  y: number;
  angle: number;
}

export interface Point {
  x: number;
  y: number;
}

/** The problem statement. Angles are radians, lengths share an arbitrary unit. */
export interface PackingProblem {
  radius: number;
  rectangleWidth: number;
  rectangleHeight: number;
  rotationMode: RotationMode;
}

export interface PackingSolution {
  rectangles: RectanglePose[];
  /** True only when an exact, independent geometric validation passed. */
  valid: boolean;
  /** N * W * H / (pi * R^2) */
  density: number;
  /** Penalty score: 0 for a feasible packing, > 0 otherwise. */
  score: number;
}

/** Result of the independent strict validation pass. */
export interface ValidationReport {
  valid: boolean;
  /** Indices of rectangles with at least one corner outside the circle. */
  outsideIndices: number[];
  /** Index pairs whose interiors intersect. */
  overlappingPairs: Array<[number, number]>;
  /** Largest distance by which a corner exceeds the circle radius. */
  maxCornerOverflow: number;
  /** Largest penetration depth found between any two rectangles. */
  maxPenetration: number;
}

export type SearchPhase =
  | 'idle'
  | 'initialising'
  | 'searching'
  | 'finished'
  | 'stopped'
  | 'infeasible';

/** Snapshot streamed from the worker to the UI while the search runs. */
export interface SearchState {
  phase: SearchPhase;
  /** Rectangles of the best *validated* packing found so far (world coordinates). */
  best: RectanglePose[];
  bestCount: number;
  /** Live working configuration of the current attempt (may be infeasible). */
  current: RectanglePose[];
  /** Number of rectangles the search is currently trying to fit. */
  target: number;
  /** floor(pi R^2 / (W H)) -- a theoretical upper bound, not an achievable count. */
  areaUpperBound: number;
  /** Cap applied to keep the search tractable, if any. */
  cappedAt: number | null;
  iterations: number;
  restarts: number;
  elapsedMs: number;
  temperature: number;
  /** Lowest overlap penalty reached for the current target. */
  bestPenalty: number;
  density: number;
  message: string;
}

export interface SearchOptions {
  quality: SearchQuality;
  seed: number;
  /** Hard ceiling on the number of rectangles the search will attempt. */
  maxRectangles: number;
  /** Total wall-clock budget in milliseconds. */
  timeBudgetMs: number;
  /**
   * Optional ceiling on the total number of annealing moves.
   *
   * The seed already makes the search *path* deterministic, but a wall-clock
   * budget cuts that path at a machine-dependent point. Setting an iteration
   * budget instead makes a run reproducible move for move, which is what the
   * tests and any offline comparison need.
   */
  maxIterations?: number;
}

/** Messages sent from the UI to the optimisation worker. */
export type WorkerRequest =
  | { type: 'start'; problem: PackingProblem; options: SearchOptions }
  | { type: 'stop' };

/** Messages sent from the optimisation worker back to the UI. */
export type WorkerResponse =
  | { type: 'progress'; state: SearchState }
  | { type: 'done'; state: SearchState }
  | { type: 'error'; message: string };
