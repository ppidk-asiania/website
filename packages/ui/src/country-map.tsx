"use client";

import { useEffect, useImperativeHandle, useRef, useState, type Ref } from "react";
import { COUNTRIES, MAP_FOCUS } from "./map-countries";
import { approachView, countryBox, fitView, panView, zoomView, type MapView } from "./map-view";

export interface CountryMapHandle {
  /** Zoom so the country fills 70% of the map. */
  fitTo(code: string): void;
}

const at = (view: MapView, rect: DOMRect, clientX: number, clientY: number) => ({
  x: view.x + ((clientX - rect.left) / rect.width) * view.w,
  y: view.y + ((clientY - rect.top) / rect.height) * view.h,
});

const area = (code: string) => {
  const box = countryBox(code);
  return box ? box.width * box.height : 0;
};
// Small countries last, so their padded hit area wins over a big neighbour's at sea.
const HIT_ORDER = [...COUNTRIES].sort((a, b) => area(b.code) - area(a.code));
const STEPS = 18;

const codeAt = (target: EventTarget) =>
  (target as Element).closest("[data-code]")?.getAttribute("data-code") ?? null;

const fitted = (code: string | null | undefined): MapView | null => {
  const box = code ? countryBox(code) : null;
  return box && fitView(box);
};

/** Draggable, zoomable map of the Asia–Oceania countries; a click chooses a country. */
export function CountryMap(props: {
  ref?: Ref<CountryMapHandle>;
  locale: string;
  labels: { map: string; zoomIn: string; zoomOut: string; reset: string };
  marked: readonly string[];
  selected: string | null;
  focus?: string | null;
  onSelect: (code: string) => void;
}) {
  const svgRef = useRef<SVGSVGElement>(null);
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const moved = useRef(0);
  const frame = useRef(0);
  const [view, setView] = useState<MapView>(() => fitted(props.focus) ?? MAP_FOCUS);
  const [hovered, setHovered] = useState<string | null>(null);
  const names = new Intl.DisplayNames([props.locale], { type: "region", fallback: "code" });

  const glideTo = (target: MapView | ((v: MapView) => MapView)) => {
    cancelAnimationFrame(frame.current);
    const goal = (v: MapView) => (typeof target === "function" ? target(v) : target);
    if (matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setView(goal);
      return;
    }
    let end: MapView | null = null;
    const step = (i: number) => {
      setView((v) => {
        end ??= goal(v);
        return i === STEPS ? end : approachView(v, end, 0.25);
      });
      if (i < STEPS) frame.current = requestAnimationFrame(() => step(i + 1));
    };
    step(1);
  };

  useImperativeHandle(props.ref, () => ({
    fitTo: (code) => {
      const target = fitted(code);
      if (target) glideTo(target);
    },
  }));

  useEffect(() => () => cancelAnimationFrame(frame.current), []);

  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      cancelAnimationFrame(frame.current);
      const rect = svg.getBoundingClientRect();
      setView((v) => {
        const p = at(v, rect, e.clientX, e.clientY);
        return zoomView(v, e.deltaY < 0 ? 1.2 : 1 / 1.2, p.x, p.y);
      });
    };
    svg.addEventListener("wheel", onWheel, { passive: false });
    return () => svg.removeEventListener("wheel", onWheel);
  }, []);

  const zoomCentre = (factor: number) =>
    glideTo((v) => zoomView(v, factor, v.x + v.w / 2, v.y + v.h / 2));

  const choose = (target: EventTarget) => {
    const code = codeAt(target);
    if (code) props.onSelect(code);
  };
  const outlined = COUNTRIES.find((c) => c.code === hovered);

  return (
    <div className="ui-map">
      <svg
        ref={svgRef}
        className="ui-map__svg"
        viewBox={`${view.x} ${view.y} ${view.w} ${view.h}`}
        role="group"
        aria-label={props.labels.map}
        onPointerOver={(e) => setHovered(codeAt(e.target))}
        onPointerLeave={() => setHovered(null)}
        onPointerDown={(e) => {
          cancelAnimationFrame(frame.current);
          if (pointers.current.size === 0) moved.current = 0;
          pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
        }}
        onPointerMove={(e) => {
          const last = pointers.current.get(e.pointerId);
          if (!last) return;
          const rect = e.currentTarget.getBoundingClientRect();
          const others = [...pointers.current].filter(([id]) => id !== e.pointerId);
          pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
          moved.current += Math.hypot(e.clientX - last.x, e.clientY - last.y);
          if (moved.current < 4) return;
          if (!e.currentTarget.hasPointerCapture(e.pointerId)) {
            e.currentTarget.setPointerCapture(e.pointerId);
          }
          const other = others[0]?.[1];
          if (other) {
            const factor =
              Math.hypot(e.clientX - other.x, e.clientY - other.y) /
              Math.hypot(last.x - other.x, last.y - other.y);
            setView((v) => {
              const p = at(v, rect, (e.clientX + other.x) / 2, (e.clientY + other.y) / 2);
              return zoomView(v, factor, p.x, p.y);
            });
          } else {
            const dx = e.clientX - last.x;
            const dy = e.clientY - last.y;
            setView((v) => panView(v, (-dx / rect.width) * v.w, (-dy / rect.height) * v.h));
          }
        }}
        onPointerUp={(e) => pointers.current.delete(e.pointerId)}
        onPointerCancel={(e) => pointers.current.delete(e.pointerId)}
        onClick={(e) => {
          if (moved.current < 4) choose(e.target);
        }}
        onKeyDown={(e) => {
          if (e.key !== "Enter" && e.key !== " ") return;
          e.preventDefault();
          choose(e.target);
        }}
      >
        <g aria-hidden="true">
          {HIT_ORDER.map((country) => (
            <path
              key={country.code}
              d={country.d}
              data-code={country.code}
              className="ui-map__hit"
            />
          ))}
        </g>
        {COUNTRIES.map((country) => (
          <path
            key={country.code}
            d={country.d}
            data-code={country.code}
            className={`ui-map__country${props.marked.includes(country.code) ? " ui-map__country--marked" : ""}`}
            role="button"
            tabIndex={0}
            aria-label={names.of(country.code)}
            aria-pressed={props.selected === country.code}
            data-hover={hovered === country.code || undefined}
          />
        ))}
        {outlined && <path d={outlined.d} className="ui-map__outline" aria-hidden="true" />}
      </svg>
      <div className="ui-map__controls">
        <button
          type="button"
          className="ui-map__control"
          aria-label={props.labels.zoomIn}
          onClick={() => zoomCentre(1.5)}
        >
          +
        </button>
        <button
          type="button"
          className="ui-map__control"
          aria-label={props.labels.zoomOut}
          onClick={() => zoomCentre(1 / 1.5)}
        >
          −
        </button>
        <button
          type="button"
          className="ui-map__control"
          aria-label={props.labels.reset}
          onClick={() => glideTo(MAP_FOCUS)}
        >
          ⟲
        </button>
      </div>
    </div>
  );
}
