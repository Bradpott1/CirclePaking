import type {
  PackingProblem,
  RectanglePose,
  RotationMode,
  SearchOptions,
  SearchPhase,
  SearchQuality,
  SearchState,
} from '../types/packing';
import {
  areaUpperBound,
  calculatePackingDensity,
  validatePacking,
} from '../geometry/collision';
import { rectangleFitsInCircle } from '../geometry/circle';
import { rectangleHalfDiagonal } from '../geometry/rectangle';
import { generateGridSolution, generateGridVariants } from './gridInitialization';
import { generateRingVariants } from './ringInitialization';
import {
  findInsertionPose,
  generateRandomSolution,
  perturbSolution,
} from './randomInitialization';
import { PackingEngine, REPAIR_CLEARANCE } from './simulatedAnnealing';
import { snapAngle } from './rotation';
import { createRng, type Rng } from '../utils/math';

export interface QualityPreset {
  timeBudgetMs: number;
  /** Simulated-annealing moves per restart, per rectangle. */
  iterationsPerRectangle: number;
  /** How many independent restarts to spend on a target before giving up. */
  restartsPerTarget: number;
}

export const QUALITY_PRESETS: Record<SearchQuality, QualityPreset> = {
  fast: { timeBudgetMs: 4_000, iterationsPerRectangle: 500, restartsPerTarget: 15 },
  balanced: { timeBudgetMs: 18_000, iterationsPerRectangle: 2_000, restartsPerTarget: 50 },
  deep: { timeBudgetMs: 75_000, iterationsPerRectangle: 7_000, restartsPerTarget: 200 },
};

/** Default ceiling on N, so a tiny rectangle cannot make the search crawl. */
export const DEFAULT_MAX_RECTANGLES = 400;

/**
 * How many times the per-restart iteration budget may be doubled before the
 * search gives up on a target. Running out of restarts is not evidence that a
 * target is impossible, only that the current effort was not enough -- so the
 * effort is raised instead, until the wall-clock budget has the final say.
 */
const MAX_ESCALATIONS = 3;

const now = (): number =>
  typeof performance !== 'undefined' ? performance.now() : Date.now();

/**
 * Drives the whole search: build feasible starting points, then repeatedly try
 * to fit one more rectangle than the best packing found so far.
 *
 * The class is deliberately a *stepper*. `step(sliceMs)` advances the search
 * for a few milliseconds and returns, which is what lets the worker stream
 * progress and honour a stop request without any shared memory.
 */
export class PackingSearch {
  private readonly problem: PackingProblem;
  private readonly options: SearchOptions;
  private readonly scale: number;
  /** The same problem with the circle radius normalised to 1. */
  private readonly unitProblem: PackingProblem;
  private readonly rng: Rng;
  private readonly preset: QualityPreset;

  private phase: SearchPhase = 'idle';
  private message = '';
  private startedAt = 0;
  private elapsedMs = 0;

  private best: RectanglePose[] = [];
  private target = 1;
  private restarts = 0;
  private iterations = 0;
  private failuresAtTarget = 0;
  private escalations = 0;
  private effortMultiplier = 1;
  private bestPenaltyAtTarget = Infinity;
  private temperatureHint = 0;

  /** Constructive layouts, generated once and reused by every restart. */
  private startPool: RectanglePose[][] = [];
  /** Overlap penalty below which a repair attempt is worth its cost. */
  private repairThreshold = 0;

  private engine: PackingEngine | null = null;
  private attemptBudget = 0;
  private attemptDone = 0;
  private attemptBestState: ReturnType<PackingEngine['saveState']> | null = null;

  readonly areaBound: number;
  readonly cappedAt: number | null;

  constructor(problem: PackingProblem, options: SearchOptions) {
    this.problem = problem;
    this.options = options;
    this.scale = problem.radius;
    this.unitProblem = {
      radius: 1,
      rectangleWidth: problem.rectangleWidth / this.scale,
      rectangleHeight: problem.rectangleHeight / this.scale,
      rotationMode: problem.rotationMode,
    };
    this.rng = createRng(options.seed);
    this.preset = QUALITY_PRESETS[options.quality];
    this.areaBound = areaUpperBound(problem);
    this.cappedAt =
      this.areaBound > options.maxRectangles ? options.maxRectangles : null;
  }

  get finished(): boolean {
    return this.phase === 'finished' || this.phase === 'stopped' || this.phase === 'infeasible';
  }

  stop(): void {
    if (!this.finished) {
      this.phase = 'stopped';
      this.message = 'Search stopped by user. Best packing found is kept.';
    }
  }

  /** Advances the search for at most `sliceMs` milliseconds. */
  step(sliceMs: number): void {
    if (this.finished) return;
    if (this.startedAt === 0) this.startedAt = now();

    const deadline = now() + sliceMs;

    if (this.phase === 'idle') {
      this.initialise();
      this.elapsedMs = now() - this.startedAt;
      return;
    }

    while (this.phase === 'searching' && now() < deadline) {
      if (now() - this.startedAt > this.options.timeBudgetMs) {
        this.conclude('Computation budget reached.');
        break;
      }
      if (this.options.maxIterations !== undefined && this.iterations >= this.options.maxIterations) {
        this.conclude('Iteration budget reached.');
        break;
      }
      if (this.target > this.options.maxRectangles) {
        this.conclude(`Reached the configured ceiling of ${this.options.maxRectangles} rectangles.`);
        break;
      }
      if (this.best.length >= this.areaBound) {
        this.conclude('Best packing matches the area upper bound; no better packing can exist.');
        break;
      }
      this.runAttemptSlice(Math.min(deadline, now() + 12));
    }

    this.elapsedMs = now() - this.startedAt;
  }

  // ---------------------------------------------------------------- phase 1

  private initialise(): void {
    this.phase = 'initialising';

    const { rectangleWidth: width, rectangleHeight: height, radius } = this.problem;
    if (!rectangleFitsInCircle(width, height, radius)) {
      this.best = [];
      this.phase = 'infeasible';
      this.message =
        'The rectangle is larger than the circle: its half diagonal ' +
        `(${rectangleHalfDiagonal(width, height).toFixed(4)}) exceeds the radius. No rectangle can be placed.`;
      return;
    }

    const unit = Math.min(this.unitProblem.rectangleWidth, this.unitProblem.rectangleHeight);
    this.repairThreshold = Math.pow(0.04 * unit, 2);

    // A fine offset scan is cheap and directly decides how good the
    // constructive layouts are, so it is worth being generous here.
    this.startPool = [
      ...generateGridVariants(this.unitProblem, 48),
      ...generateRingVariants(this.unitProblem),
    ];

    const candidates: RectanglePose[][] = [];
    const grid = generateGridSolution(this.unitProblem, 160);
    if (grid.length) candidates.push(grid);
    for (const variant of this.startPool.slice(0, 8)) candidates.push(variant.slice());
    candidates.push([{ x: 0, y: 0, angle: 0 }]);

    for (const candidate of candidates) {
      if (candidate.length <= this.best.length) continue;
      if (candidate.length > this.options.maxRectangles) {
        candidate.length = this.options.maxRectangles;
      }
      if (this.acceptIfValid(candidate)) continue;

      // Constructive layouts are built to be feasible, but tighten any that
      // are not rather than throwing the work away.
      const engine = new PackingEngine(
        candidate, this.unitProblem.rectangleWidth, this.unitProblem.rectangleHeight,
        this.problem.rotationMode, this.rng,
      );
      if (engine.repair(200)) this.acceptIfValid(engine.snapshot());
    }

    this.target = this.best.length + 1;
    this.phase = 'searching';
    this.message = this.best.length
      ? `Constructive start: ${this.best.length} rectangles. Searching for ${this.target}.`
      : 'No constructive layout found; searching from random starts.';
  }

  // ---------------------------------------------------------------- phase 2

  private startAttempt(): void {
    const target = this.target;
    const start = this.buildStart(target);

    // Free rotation contains the right-angle solutions, but a continuous
    // random walk explores them badly: it keeps breaking the aligned
    // structures that pack a circle well. Spending a share of the restarts
    // under right-angle discipline means free rotation is never worse than
    // the orthogonal mode, while the remaining restarts still chase the
    // arbitrary angles that pay off near the rim.
    const discipline: RotationMode =
      this.problem.rotationMode === 'free' && this.rng.next() < 0.45
        ? 'orthogonal'
        : this.problem.rotationMode;

    const poses =
      discipline === this.problem.rotationMode
        ? start
        : start.map((pose) => ({
            ...pose,
            angle: snapAngle(
              discipline,
              this.unitProblem.rectangleWidth,
              this.unitProblem.rectangleHeight,
              pose.angle,
            ),
          }));

    this.engine = new PackingEngine(
      poses,
      this.unitProblem.rectangleWidth,
      this.unitProblem.rectangleHeight,
      discipline,
      this.rng,
    );
    this.attemptBudget = Math.max(
      2_000,
      Math.round(
        this.preset.iterationsPerRectangle * Math.max(target, 4) * this.effortMultiplier,
      ),
    );
    this.attemptDone = 0;
    this.attemptBestState = this.engine.saveState();
  }

  /**
   * Builds a starting configuration with exactly `target` rectangles. The mix
   * matters: most restarts grow the current best (which keeps hard-won
   * structure), the rest come from grids, rings or pure noise so the search
   * is never trapped by a single initialisation.
   */
  private buildStart(target: number): RectanglePose[] {
    const roll = this.rng.next();
    const width = this.unitProblem.rectangleWidth;
    const height = this.unitProblem.rectangleHeight;

    if (this.best.length === target - 1 && this.best.length > 0 && roll < 0.65) {
      const base =
        roll < 0.35
          ? this.best.slice()
          : perturbSolution(this.best, this.unitProblem, this.rng, 0.03, 0.15);
      const extra = findInsertionPose(base, this.unitProblem, this.rng, 800);
      return [...base, extra];
    }

    if (roll < 0.85 && this.startPool.length > 0) {
      const chosen = this.startPool[this.rng.int(this.startPool.length)];
      return this.resize(
        perturbSolution(chosen, this.unitProblem, this.rng, 0.02, 0.1),
        target,
      );
    }

    void width;
    void height;
    return generateRandomSolution(this.unitProblem, target, this.rng);
  }

  /** Trims or tops up an arrangement so it holds exactly `target` rectangles. */
  private resize(poses: RectanglePose[], target: number): RectanglePose[] {
    const result = poses.slice();
    while (result.length > target) {
      result.splice(this.rng.int(result.length), 1);
    }
    while (result.length < target) {
      result.push(findInsertionPose(result, this.unitProblem, this.rng, 300));
    }
    return result;
  }

  private runAttemptSlice(deadline: number): void {
    if (!this.engine) {
      this.startAttempt();
      this.bestPenaltyAtTarget = Math.min(
        this.bestPenaltyAtTarget,
        this.engine!.penalty,
      );
    }
    const engine = this.engine!;
    const chunk = Math.max(200, Math.min(4_000, Math.round(this.attemptBudget / 40)));

    while (now() < deadline && this.attemptDone < this.attemptBudget) {
      // Checked at chunk granularity rather than per slice, so the run stops
      // at exactly the same move every time the same budget is used.
      if (
        this.options.maxIterations !== undefined &&
        this.iterations >= this.options.maxIterations
      ) {
        return;
      }

      const from = this.attemptDone / this.attemptBudget;
      const steps = Math.min(chunk, this.attemptBudget - this.attemptDone);
      const to = (this.attemptDone + steps) / this.attemptBudget;

      engine.anneal(steps, from, to);
      engine.relax(2, REPAIR_CLEARANCE);

      this.attemptDone += steps;
      this.iterations += steps;
      this.temperatureHint = 1 - to;

      if (engine.penalty < (this.attemptBestState?.penalty ?? Infinity)) {
        this.attemptBestState = engine.saveState();
      }
      if (engine.penalty < this.bestPenaltyAtTarget) {
        this.bestPenaltyAtTarget = engine.penalty;
      }

      // Repair is expensive, so it only runs when the configuration is close
      // enough that closing the last gaps has a real chance of succeeding.
      if (engine.penalty === 0) {
        if (this.tryFinishAttempt(engine, 1)) return;
      } else if (engine.penalty < this.repairThreshold) {
        if (this.tryFinishAttempt(engine, 25)) return;
      }
    }

    // The time slice can expire long before the attempt's iteration budget is
    // spent; when that happens the attempt must survive to the next slice
    // instead of being restarted from scratch.
    if (this.attemptDone < this.attemptBudget) return;

    // Attempt exhausted: give the best state one last, thorough repair.
    if (this.attemptBestState) engine.loadState(this.attemptBestState);
    this.tryFinishAttempt(engine, 600);

    this.engine = null;
    this.restarts++;
    this.failuresAtTarget++;

    if (this.failuresAtTarget >= this.preset.restartsPerTarget) {
      if (this.escalations < MAX_ESCALATIONS) {
        this.escalations++;
        this.effortMultiplier *= 2;
        this.failuresAtTarget = 0;
        this.message =
          `${this.target} rectangles not reached yet; raising the effort ` +
          `(level ${this.escalations} of ${MAX_ESCALATIONS}).`;
      } else {
        this.conclude(
          `No arrangement of ${this.target} rectangles found within the search budget.`,
        );
      }
    }
  }

  /** Repairs, validates, and promotes the packing if it really is feasible. */
  private tryFinishAttempt(engine: PackingEngine, sweeps: number): boolean {
    if (engine.penalty > 0 && !engine.repair(sweeps)) return false;
    if (engine.penalty > 0) return false;
    if (!this.acceptIfValid(engine.snapshot())) return false;

    this.target = this.best.length + 1;
    this.failuresAtTarget = 0;
    this.escalations = 0;
    this.effortMultiplier = 1;
    this.bestPenaltyAtTarget = Infinity;
    this.engine = null;
    this.message = `Found ${this.best.length} rectangles. Now trying ${this.target}.`;
    return true;
  }

  /**
   * The single gate through which a packing becomes "the best found": it is
   * denormalised and re-checked from scratch by the independent validator.
   * Nothing the optimiser believes about itself is trusted here.
   */
  private acceptIfValid(normalised: RectanglePose[]): boolean {
    if (normalised.length <= this.best.length) return false;
    const world = this.denormalise(normalised);
    if (!validatePacking(world, this.problem).valid) return false;
    this.best = normalised.map((p) => ({ ...p }));
    return true;
  }

  private denormalise(poses: RectanglePose[]): RectanglePose[] {
    return poses.map((p) => ({
      x: p.x * this.scale,
      y: p.y * this.scale,
      angle: p.angle,
    }));
  }

  private conclude(message: string): void {
    this.phase = 'finished';
    this.message = message;
  }

  get state(): SearchState {
    const best = this.denormalise(this.best);
    return {
      phase: this.phase,
      best,
      bestCount: best.length,
      current: this.engine ? this.denormalise(this.engine.snapshot()) : best,
      target: this.target,
      areaUpperBound: this.areaBound,
      cappedAt: this.cappedAt,
      iterations: this.iterations,
      restarts: this.restarts,
      elapsedMs: this.elapsedMs,
      temperature: this.temperatureHint,
      bestPenalty: Number.isFinite(this.bestPenaltyAtTarget) ? this.bestPenaltyAtTarget : 0,
      density: calculatePackingDensity(best.length, this.problem),
      message: this.message,
    };
  }
}

/**
 * Convenience entry point for scripts and tests: runs the whole search to
 * completion synchronously.
 */
export function searchMaximumPacking(
  problem: PackingProblem,
  options: Partial<SearchOptions> = {},
): SearchState {
  const resolved: SearchOptions = {
    quality: options.quality ?? 'balanced',
    seed: options.seed ?? 1,
    maxRectangles: options.maxRectangles ?? DEFAULT_MAX_RECTANGLES,
    timeBudgetMs:
      options.timeBudgetMs ?? QUALITY_PRESETS[options.quality ?? 'balanced'].timeBudgetMs,
    maxIterations: options.maxIterations,
  };
  const search = new PackingSearch(problem, resolved);
  while (!search.finished) search.step(50);
  return search.state;
}

/** Feasible arrangement obtained without any stochastic search. */
export function optimizePacking(
  problem: PackingProblem,
  initialSolution: RectanglePose[],
  seed = 1,
): RectanglePose[] {
  const scale = problem.radius;
  const engine = new PackingEngine(
    initialSolution.map((p) => ({ x: p.x / scale, y: p.y / scale, angle: p.angle })),
    problem.rectangleWidth / scale,
    problem.rectangleHeight / scale,
    problem.rotationMode,
    createRng(seed),
  );
  engine.repair(400);
  return engine.snapshot().map((p) => ({ x: p.x * scale, y: p.y * scale, angle: p.angle }));
}
