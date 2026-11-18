import { useRef } from 'react';
import type { RotationMode, SearchQuality } from '../types/packing';
import type { FormValues } from '../utils/validation';
import { toDegrees, toRadians } from '../utils/math';

interface Props {
  form: FormValues;
  onChange: (patch: Partial<FormValues>) => void;
  onOptimize: () => void;
  onStop: () => void;
  onNewSeed: () => void;
  running: boolean;
  errors: string[];
  warnings: string[];
  editing: boolean;
  onToggleEditing: (value: boolean) => void;
  selectedAngle: number | null;
  onRotateSelected: (angle: number) => void;
  onResetManual: () => void;
  onExportJson: () => void;
  onExportSvg: () => void;
  onImport: (file: File) => void;
  canExport: boolean;
  showLive: boolean;
  onToggleLive: (value: boolean) => void;
}

const ROTATION_LABELS: Array<{ value: RotationMode; label: string; hint: string }> = [
  { value: 'fixed', label: 'Fixed orientation (0 deg)', hint: 'Every rectangle stays axis aligned.' },
  { value: 'orthogonal', label: '90 deg rotations', hint: 'Rectangles may be upright or on their side.' },
  { value: 'free', label: 'Free rotation', hint: 'Any angle in [0, 180). Slower, often denser near the rim.' },
];

const QUALITY_LABELS: Array<{ value: SearchQuality; label: string; hint: string }> = [
  { value: 'fast', label: 'Fast', hint: 'A few seconds, light search.' },
  { value: 'balanced', label: 'Balanced', hint: 'More restarts and iterations.' },
  { value: 'deep', label: 'Deep search', hint: 'Many restarts; runs for over a minute.' },
];

export function ParameterPanel(props: Props) {
  const fileRef = useRef<HTMLInputElement | null>(null);
  const {
    form, onChange, running, errors, warnings, editing, selectedAngle, canExport,
  } = props;

  const rotationHint = ROTATION_LABELS.find((r) => r.value === form.rotationMode)?.hint;
  const qualityHint = QUALITY_LABELS.find((q) => q.value === form.quality)?.hint;
  const blocked = errors.length > 0;

  return (
    <aside className="panel">
      <header className="panel-header">
        <h1>Circle packing</h1>
        <p>Fit as many identical rectangles as possible inside a circle.</p>
      </header>

      <section className="field-group">
        <label className="field">
          <span>Circle radius</span>
          <input
            type="number" min="0" step="any" value={form.radius} disabled={running}
            onChange={(e) => onChange({ radius: e.target.value })}
          />
        </label>

        <div className="field-row">
          <label className="field">
            <span>Rectangle width</span>
            <input
              type="number" min="0" step="any" value={form.width} disabled={running}
              onChange={(e) => onChange({ width: e.target.value })}
            />
          </label>
          <label className="field">
            <span>Rectangle height</span>
            <input
              type="number" min="0" step="any" value={form.height} disabled={running}
              onChange={(e) => onChange({ height: e.target.value })}
            />
          </label>
        </div>

        <label className="field">
          <span>Rotation</span>
          <select
            value={form.rotationMode}
            disabled={running}
            onChange={(e) => onChange({ rotationMode: e.target.value as RotationMode })}
          >
            {ROTATION_LABELS.map((option) => (
              <option key={option.value} value={option.value}>{option.label}</option>
            ))}
          </select>
          <small>{rotationHint}</small>
        </label>

        <label className="field">
          <span>Search quality</span>
          <select
            value={form.quality}
            disabled={running}
            onChange={(e) => onChange({ quality: e.target.value as SearchQuality })}
          >
            {QUALITY_LABELS.map((option) => (
              <option key={option.value} value={option.value}>{option.label}</option>
            ))}
          </select>
          <small>{qualityHint}</small>
        </label>

        <div className="field-row">
          <label className="field">
            <span>Random seed</span>
            <input
              type="number" value={form.seed} disabled={running}
              onChange={(e) => onChange({ seed: Number(e.target.value) || 0 })}
            />
          </label>
          <label className="field">
            <span>Max rectangles</span>
            <input
              type="number" min="1" step="1" value={form.maxRectangles} disabled={running}
              onChange={(e) => onChange({ maxRectangles: e.target.value })}
            />
          </label>
        </div>
        <button type="button" className="ghost" onClick={props.onNewSeed} disabled={running}>
          New random seed
        </button>
        <small>
          The seed fixes the search path. How far along that path a run gets still depends on the
          compute budget, so two runs on different machines can stop at different points.
        </small>
      </section>

      {errors.map((message) => (
        <p className="message error" key={message}>{message}</p>
      ))}
      {warnings.map((message) => (
        <p className="message warning" key={message}>{message}</p>
      ))}

      <section className="actions">
        <button
          type="button" className="primary"
          onClick={props.onOptimize} disabled={running || blocked}
        >
          {running ? 'Searching...' : 'Optimize'}
        </button>
        <button type="button" className="secondary" onClick={props.onStop} disabled={!running}>
          Stop
        </button>
      </section>

      <section className="field-group">
        <label className="toggle">
          <input
            type="checkbox" checked={props.showLive}
            onChange={(e) => props.onToggleLive(e.target.checked)}
          />
          <span>Watch the search live</span>
        </label>
        <small>
          Off shows only the best validated packing. On shows the arrangement the optimiser is
          currently working on, with conflicts highlighted.
        </small>

        <label className="toggle">
          <input
            type="checkbox" checked={editing} disabled={running || !canExport}
            onChange={(e) => props.onToggleEditing(e.target.checked)}
          />
          <span>Edit manually</span>
        </label>

        {editing && (
          <div className="edit-box">
            {selectedAngle === null ? (
              <small>Click a rectangle to select it.</small>
            ) : (
              <label className="field">
                <span>Angle: {toDegrees(selectedAngle).toFixed(1)} deg</span>
                <input
                  type="range" min={0} max={180} step={0.1}
                  value={toDegrees(selectedAngle)}
                  onChange={(e) => props.onRotateSelected(toRadians(Number(e.target.value)))}
                />
              </label>
            )}
            <button type="button" className="ghost" onClick={props.onResetManual}>
              Discard manual changes
            </button>
          </div>
        )}
      </section>

      <section className="field-group">
        <h2>Save and load</h2>
        <div className="button-row">
          <button type="button" className="ghost" onClick={props.onExportJson} disabled={!canExport}>
            Export JSON
          </button>
          <button type="button" className="ghost" onClick={props.onExportSvg} disabled={!canExport}>
            Export SVG
          </button>
        </div>
        <button type="button" className="ghost" onClick={() => fileRef.current?.click()}>
          Import JSON
        </button>
        <input
          ref={fileRef} type="file" accept="application/json" hidden
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) props.onImport(file);
            e.target.value = '';
          }}
        />
      </section>
    </aside>
  );
}
