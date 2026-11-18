/**
 * Uniform grid used as the broad phase during optimisation.
 *
 * Cell size is set to the rectangles' bounding-circle diameter, so any two
 * rectangles that could possibly intersect live in the same cell or in
 * neighbouring ones -- a 3x3 block query is therefore exhaustive, never
 * approximate.
 *
 * Membership is maintained incrementally (swap-remove + push), because the
 * optimiser moves one rectangle at a time and cannot afford a rebuild.
 */
export class SpatialGrid {
  private readonly cols: number;
  private readonly cellSize: number;
  private readonly extent: number;
  private readonly cells: number[][];
  private readonly cellOf: Int32Array;
  private readonly slotOf: Int32Array;

  constructor(capacity: number, extent: number, cellSize: number) {
    this.extent = extent;
    this.cellSize = Math.max(cellSize, 1e-6);
    this.cols = Math.max(1, Math.ceil((2 * extent) / this.cellSize));
    this.cells = new Array(this.cols * this.cols);
    for (let i = 0; i < this.cells.length; i++) this.cells[i] = [];
    this.cellOf = new Int32Array(capacity).fill(-1);
    this.slotOf = new Int32Array(capacity).fill(-1);
  }

  private indexOf(x: number, y: number): number {
    const cx = Math.min(
      this.cols - 1,
      Math.max(0, Math.floor((x + this.extent) / this.cellSize)),
    );
    const cy = Math.min(
      this.cols - 1,
      Math.max(0, Math.floor((y + this.extent) / this.cellSize)),
    );
    return cy * this.cols + cx;
  }

  clear(): void {
    for (const cell of this.cells) cell.length = 0;
    this.cellOf.fill(-1);
    this.slotOf.fill(-1);
  }

  insert(item: number, x: number, y: number): void {
    const cell = this.indexOf(x, y);
    const bucket = this.cells[cell];
    this.cellOf[item] = cell;
    this.slotOf[item] = bucket.length;
    bucket.push(item);
  }

  private remove(item: number): void {
    const cell = this.cellOf[item];
    if (cell < 0) return;
    const bucket = this.cells[cell];
    const slot = this.slotOf[item];
    const last = bucket[bucket.length - 1];
    bucket[slot] = last;
    this.slotOf[last] = slot;
    bucket.pop();
    this.cellOf[item] = -1;
    this.slotOf[item] = -1;
  }

  move(item: number, x: number, y: number): void {
    const cell = this.indexOf(x, y);
    if (cell === this.cellOf[item]) return;
    this.remove(item);
    const bucket = this.cells[cell];
    this.cellOf[item] = cell;
    this.slotOf[item] = bucket.length;
    bucket.push(item);
  }

  /**
   * Fills `out` with every item stored in the 3x3 block around (x, y),
   * excluding `self`, and returns how many were written.
   */
  query(x: number, y: number, self: number, out: Int32Array): number {
    const cx = Math.min(
      this.cols - 1,
      Math.max(0, Math.floor((x + this.extent) / this.cellSize)),
    );
    const cy = Math.min(
      this.cols - 1,
      Math.max(0, Math.floor((y + this.extent) / this.cellSize)),
    );

    let count = 0;
    const yStart = Math.max(0, cy - 1);
    const yEnd = Math.min(this.cols - 1, cy + 1);
    const xStart = Math.max(0, cx - 1);
    const xEnd = Math.min(this.cols - 1, cx + 1);

    for (let gy = yStart; gy <= yEnd; gy++) {
      const rowBase = gy * this.cols;
      for (let gx = xStart; gx <= xEnd; gx++) {
        const bucket = this.cells[rowBase + gx];
        for (let k = 0; k < bucket.length; k++) {
          const item = bucket[k];
          if (item !== self) out[count++] = item;
        }
      }
    }
    return count;
  }
}
