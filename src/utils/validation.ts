import type { PackingProblem, RotationMode, SearchQuality } from '../types/packing';
import { areaUpperBound } from '../geometry/collision';
import { rectangleFitsInCircle } from '../geometry/circle';
import { rectangleHalfDiagonal } from '../geometry/rectangle';

export interface FormValues {
  radius: string;
  width: string;
  height: string;
  rotationMode: RotationMode;
  quality: SearchQuality;
  seed: number;
  maxRectangles: string;
}

export interface FormCheck {
  problem: PackingProblem | null;
  maxRectangles: number;
  errors: string[];
  warnings: string[];
}

function parsePositive(raw: string, label: string, errors: string[]): number | null {
  const trimmed = raw.trim();
  if (trimmed === '') {
    errors.push(`${label} is required.`);
    return null;
  }
  const value = Number(trimmed);
  if (!Number.isFinite(value)) {
    errors.push(`${label} must be a finite number.`);
    return null;
  }
  if (value <= 0) {
    errors.push(`${label} must be strictly greater than 0.`);
    return null;
  }
  return value;
}

/** Rejects R <= 0, W <= 0, H <= 0, NaN and infinities before anything runs. */
export function checkForm(form: FormValues): FormCheck {
  const errors: string[] = [];
  const warnings: string[] = [];

  const radius = parsePositive(form.radius, 'Circle radius', errors);
  const width = parsePositive(form.width, 'Rectangle width', errors);
  const height = parsePositive(form.height, 'Rectangle height', errors);

  let maxRectangles = Number(form.maxRectangles);
  if (!Number.isFinite(maxRectangles) || maxRectangles < 1) {
    errors.push('Maximum rectangles must be a positive integer.');
    maxRectangles = 1;
  }
  maxRectangles = Math.floor(maxRectangles);

  if (radius === null || width === null || height === null) {
    return { problem: null, maxRectangles, errors, warnings };
  }

  const problem: PackingProblem = {
    radius,
    rectangleWidth: width,
    rectangleHeight: height,
    rotationMode: form.rotationMode,
  };

  if (!rectangleFitsInCircle(width, height, radius)) {
    warnings.push(
      `A single ${width} x ${height} rectangle does not fit: its half diagonal is ` +
        `${rectangleHalfDiagonal(width, height).toFixed(4)}, larger than the radius ${radius}. ` +
        'The answer is 0 rectangles.',
    );
  }

  const bound = areaUpperBound(problem);
  if (bound > maxRectangles) {
    warnings.push(
      `The area bound allows up to ${bound} rectangles, above the ceiling of ${maxRectangles}. ` +
        'The search will stop at the ceiling; raise it if you have time to spare.',
    );
  }
  if (bound > 2000) {
    warnings.push('The rectangle is very small compared with the circle; expect a slow search.');
  }

  return { problem, maxRectangles, errors, warnings };
}
