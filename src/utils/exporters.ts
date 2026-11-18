import type { PackingProblem, RectanglePose } from '../types/packing';
import { calculatePackingDensity, validatePacking } from '../geometry/collision';

export interface PackingExport {
  radius: number;
  rectangle: { width: number; height: number };
  rotationMode: string;
  count: number;
  density: number;
  seed?: number;
  validated: boolean;
  placements: RectanglePose[];
}

export function buildExport(
  problem: PackingProblem,
  rectangles: RectanglePose[],
  seed?: number,
): PackingExport {
  return {
    radius: problem.radius,
    rectangle: { width: problem.rectangleWidth, height: problem.rectangleHeight },
    rotationMode: problem.rotationMode,
    count: rectangles.length,
    density: calculatePackingDensity(rectangles.length, problem),
    seed,
    validated: validatePacking(rectangles, problem).valid,
    placements: rectangles.map((r) => ({ x: r.x, y: r.y, angle: r.angle })),
  };
}

function triggerDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

export function downloadJson(data: PackingExport, filename: string): void {
  triggerDownload(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }), filename);
}

/** Serialises the live SVG node, so the export is exactly what is on screen. */
export function downloadSvg(svg: SVGSVGElement | null, filename: string): void {
  if (!svg) return;
  const clone = svg.cloneNode(true) as SVGSVGElement;
  clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
  clone.setAttribute('width', '1000');
  clone.setAttribute('height', '1000');

  const style = document.createElementNS('http://www.w3.org/2000/svg', 'style');
  style.textContent = `
    .boundary-circle { fill: #ffffff; stroke: #0f172a; }
    .axis { stroke: #cbd5e1; }
    .rect { fill: rgba(37, 99, 235, 0.35); stroke: #1d4ed8; }
    .rect.invalid { fill: rgba(220, 38, 38, 0.35); stroke: #b91c1c; }
  `;
  clone.insertBefore(style, clone.firstChild);

  const markup = new XMLSerializer().serializeToString(clone);
  triggerDownload(new Blob([markup], { type: 'image/svg+xml' }), filename);
}

export interface ImportResult {
  problem: PackingProblem;
  placements: RectanglePose[];
}

/** Parses an exported file back into a problem plus its placements. */
export function parseImport(text: string): ImportResult {
  const raw = JSON.parse(text) as Partial<PackingExport>;

  const radius = Number(raw.radius);
  const width = Number(raw.rectangle?.width);
  const height = Number(raw.rectangle?.height);
  if (![radius, width, height].every((v) => Number.isFinite(v) && v > 0)) {
    throw new Error('The file must contain a positive radius and rectangle dimensions.');
  }
  if (!Array.isArray(raw.placements)) {
    throw new Error('The file must contain a "placements" array.');
  }

  const placements = raw.placements.map((placement, index) => {
    const x = Number(placement?.x);
    const y = Number(placement?.y);
    const angle = Number(placement?.angle);
    if (![x, y, angle].every(Number.isFinite)) {
      throw new Error(`Placement ${index} has a non numeric x, y or angle.`);
    }
    return { x, y, angle };
  });

  const mode = raw.rotationMode;
  const rotationMode =
    mode === 'fixed' || mode === 'orthogonal' || mode === 'free' ? mode : 'free';

  return {
    problem: { radius, rectangleWidth: width, rectangleHeight: height, rotationMode },
    placements,
  };
}
