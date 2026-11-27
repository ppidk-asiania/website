import { COUNTRIES, MAP_BOUNDS, MAP_FOCUS } from "./map-countries";

export interface MapView {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

function keepOverMap(view: MapView): MapView {
  const cx = clamp(view.x + view.w / 2, MAP_BOUNDS.x, MAP_BOUNDS.x + MAP_BOUNDS.w);
  const cy = clamp(view.y + view.h / 2, MAP_BOUNDS.y, MAP_BOUNDS.y + MAP_BOUNDS.h);
  return { ...view, x: cx - view.w / 2, y: cy - view.h / 2 };
}

export function zoomView(view: MapView, factor: number, px: number, py: number): MapView {
  const w = clamp(view.w / factor, Math.min(MAP_FOCUS.w / 8, view.w), MAP_FOCUS.w);
  const scale = w / view.w;
  return keepOverMap({
    x: px - (px - view.x) * scale,
    y: py - (py - view.y) * scale,
    w,
    h: (w * MAP_FOCUS.h) / MAP_FOCUS.w,
  });
}

export function panView(view: MapView, dx: number, dy: number): MapView {
  return keepOverMap({ ...view, x: view.x + dx, y: view.y + dy });
}

export function fitView(box: { x: number; y: number; width: number; height: number }): MapView {
  const fill = Math.max(box.width, (box.height * MAP_FOCUS.w) / MAP_FOCUS.h) / 0.7;
  const w = Math.min(fill, MAP_FOCUS.w);
  const h = (w * MAP_FOCUS.h) / MAP_FOCUS.w;
  return keepOverMap({ x: box.x + box.width / 2 - w / 2, y: box.y + box.height / 2 - h / 2, w, h });
}

export function countryBox(
  code: string,
): { x: number; y: number; width: number; height: number } | null {
  const d = COUNTRIES.find((c) => c.code === code)?.d;
  if (!d) return null;
  const points = [...d.matchAll(/(-?[\d.]+),(-?[\d.]+)/g)].map(([, x, y]) => [
    Number(x),
    Number(y),
  ]);
  const xs = points.map(([x]) => x as number);
  const ys = points.map(([, y]) => y as number);
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  return { x, y, width: Math.max(...xs) - x, height: Math.max(...ys) - y };
}

export function approachView(view: MapView, target: MapView, share: number): MapView {
  const mix = (a: number, b: number) => a + (b - a) * share;
  return {
    x: mix(view.x, target.x),
    y: mix(view.y, target.y),
    w: mix(view.w, target.w),
    h: mix(view.h, target.h),
  };
}
