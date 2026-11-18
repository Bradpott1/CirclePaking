# Circle Rectangle Packing

Interactive solver that looks for the largest number of **identical rectangles**
that fit inside a **circle**, with no overlap and no part sticking out.
Contacts (edge to edge, corner to edge, corner to corner, rectangle against the
circle) are allowed; interpenetration is not.

```bash
npm install
npm run dev      # http://localhost:5173
npm test         # geometry + optimiser unit tests (67 tests)
npm run build    # type-check and production build
npm run bench    # packing quality across a few reference problems
```

---

## What the app does

* Enter a circle radius `R`, a rectangle width `W` and height `H`.
* Pick a rotation mode: **fixed (0 deg)**, **90 deg rotations**, or **free rotation**.
* Pick a search quality: **Fast**, **Balanced**, **Deep search**.
* Press **Optimize**. The search runs in a Web Worker; the interface stays
  responsive and the visualisation updates while the algorithm works.
* **Stop** interrupts at any point and keeps the best packing found so far.

Results can be exported as JSON or SVG, re-imported, and edited by hand.

## Honest reporting

The app always says **"Best packing found: N"**, never "maximum = N".

Failing to place `N + 1` rectangles is not a mathematical proof that `N + 1` is
impossible — it only means this heuristic did not find an arrangement within its
budget. The interface therefore shows the area upper bound
`floor(pi R^2 / (W H))` alongside the result and states that the true optimum
lies somewhere in between. The single exception: if the packing found equals the
area bound, that *is* a proof of optimality, and the app says so.

---

## Architecture

```
src/
  geometry/
    rectangle.ts     corner computation (flat-buffer and object forms)
    circle.ts        containment tests, overflow, projection into the disk
    sat.ts           Separating Axis Theorem: penetration depth and MTV
    collision.ts     broad phase, strict validation, density, area bound
  optimizer/
    rotation.ts             which angles each rotation mode permits
    gridInitialization.ts   row / staggered-row constructive layouts
    ringInitialization.ts   concentric rings that follow the circle's rim
    randomInitialization.ts random starts, perturbation, insertion heuristic
    spatialGrid.ts          uniform grid broad phase for the inner loop
    simulatedAnnealing.ts   the optimisation engine for a fixed N
    packingOptimizer.ts     the N search: multi-start, incremental, sliced
  workers/optimizer.worker.ts
  components/       ParameterPanel, PackingCanvas, StatsPanel, ProgressPanel
  hooks/useOptimizer.ts
  types/packing.ts
  utils/            math (seeded RNG, angles), validation, exporters
tests/              geometry.test.ts, optimizer.test.ts
```

### Geometric core

A rectangle is a pose `(x, y, theta)` plus the shared `W` and `H`. Corners come
from the standard rotation

```
X = x + dx*cos(theta) - dy*sin(theta)
Y = y + dx*sin(theta) + dy*cos(theta)
```

**Containment.** A disk is convex, so a rectangle is inside it exactly when its
four corners are: `X^2 + Y^2 <= R^2 + eps`.

**Overlap.** Pairs are tested with the Separating Axis Theorem over the four
edge normals. `quadPenetrationDepth` returns the penetration depth along the
minimum translation axis: strictly positive means the interiors intersect,
zero or negative means disjoint or exactly touching. Contact is therefore
legal by construction, and `quadMinimumTranslation` additionally returns the
direction, which the relaxation step uses to push overlapping pairs apart.

**Tolerance.** `EPSILON = 1e-9`, scaled by the radius for world-unit tests, so a
gap of `1e-12` is never mistaken for an overlap.

### Two decisions that shape the optimiser

**1. Containment is a hard invariant, not a penalty.** Every pose written by the
engine goes through `projectIntoCircle`, which slides the centre towards the
origin until the worst corner is inside. Consequently no rectangle is ever
outside the circle — not even mid-search, not even in the live view — and the
cost function only has to deal with overlap:

```
cost = sum over pairs of penetrationDepth^2
```

`cost === 0` is then *exactly equivalent* to a feasible packing. (The
penalty-based containment term still exists in `geometry/circle.ts` —
`containmentPenalty` — for the general cost formulation and for tests.)

**2. Relaxation closes the last gap.** Annealing alone converges towards zero
cost without reaching it. A Gauss-Seidel relaxation sweep pushes each
overlapping pair apart along its MTV with a small overshoot
(`REPAIR_CLEARANCE = 1e-7` in normalised units) and re-projects into the circle.
That overshoot is what turns "almost feasible" into exactly zero penalty, and it
stays far below anything visible while sitting safely above the validation
tolerance.

### Search strategy

Everything is normalised to `R = 1` (`w = W/R`, `h = H/R`) so the optimiser sees
the same numeric scale for every problem, then converted back at the end.

1. **Upper bound** `floor(pi R^2 / (W H))` is computed and displayed.
2. **Constructive starts.** Row packings — each horizontal band is filled
   independently and centred on its own chord, which beats a rigid lattice —
   scanned over row offsets, stagger factors and every permitted orientation;
   plus concentric rings for free rotation, where rectangles follow the rim and
   the leftover central disk is filled recursively.
3. **Incremental growth.** With a validated packing of `N`, the search targets
   `N + 1`: the extra rectangle is dropped into the least conflicting spot found
   by sampling, and then **every** rectangle is free to move — the existing ones
   are never frozen, which is what allows a global reorganisation.
4. **Simulated annealing** over `(x, y, theta)` with geometric cooling. Move
   sizes follow a 70 / 20 / 10 split (small, medium, relocation) and shrink with
   temperature, so the run ends by fine-tuning contacts. Rectangle choice is a
   tournament biased towards the ones that overlap most. Relaxation sweeps are
   interleaved, making it a memetic rather than a pure random search.
5. **Multi-start.** Each target gets many independent restarts, seeded from the
   current best, from perturbed grids and rings, or from pure noise. The best
   state is kept separately from the current state and never lost.
6. **Validation gate.** A candidate is promoted to "best" only after
   `validatePacking` re-checks it from scratch: all four corners of every
   rectangle against the circle, and every pair under SAT. Nothing the optimiser
   believes about itself is trusted.

### Staying alive in a background tab

The worker advances the search in ~40 ms slices and yields between them, which
is what lets a `stop` message get through. The yield goes through a
`MessageChannel` rather than `setTimeout(0)`: browsers clamp timers to roughly
one second once a tab stops being visible, which quietly reduced the search to
a few percent of its throughput whenever the user looked away. A channel
message is an ordinary task, not a timer, so it is not throttled — and it still
returns to the event loop between slices.

### Performance

A uniform spatial grid sized to the rectangles' bounding-circle diameter reduces
pair testing to a 3x3 block query — exhaustive, not approximate. Moves are
evaluated incrementally (only the moved rectangle's interactions are recomputed),
and the exact total penalty is resynchronised periodically to avoid drift.

`Max rectangles` (default 400) caps the search so that a very small rectangle
cannot make the interface crawl; the app warns when the area bound exceeds it.

### Reproducibility

The search is driven by a seeded `mulberry32` generator, and the trajectory is
deterministic: the same radius, dimensions, mode and seed explore exactly the
same sequence of configurations. **New random seed** draws a fresh one.

One honest caveat. The quality presets are *wall-clock* budgets, so how far
along that deterministic path a run gets depends on the machine and on what
else it is doing — two runs of the same seed can stop at different points.
For a run that is reproducible move for move, pass an iteration budget instead:

```ts
searchMaximumPacking(problem, { seed: 777, maxIterations: 80_000 });
```

That is the level at which the test suite asserts determinism.

---

## Interaction

* Scroll to zoom, drag to pan.
* Hover a rectangle for `#index`, `x`, `y` and angle in degrees.
* **Watch the search live** toggles between the best validated packing and the
  arrangement currently being optimised, where conflicts are drawn in red.
* **Edit manually** lets you drag a rectangle, and rotate the selected one with
  the slider or the left/right arrow keys (hold shift for 15 deg steps).
  Invalid placements are highlighted immediately and reported below the stats.

## Possible extensions

The geometry and the optimiser are separate from the UI, and the search is a
stepper driven by `step(sliceMs)`, so stronger methods can be added without
touching the rest: nonlinear programming on the contact constraints,
branch-and-bound with interval arithmetic for genuine optimality proofs, or
constraint programming on discretised positions.
