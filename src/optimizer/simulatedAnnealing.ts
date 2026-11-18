import type { RectanglePose, RotationMode } from '../types/packing';
import { projectCentreIntoCircle } from '../geometry/circle';
import {
  CORNER_STRIDE,
  rectangleHalfDiagonal,
  writeRectangleCorners,
} from '../geometry/rectangle';
import { quadMinimumTranslation, quadPenetrationDepth } from '../geometry/sat';
import { SpatialGrid } from './spatialGrid';
import { allowedAngles } from './rotation';
import { normalizeAngle, type Rng } from '../utils/math';

/**
 * Clearance, in normalised units (circle radius = 1), that the repair pass
 * leaves between rectangles. It sits comfortably above the 1e-9 tolerance the
 * independent validator uses, so a repaired packing cannot be rejected by
 * floating point noise, and it is far too small to see.
 */
export const REPAIR_CLEARANCE = 1e-7;

/** Margin kept between a rectangle corner and the circle by the projection. */
const CONTAIN_MARGIN = 1e-9;

/** Annealing schedule values are refreshed this often, not every move. */
const SCHEDULE_REFRESH = 32;

export interface EngineState {
  xs: Float64Array;
  ys: Float64Array;
  angles: Float64Array;
  penalty: number;
}

/**
 * Optimisation engine for a *fixed* number of rectangles, working entirely in
 * normalised coordinates where the circle has radius 1.
 *
 * Design choice that matters: containment is a hard invariant, not a penalty.
 * Every pose passes through the circle projection, so no rectangle is ever
 * outside the circle, at any point, even mid-search. The cost function then
 * only has to deal with overlap, and `penalty === 0` is exactly equivalent to
 * a feasible packing.
 */
export class PackingEngine {
  readonly count: number;
  readonly width: number;
  readonly height: number;

  private readonly halfWidth: number;
  private readonly halfHeight: number;
  private readonly halfDiagonal: number;
  private readonly reachSquared: number;

  private readonly xs: Float64Array;
  private readonly ys: Float64Array;
  private readonly angles: Float64Array;
  /** Corner positions in world (normalised) space. */
  private readonly corners: Float64Array;
  /** Corner offsets relative to each centre; they depend only on the angle. */
  private readonly locals: Float64Array;

  private readonly grid: SpatialGrid;
  private readonly neighbours: Int32Array;
  private readonly mtv = new Float64Array(3);
  private readonly projection = new Float64Array(2);

  /** Indices that were overlapping at the last exact penalty evaluation. */
  private readonly overlapping: Int32Array;
  private overlappingCount = 0;

  private readonly rng: Rng;
  private readonly discreteAngles: number[] | null;

  /** Sum over all pairs of squared penetration depth. Zero means feasible. */
  penalty = 0;
  iterations = 0;

  constructor(
    poses: RectanglePose[],
    width: number,
    height: number,
    rotationMode: RotationMode,
    rng: Rng,
  ) {
    this.count = poses.length;
    this.width = width;
    this.height = height;
    this.halfWidth = width / 2;
    this.halfHeight = height / 2;
    this.halfDiagonal = rectangleHalfDiagonal(width, height);
    this.reachSquared = 4 * this.halfDiagonal * this.halfDiagonal;
    this.rng = rng;
    this.discreteAngles = allowedAngles(rotationMode, width, height);

    const size = Math.max(1, this.count);
    this.xs = new Float64Array(size);
    this.ys = new Float64Array(size);
    this.angles = new Float64Array(size);
    this.corners = new Float64Array(size * CORNER_STRIDE);
    this.locals = new Float64Array(size * CORNER_STRIDE);
    this.neighbours = new Int32Array(size);
    this.overlapping = new Int32Array(size);

    this.grid = new SpatialGrid(size, 1.2, 2 * this.halfDiagonal);
    for (let i = 0; i < this.count; i++) {
      const pose = poses[i];
      this.angles[i] = pose.angle;
      this.writeLocals(i, pose.angle);
      this.applyCentre(i, pose.x, pose.y);
      this.grid.insert(i, this.xs[i], this.ys[i]);
    }
    this.penalty = this.totalPenalty();
  }

  private writeLocals(i: number, angle: number): void {
    writeRectangleCorners(
      0, 0, angle, this.halfWidth, this.halfHeight, this.locals, i * CORNER_STRIDE,
    );
  }

  /** Projects the centre into the circle and refreshes the world corners. */
  private applyCentre(i: number, x: number, y: number): void {
    const offset = i * CORNER_STRIDE;
    projectCentreIntoCircle(x, y, this.locals, offset, 1, CONTAIN_MARGIN, this.projection);
    const cx = this.projection[0];
    const cy = this.projection[1];
    this.xs[i] = cx;
    this.ys[i] = cy;
    for (let k = 0; k < CORNER_STRIDE; k += 2) {
      this.corners[offset + k] = cx + this.locals[offset + k];
      this.corners[offset + k + 1] = cy + this.locals[offset + k + 1];
    }
  }

  /**
   * Moves rectangle `i`, keeping it inside the circle and the grid in sync.
   * The angle check is what keeps translations free of trigonometry.
   */
  private setPose(i: number, x: number, y: number, angle: number): void {
    if (angle !== this.angles[i]) {
      this.angles[i] = angle;
      this.writeLocals(i, angle);
    }
    this.applyCentre(i, x, y);
    this.grid.move(i, this.xs[i], this.ys[i]);
  }

  /** Squared penetration of rectangle `i` against everything around it. */
  private localPenalty(i: number): number {
    const x = this.xs[i];
    const y = this.ys[i];
    const found = this.grid.query(x, y, i, this.neighbours);

    let total = 0;
    for (let k = 0; k < found; k++) {
      const j = this.neighbours[k];
      const dx = x - this.xs[j];
      const dy = y - this.ys[j];
      if (dx * dx + dy * dy >= this.reachSquared) continue;
      const depth = quadPenetrationDepth(
        this.corners, i * CORNER_STRIDE,
        this.corners, j * CORNER_STRIDE,
      );
      if (depth > 0) total += depth * depth;
    }
    return total;
  }

  /**
   * Exact total penalty. It doubles as the refresh point for the list of
   * conflicting rectangles that biases move selection, which is why the
   * annealing loop calls it at the end of every chunk.
   */
  totalPenalty(): number {
    let total = 0;
    this.overlappingCount = 0;
    for (let i = 0; i < this.count; i++) {
      const local = this.localPenalty(i);
      if (local > 0) this.overlapping[this.overlappingCount++] = i;
      total += local;
    }
    return total / 2; // every pair was counted from both sides
  }

  /**
   * One Gauss-Seidel relaxation sweep: each overlapping pair is pushed apart
   * along its minimum translation axis, then both rectangles are projected
   * back into the circle. `margin` makes the push overshoot slightly, which is
   * what allows the penalty to reach exactly zero instead of merely tending
   * towards it.
   */
  relaxSweep(margin: number): boolean {
    let moved = false;

    for (let i = 0; i < this.count; i++) {
      const found = this.grid.query(this.xs[i], this.ys[i], i, this.neighbours);
      for (let k = 0; k < found; k++) {
        const j = this.neighbours[k];
        const dx = this.xs[i] - this.xs[j];
        const dy = this.ys[i] - this.ys[j];
        if (dx * dx + dy * dy >= this.reachSquared) continue;

        quadMinimumTranslation(
          this.corners, i * CORNER_STRIDE,
          this.corners, j * CORNER_STRIDE,
          this.mtv,
        );
        const depth = this.mtv[2];
        if (depth <= 0) continue;

        const push = depth / 2 + margin;
        this.setPose(i, this.xs[i] + this.mtv[0] * push, this.ys[i] + this.mtv[1] * push, this.angles[i]);
        this.setPose(j, this.xs[j] - this.mtv[0] * push, this.ys[j] - this.mtv[1] * push, this.angles[j]);
        moved = true;
      }
    }

    // Nothing moved means no pair had a positive depth, which is exactly the
    // definition of a feasible configuration -- no need to recompute.
    if (moved) {
      this.penalty = this.totalPenalty();
    } else {
      this.penalty = 0;
      this.overlappingCount = 0;
    }
    return moved;
  }

  relax(sweeps: number, margin: number): void {
    for (let s = 0; s < sweeps; s++) {
      if (!this.relaxSweep(margin)) return;
    }
  }

  /**
   * Drives the configuration to a strictly feasible one if it is close enough.
   * Returns true only when the penalty is exactly zero, i.e. no pair overlaps
   * at all -- contacts are fine, interpenetration is not.
   */
  repair(maxSweeps = 400): boolean {
    this.penalty = this.totalPenalty();
    for (let s = 0; s < maxSweeps && this.penalty > 0; s++) {
      this.relaxSweep(REPAIR_CLEARANCE);
    }
    return this.penalty === 0;
  }

  private proposeAngle(current: number, scale: number): number {
    if (this.discreteAngles) {
      if (this.discreteAngles.length < 2) return current;
      return this.discreteAngles[this.rng.int(this.discreteAngles.length)];
    }

    const roll = this.rng.next();
    if (roll < 0.08) return this.rng.next() * Math.PI;
    // Copying another rectangle's angle lets free rotation rediscover the
    // aligned, crystalline arrangements that a continuous random walk keeps
    // breaking apart -- without ever forbidding an asymmetric solution.
    if (roll < 0.22) return this.angles[this.rng.int(this.count)];
    return normalizeAngle(current + this.rng.normal() * scale);
  }

  /**
   * Move selection, biased towards rectangles that were conflicting at the
   * last exact evaluation. The list is free -- `totalPenalty` builds it as a
   * side effect -- so the bias costs nothing per move.
   */
  private pickIndex(): number {
    if (this.overlappingCount > 0 && this.rng.next() < 0.4) {
      return this.overlapping[this.rng.int(this.overlappingCount)];
    }
    return this.rng.int(this.count);
  }

  /**
   * Simulated annealing over `iterations` moves. `progressFrom`/`progressTo`
   * position this chunk inside the overall cooling schedule so the caller can
   * run the search in small, interruptible slices.
   */
  anneal(iterations: number, progressFrom: number, progressTo: number): void {
    if (this.count < 2) {
      this.penalty = this.totalPenalty();
      return;
    }

    const unit = Math.min(this.width, this.height);
    const temperatureStart = 0.02 * unit * unit;
    const temperatureRatio = 1e-8 / 0.02;
    const stepStart = Math.min(1, Math.max(this.width, this.height));
    const stepRatio = 1e-3;
    const angleStart = Math.PI / 2;
    const angleRatio = 1e-3 / (Math.PI / 2);
    const canRotate = this.discreteAngles === null || this.discreteAngles.length > 1;
    const freeCentreRadius = Math.max(0, 1 - this.halfDiagonal);

    let temperature = temperatureStart;
    let step = stepStart;
    let angleStep = angleStart;

    for (let k = 0; k < iterations; k++) {
      if (k % SCHEDULE_REFRESH === 0) {
        const t = progressFrom + ((progressTo - progressFrom) * k) / Math.max(1, iterations);
        const decay = t < 0 ? 0 : t > 1 ? 1 : t;
        temperature = temperatureStart * Math.pow(temperatureRatio, decay);
        step = stepStart * Math.pow(stepRatio, decay);
        angleStep = angleStart * Math.pow(angleRatio, decay);
      }

      const i = this.pickIndex();
      const oldX = this.xs[i];
      const oldY = this.ys[i];
      const oldAngle = this.angles[i];
      const before = this.localPenalty(i);

      // Move sizes follow the 70 / 20 / 10 rule: mostly fine adjustments,
      // sometimes a real relocation to escape a local minimum.
      const magnitudeRoll = this.rng.next();
      let sigma: number;
      let teleport = false;
      if (magnitudeRoll < 0.7) {
        sigma = step * 0.2;
      } else if (magnitudeRoll < 0.9) {
        sigma = step;
      } else {
        sigma = step;
        teleport = this.rng.next() < 0.5;
      }

      let nextX: number;
      let nextY: number;
      let nextAngle = oldAngle;

      if (teleport) {
        const spot = this.rng.inDisk(freeCentreRadius);
        nextX = spot.x;
        nextY = spot.y;
        if (canRotate) nextAngle = this.proposeAngle(oldAngle, Math.PI);
      } else {
        const kindRoll = this.rng.next();
        const rotateOnly = canRotate && kindRoll < 0.2;
        const alsoRotate = canRotate && kindRoll >= 0.2 && kindRoll < 0.4;
        nextX = rotateOnly ? oldX : oldX + this.rng.normal() * sigma;
        nextY = rotateOnly ? oldY : oldY + this.rng.normal() * sigma;
        if (rotateOnly || alsoRotate) nextAngle = this.proposeAngle(oldAngle, angleStep);
      }

      this.setPose(i, nextX, nextY, nextAngle);
      const after = this.localPenalty(i);
      const delta = after - before;

      const accept =
        delta <= 0 || (temperature > 0 && this.rng.next() < Math.exp(-delta / temperature));

      if (accept) {
        this.penalty += delta;
        if (this.penalty < 0) this.penalty = 0;
      } else {
        this.setPose(i, oldX, oldY, oldAngle);
      }

      this.iterations++;
    }

    // Incremental bookkeeping drifts; resynchronise on the exact value.
    this.penalty = this.totalPenalty();
  }

  saveState(): EngineState {
    return {
      xs: this.xs.slice(0, this.count),
      ys: this.ys.slice(0, this.count),
      angles: this.angles.slice(0, this.count),
      penalty: this.penalty,
    };
  }

  loadState(state: EngineState): void {
    this.grid.clear();
    for (let i = 0; i < this.count; i++) {
      this.angles[i] = state.angles[i];
      this.writeLocals(i, state.angles[i]);
      this.applyCentre(i, state.xs[i], state.ys[i]);
      this.grid.insert(i, this.xs[i], this.ys[i]);
    }
    this.penalty = state.penalty;
  }

  snapshot(): RectanglePose[] {
    const poses: RectanglePose[] = new Array(this.count);
    for (let i = 0; i < this.count; i++) {
      poses[i] = { x: this.xs[i], y: this.ys[i], angle: this.angles[i] };
    }
    return poses;
  }
}
