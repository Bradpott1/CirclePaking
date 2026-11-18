import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ParameterPanel } from './components/ParameterPanel';
import { PackingCanvas } from './components/PackingCanvas';
import { StatsPanel } from './components/StatsPanel';
import { ProgressPanel } from './components/ProgressPanel';
import { useOptimizer } from './hooks/useOptimizer';
import { validatePacking } from './geometry/collision';
import { QUALITY_PRESETS } from './optimizer/packingOptimizer';
import { buildExport, downloadJson, downloadSvg, parseImport } from './utils/exporters';
import { checkForm, type FormValues } from './utils/validation';
import { normalizeAngle, randomSeed, toRadians } from './utils/math';
import type { RectanglePose } from './types/packing';

const GEOMETRY_KEYS: Array<keyof FormValues> = ['radius', 'width', 'height', 'rotationMode'];

const INITIAL_FORM: FormValues = {
  radius: '10',
  width: '3',
  height: '2',
  rotationMode: 'free',
  quality: 'balanced',
  seed: 123456,
  maxRectangles: '400',
};

export default function App() {
  const [form, setForm] = useState<FormValues>(INITIAL_FORM);
  const [showLive, setShowLive] = useState(true);
  const [editing, setEditing] = useState(false);
  const [manual, setManual] = useState<RectanglePose[] | null>(null);
  const [selected, setSelected] = useState<number | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const svgRef = useRef<SVGSVGElement | null>(null);

  const { state, running, error, start, stop, setState } = useOptimizer();
  const check = useMemo(() => checkForm(form), [form]);

  const handleChange = useCallback(
    (patch: Partial<FormValues>) => {
      const touchesGeometry = GEOMETRY_KEYS.some((key) => key in patch);
      if (touchesGeometry) {
        // Results belong to the previous geometry; drop them rather than
        // showing a packing that no longer matches the circle on screen.
        setState(null);
        setManual(null);
        setEditing(false);
        setSelected(null);
        setNotice(null);
      }
      setForm((previous) => ({ ...previous, ...patch }));
    },
    [setState],
  );

  const handleOptimize = useCallback(() => {
    if (!check.problem) return;
    setManual(null);
    setEditing(false);
    setSelected(null);
    setNotice(null);
    start(check.problem, {
      quality: form.quality,
      seed: form.seed,
      maxRectangles: check.maxRectangles,
      timeBudgetMs: QUALITY_PRESETS[form.quality].timeBudgetMs,
    });
  }, [check.maxRectangles, check.problem, form.quality, form.seed, start]);

  const displayed = useMemo<RectanglePose[]>(() => {
    if (manual) return manual;
    if (!state) return [];
    return running && showLive ? state.current : state.best;
  }, [manual, running, showLive, state]);

  const report = useMemo(() => {
    if (!check.problem || displayed.length === 0) return null;
    return validatePacking(displayed, check.problem);
  }, [check.problem, displayed]);

  const invalid = useMemo(() => {
    const flags = new Array<boolean>(displayed.length).fill(false);
    if (!report) return flags;
    for (const index of report.outsideIndices) flags[index] = true;
    for (const [i, j] of report.overlappingPairs) {
      flags[i] = true;
      flags[j] = true;
    }
    return flags;
  }, [displayed.length, report]);

  const startEditing = useCallback(
    (value: boolean) => {
      setEditing(value);
      setSelected(null);
      if (value && !manual) setManual((state?.best ?? []).map((pose) => ({ ...pose })));
    },
    [manual, state],
  );

  const moveRectangle = useCallback((index: number, x: number, y: number) => {
    setManual((previous) => {
      if (!previous) return previous;
      const next = previous.slice();
      next[index] = { ...next[index], x, y };
      return next;
    });
  }, []);

  const rotateSelected = useCallback(
    (angle: number) => {
      if (selected === null) return;
      setManual((previous) => {
        if (!previous) return previous;
        const next = previous.slice();
        next[selected] = { ...next[selected], angle: normalizeAngle(angle) };
        return next;
      });
    },
    [selected],
  );

  // Arrow keys nudge the rotation of the selected rectangle while editing.
  useEffect(() => {
    if (!editing || selected === null) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
      event.preventDefault();
      const stepDegrees = (event.shiftKey ? 15 : 1) * (event.key === 'ArrowLeft' ? -1 : 1);
      setManual((previous) => {
        if (!previous) return previous;
        const next = previous.slice();
        next[selected] = {
          ...next[selected],
          angle: normalizeAngle(next[selected].angle + toRadians(stepDegrees)),
        };
        return next;
      });
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [editing, selected]);

  const handleImport = useCallback(async (file: File) => {
    try {
      const imported = parseImport(await file.text());
      setState(null);
      setEditing(false);
      setSelected(null);
      setForm((previous) => ({
        ...previous,
        radius: String(imported.problem.radius),
        width: String(imported.problem.rectangleWidth),
        height: String(imported.problem.rectangleHeight),
        rotationMode: imported.problem.rotationMode,
      }));
      setManual(imported.placements);
      const verdict = validatePacking(imported.placements, imported.problem);
      setNotice(
        verdict.valid
          ? `Imported ${imported.placements.length} rectangles; the packing is valid.`
          : `Imported ${imported.placements.length} rectangles, but the packing is NOT valid ` +
            `(${verdict.outsideIndices.length} outside, ${verdict.overlappingPairs.length} overlapping pairs).`,
      );
    } catch (importError) {
      setNotice(
        `Import failed: ${importError instanceof Error ? importError.message : String(importError)}`,
      );
    }
  }, [setState]);

  const selectedAngle =
    editing && selected !== null && manual?.[selected] ? manual[selected].angle : null;

  return (
    <div className="layout">
      <ParameterPanel
        form={form}
        onChange={handleChange}
        onOptimize={handleOptimize}
        onStop={stop}
        onNewSeed={() => handleChange({ seed: randomSeed() })}
        running={running}
        errors={check.errors}
        warnings={check.warnings}
        editing={editing}
        onToggleEditing={startEditing}
        selectedAngle={selectedAngle}
        onRotateSelected={rotateSelected}
        onResetManual={() => {
          setManual(null);
          setSelected(null);
          setEditing(false);
        }}
        onExportJson={() => {
          if (!check.problem) return;
          downloadJson(
            buildExport(check.problem, displayed, form.seed),
            `packing-${displayed.length}-rects.json`,
          );
        }}
        onExportSvg={() => downloadSvg(svgRef.current, `packing-${displayed.length}-rects.svg`)}
        onImport={handleImport}
        canExport={displayed.length > 0}
        showLive={showLive}
        onToggleLive={setShowLive}
      />

      <main className="main">
        {error && <p className="message error">{error}</p>}
        {notice && <p className="message info">{notice}</p>}

        <StatsPanel
          problem={check.problem}
          state={state}
          displayedCount={displayed.length}
          report={report}
          editing={editing}
        />
        <ProgressPanel state={state} running={running} />

        {check.problem ? (
          <PackingCanvas
            radius={check.problem.radius}
            width={check.problem.rectangleWidth}
            height={check.problem.rectangleHeight}
            rectangles={displayed}
            invalid={invalid}
            editable={editing}
            selected={selected}
            onSelect={setSelected}
            onMove={moveRectangle}
            svgRef={svgRef}
          />
        ) : (
          <div className="canvas-placeholder">
            Enter a valid radius, width and height to see the circle.
          </div>
        )}
      </main>
    </div>
  );
}
