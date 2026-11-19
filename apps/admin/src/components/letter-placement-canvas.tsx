"use client";

import { useEffect, useRef, useState, type PointerEvent } from "react";
import { Button } from "@/components/ui/button";
import type { UploadPlacement } from "@website/domain/documents";
import type { PDFDocumentProxy } from "pdfjs-dist";
import {
  boxOf,
  dragBox,
  itemsOnPage,
  PAGE_LIMIT,
  resizeBox,
  withBox,
  type ItemKey,
  type Limits,
  type PageMm,
} from "./placement-math";

const WIDTH_PX = 560;
const MM_PER_PT = 25.4 / 72;
const LIMITS: Record<ItemKey["kind"], Limits> = {
  number: { minW: 5, maxW: 210, minH: 3, maxH: 100 },
  qr: { minW: 15, maxW: 40, minH: 15, maxH: 40, ratio: 1 },
  secretary: { minW: 10, maxW: 120, minH: 4, maxH: 48, ratio: 0.4 },
  coordinator: { minW: 10, maxW: 120, minH: 4, maxH: 48, ratio: 0.4 },
};

export const sameKey = (a: ItemKey | null, b: ItemKey) =>
  a !== null &&
  a.kind === b.kind &&
  (a.kind !== "number" || (b.kind === "number" && a.index === b.index));

/**
 * One page of the uploaded PDF (pdf.js, in the browser) with the boxes on top. Dragging a box or
 * its corner handle edits the same millimetre values as the numeric fields below it.
 */
export function LetterPlacementCanvas(props: {
  url: string;
  placement: UploadPlacement;
  page: number;
  labels: Record<ItemKey["kind"], string>;
  selected: ItemKey | null;
  onSelect: (key: ItemKey) => void;
  onPage: (page: number) => void;
  onChange: (placement: UploadPlacement) => void;
}) {
  const { url, placement, page, labels, selected, onSelect, onPage, onChange } = props;
  const canvas = useRef<HTMLCanvasElement>(null);
  const [doc, setDoc] = useState<PDFDocumentProxy | null>(null);
  const [size, setSize] = useState<PageMm | null>(null);
  const [failed, setFailed] = useState(false);
  const drag = useRef<{
    key: ItemKey;
    mode: "move" | "size";
    x: number;
    y: number;
    box: NonNullable<ReturnType<typeof boxOf>>;
  } | null>(null);

  useEffect(() => {
    let task: { destroy: () => Promise<void> } | null = null;
    let live = true;
    void (async () => {
      try {
        const pdfjs = await import("pdfjs-dist");
        pdfjs.GlobalWorkerOptions.workerSrc = new URL(
          "pdfjs-dist/build/pdf.worker.min.mjs",
          import.meta.url,
        ).toString();
        const loading = pdfjs.getDocument({ url });
        task = loading;
        const loaded = await loading.promise;
        if (live) setDoc(loaded);
      } catch {
        if (live) setFailed(true);
      }
    })();
    return () => {
      live = false;
      void task?.destroy();
    };
  }, [url]);

  const pages = doc ? Math.min(doc.numPages, PAGE_LIMIT) : 0;
  useEffect(() => {
    if (!doc || !canvas.current) return;
    let task: { cancel: () => void } | null = null;
    void (async () => {
      const shown = await doc.getPage(Math.min(page, doc.numPages));
      const natural = shown.getViewport({ scale: 1 });
      const scale = WIDTH_PX / natural.width;
      const viewport = shown.getViewport({ scale: scale * window.devicePixelRatio });
      const target = canvas.current;
      if (!target) return;
      target.width = viewport.width;
      target.height = viewport.height;
      setSize({ wMm: natural.width * MM_PER_PT, hMm: natural.height * MM_PER_PT });
      const render = shown.render({ canvas: target, viewport });
      task = render;
      await render.promise.catch(() => undefined);
    })();
    return () => task?.cancel();
  }, [doc, page]);

  if (failed)
    return (
      <p className="admin-card__subtitle">
        The page preview could not be loaded: use the fields below.
      </p>
    );
  const pxPerMm = size ? WIDTH_PX / size.wMm : 1;

  const start = (event: PointerEvent, key: ItemKey, mode: "move" | "size") => {
    const box = boxOf(placement, key);
    if (!box) return;
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    onSelect(key);
    drag.current = { key, mode, x: event.clientX, y: event.clientY, box };
  };
  const move = (event: PointerEvent) => {
    const d = drag.current;
    if (!d || !size) return;
    const dx = event.clientX - d.x;
    const dy = event.clientY - d.y;
    const box =
      d.mode === "move"
        ? dragBox(d.box, dx, dy, pxPerMm, size)
        : resizeBox(d.box, dx, dy, pxPerMm, size, LIMITS[d.key.kind]);
    onChange(withBox(placement, d.key, box));
  };

  return (
    <div className="admin-placement">
      <div className="admin-placement__bar">
        <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => onPage(page - 1)}>
          Previous
        </Button>
        <span>
          Page {page} of {doc?.numPages ?? "…"}
          {doc && doc.numPages > PAGE_LIMIT ? ` (first ${PAGE_LIMIT} shown)` : ""}
        </span>
        <Button
          variant="outline"
          size="sm"
          disabled={page >= pages}
          onClick={() => onPage(page + 1)}
        >
          Next
        </Button>
      </div>
      <div className="admin-placement__page" style={{ width: WIDTH_PX }}>
        <canvas ref={canvas} style={{ width: WIDTH_PX, display: "block" }} />
        {size
          ? itemsOnPage(placement, page).map(({ key, box }) => (
              <div
                key={key.kind === "number" ? `number-${key.index}` : key.kind}
                className={`admin-placement__box${sameKey(selected, key) ? " admin-placement__box--on" : ""}`}
                style={{
                  left: box.xMm * pxPerMm,
                  top: box.yMm * pxPerMm,
                  width: box.wMm * pxPerMm,
                  height: box.hMm * pxPerMm,
                }}
                onPointerDown={(e) => start(e, key, "move")}
                onPointerMove={move}
                onPointerUp={() => (drag.current = null)}
              >
                <span>
                  {key.kind === "number" ? `${labels.number} ${key.index + 1}` : labels[key.kind]}
                </span>
                <i
                  className="admin-placement__handle"
                  onPointerDown={(e) => start(e, key, "size")}
                />
              </div>
            ))
          : null}
      </div>
    </div>
  );
}
