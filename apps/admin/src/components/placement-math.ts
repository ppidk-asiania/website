import type { UploadPlacement } from "@website/domain/documents";

/** Pages shown on the placement screen; later pages stay reachable through the numeric fields. */
export const PAGE_LIMIT = 30;

export interface Box {
  xMm: number;
  yMm: number;
  wMm: number;
  hMm: number;
}
export interface PageMm {
  wMm: number;
  hMm: number;
}
export interface Limits {
  minW: number;
  maxW: number;
  minH: number;
  maxH: number;
  /** height / width, when the shape must not change */
  ratio?: number;
}
export type ItemKey =
  | { kind: "number"; index: number }
  | { kind: "qr" }
  | { kind: "secretary" }
  | { kind: "coordinator" };

const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max);
const tenth = (value: number) => Math.round(value * 10) / 10;

/** Signature boxes show the image at its width; 0.4 is a typical signature's height/width. */
const SIGNATURE_WIDTH = 40;
const SIGNATURE_RATIO = 0.4;

export function dragBox(box: Box, dxPx: number, dyPx: number, pxPerMm: number, page: PageMm): Box {
  return {
    ...box,
    xMm: tenth(clamp(box.xMm + dxPx / pxPerMm, 0, page.wMm - box.wMm)),
    yMm: tenth(clamp(box.yMm + dyPx / pxPerMm, 0, page.hMm - box.hMm)),
  };
}

export function resizeBox(
  box: Box,
  dxPx: number,
  dyPx: number,
  pxPerMm: number,
  page: PageMm,
  limits: Limits,
): Box {
  const wMm = tenth(
    clamp(box.wMm + dxPx / pxPerMm, limits.minW, Math.min(limits.maxW, page.wMm - box.xMm)),
  );
  const hMm = limits.ratio
    ? tenth(wMm * limits.ratio)
    : tenth(
        clamp(box.hMm + dyPx / pxPerMm, limits.minH, Math.min(limits.maxH, page.hMm - box.yMm)),
      );
  return { ...box, wMm, hMm };
}

export function boxOf(placement: UploadPlacement, key: ItemKey): Box | null {
  if (key.kind === "number") {
    const n = placement.numbers[key.index];
    return n ? { xMm: n.xMm, yMm: n.yMm, wMm: n.wMm, hMm: n.hMm } : null;
  }
  if (key.kind === "qr") {
    const q = placement.qr;
    return q ? { xMm: q.xMm, yMm: q.yMm, wMm: q.sizeMm, hMm: q.sizeMm } : null;
  }
  const s = placement[key.kind];
  if (!s) return null;
  const wMm = s.wMm ?? SIGNATURE_WIDTH;
  return { xMm: s.xMm, yMm: s.yMm, wMm, hMm: tenth(wMm * SIGNATURE_RATIO) };
}

export function withBox(placement: UploadPlacement, key: ItemKey, box: Box): UploadPlacement {
  if (key.kind === "number") {
    return {
      ...placement,
      numbers: placement.numbers.map((n, i) => (i === key.index ? { page: n.page, ...box } : n)),
    };
  }
  if (key.kind === "qr") {
    const q = placement.qr;
    return q
      ? { ...placement, qr: { page: q.page, xMm: box.xMm, yMm: box.yMm, sizeMm: box.wMm } }
      : placement;
  }
  const s = placement[key.kind];
  return s
    ? { ...placement, [key.kind]: { ...s, xMm: box.xMm, yMm: box.yMm, wMm: box.wMm } }
    : placement;
}

export function itemsOnPage(
  placement: UploadPlacement,
  page: number,
): { key: ItemKey; box: Box }[] {
  const keys: ItemKey[] = [
    ...placement.numbers.map((_, index): ItemKey => ({ kind: "number", index })),
    { kind: "qr" },
    { kind: "secretary" },
    { kind: "coordinator" },
  ];
  return keys.flatMap((key) => {
    const box = boxOf(placement, key);
    const onPage =
      key.kind === "number" ? placement.numbers[key.index]?.page : placement[key.kind]?.page;
    return box && onPage === page ? [{ key, box }] : [];
  });
}
