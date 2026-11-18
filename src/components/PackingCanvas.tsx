import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { RectanglePose } from '../types/packing';
import { getRectangleCorners } from '../geometry/rectangle';
import { toDegrees } from '../utils/math';

interface View {
  cx: number;
  cy: number;
  /** Width of the visible world window, in problem units. */
  span: number;
}

interface Props {
  radius: number;
  width: number;
  height: number;
  rectangles: RectanglePose[];
  invalid: boolean[];
  editable: boolean;
  selected: number | null;
  onSelect: (index: number | null) => void;
  onMove: (index: number, x: number, y: number) => void;
  svgRef: React.MutableRefObject<SVGSVGElement | null>;
}

type Drag =
  | { kind: 'pan'; startX: number; startY: number; view: View }
  | { kind: 'rect'; index: number; grabX: number; grabY: number }
  | null;

/**
 * Scale-true SVG view of the packing.
 *
 * Everything is drawn from the solution's real coordinates: the circle keeps
 * its radius, rectangles keep their dimensions and angles, and nothing is
 * rescaled independently. Zooming only changes the viewBox, never the geometry.
 */
export function PackingCanvas({
  radius,
  width,
  height,
  rectangles,
  invalid,
  editable,
  selected,
  onSelect,
  onMove,
  svgRef,
}: Props) {
  const groupRef = useRef<SVGGElement | null>(null);
  const dragRef = useRef<Drag>(null);
  const [view, setView] = useState<View>({ cx: 0, cy: 0, span: radius * 2.3 });
  const [hovered, setHovered] = useState<number | null>(null);
  const [tooltip, setTooltip] = useState<{ x: number; y: number } | null>(null);

  useEffect(() => {
    setView({ cx: 0, cy: 0, span: radius * 2.3 });
  }, [radius]);

  const clientToWorld = useCallback((clientX: number, clientY: number) => {
    const group = groupRef.current;
    if (!group) return { x: 0, y: 0 };
    const ctm = group.getScreenCTM();
    if (!ctm) return { x: 0, y: 0 };
    const point = new DOMPoint(clientX, clientY).matrixTransform(ctm.inverse());
    return { x: point.x, y: point.y };
  }, []);

  /**
   * Wheel zoom uses a native, explicitly non-passive listener: React registers
   * its own wheel handlers as passive, where preventDefault() is ignored and
   * the page scrolls behind the canvas instead of zooming it.
   */
  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;

    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      const anchor = clientToWorld(event.clientX, event.clientY);
      setView((previous) => {
        const factor = Math.exp(event.deltaY * 0.0015);
        const span = Math.min(radius * 12, Math.max(radius * 0.02, previous.span * factor));
        const ratio = span / previous.span;
        return {
          span,
          cx: anchor.x + (previous.cx - anchor.x) * ratio,
          cy: anchor.y + (previous.cy - anchor.y) * ratio,
        };
      });
    };

    svg.addEventListener('wheel', onWheel, { passive: false });
    return () => svg.removeEventListener('wheel', onWheel);
  }, [clientToWorld, radius, svgRef]);

  const handlePointerDown = useCallback(
    (event: React.PointerEvent<SVGSVGElement>) => {
      const target = event.target as Element;
      const attribute = target.getAttribute?.('data-index');
      const index = attribute === null || attribute === undefined ? -1 : Number(attribute);

      if (editable && index >= 0) {
        const world = clientToWorld(event.clientX, event.clientY);
        const pose = rectangles[index];
        dragRef.current = {
          kind: 'rect',
          index,
          grabX: world.x - pose.x,
          grabY: world.y - pose.y,
        };
        onSelect(index);
      } else {
        if (editable) onSelect(null);
        dragRef.current = {
          kind: 'pan',
          startX: event.clientX,
          startY: event.clientY,
          view,
        };
      }
      // Capture keeps the drag alive past the element's bounds; it throws for
      // pointers the browser no longer tracks, which must not abort the drag.
      try {
        (event.currentTarget as SVGSVGElement).setPointerCapture(event.pointerId);
      } catch {
        /* capture is an optimisation, not a requirement */
      }
    },
    [clientToWorld, editable, onSelect, rectangles, view],
  );

  const handlePointerMove = useCallback(
    (event: React.PointerEvent<SVGSVGElement>) => {
      setTooltip({ x: event.clientX, y: event.clientY });
      const drag = dragRef.current;
      if (!drag) return;

      if (drag.kind === 'pan') {
        const rect = (event.currentTarget as SVGSVGElement).getBoundingClientRect();
        const unitsPerPixel = drag.view.span / Math.min(rect.width, rect.height);
        setView({
          span: drag.view.span,
          cx: drag.view.cx - (event.clientX - drag.startX) * unitsPerPixel,
          cy: drag.view.cy + (event.clientY - drag.startY) * unitsPerPixel,
        });
      } else {
        const world = clientToWorld(event.clientX, event.clientY);
        onMove(drag.index, world.x - drag.grabX, world.y - drag.grabY);
      }
    },
    [clientToWorld, onMove],
  );

  const endDrag = useCallback((event: React.PointerEvent<SVGSVGElement>) => {
    dragRef.current = null;
    const svg = event.currentTarget as SVGSVGElement;
    try {
      if (svg.hasPointerCapture(event.pointerId)) svg.releasePointerCapture(event.pointerId);
    } catch {
      /* the pointer is already gone */
    }
  }, []);

  const polygons = useMemo(
    () =>
      rectangles.map((pose) =>
        getRectangleCorners(pose, width, height)
          .map((corner) => `${corner.x.toFixed(6)},${corner.y.toFixed(6)}`)
          .join(' '),
      ),
    [rectangles, width, height],
  );

  const viewBox = `${view.cx - view.span / 2} ${-view.cy - view.span / 2} ${view.span} ${view.span}`;
  const hoveredPose = hovered !== null ? rectangles[hovered] : null;

  return (
    <div className="canvas-wrapper">
      <svg
        ref={svgRef}
        className={editable ? 'packing-svg editing' : 'packing-svg'}
        viewBox={viewBox}
        xmlns="http://www.w3.org/2000/svg"
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onPointerLeave={() => {
          setHovered(null);
          setTooltip(null);
        }}
      >
        <g ref={groupRef} transform="scale(1,-1)">
          {/* Strokes use non-scaling-stroke, so these widths are screen pixels
              and outlines stay crisp at every zoom level. */}
          <circle cx={0} cy={0} r={radius} className="boundary-circle" strokeWidth={1.6} />
          <line x1={-radius} y1={0} x2={radius} y2={0} className="axis" strokeWidth={1} />
          <line x1={0} y1={-radius} x2={0} y2={radius} className="axis" strokeWidth={1} />

          {polygons.map((points, index) => {
            const classes = ['rect'];
            if (invalid[index]) classes.push('invalid');
            if (selected === index) classes.push('selected');
            if (hovered === index) classes.push('hovered');
            return (
              <polygon
                key={index}
                data-index={index}
                points={points}
                className={classes.join(' ')}
                strokeWidth={selected === index ? 2 : 1}
                onPointerEnter={() => setHovered(index)}
              />
            );
          })}
        </g>
      </svg>

      {hoveredPose && tooltip && (
        <div
          className="tooltip"
          style={{ left: tooltip.x + 14, top: tooltip.y + 14, position: 'fixed' }}
        >
          <strong>Rectangle #{hovered}</strong>
          <span>x = {hoveredPose.x.toFixed(4)}</span>
          <span>y = {hoveredPose.y.toFixed(4)}</span>
          <span>angle = {toDegrees(hoveredPose.angle).toFixed(2)}&deg;</span>
          {invalid[hovered as number] && <span className="tooltip-error">invalid placement</span>}
        </div>
      )}

      <div className="canvas-hint">
        {editable
          ? 'Drag a rectangle to move it - use the rotation slider or the arrow keys once selected.'
          : 'Scroll to zoom, drag to pan, hover a rectangle for its pose.'}
      </div>
    </div>
  );
}
