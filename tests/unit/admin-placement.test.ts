import { describe, expect, it } from "vitest";
import type { UploadPlacement } from "@website/domain/documents";
import {
  boxOf,
  dragBox,
  itemsOnPage,
  PAGE_LIMIT,
  resizeBox,
  withBox,
} from "../../apps/admin/src/components/placement-math";

const A4 = { wMm: 210, hMm: 297 };
const placement: UploadPlacement = {
  numbers: [
    { page: 1, xMm: 20, yMm: 30, wMm: 90, hMm: 6 },
    { page: 2, xMm: 20, yMm: 30, wMm: 90, hMm: 6 },
  ],
  qr: { page: 1, xMm: 170, yMm: 250, sizeMm: 22 },
  secretary: { page: 1, xMm: 130, yMm: 230, wMm: null, withStamp: false },
  coordinator: null,
};

describe("placement boxes on a page preview (14.2)", () => {
  it("drags by screen pixels to millimetres and stays on the page", () => {
    const box = { xMm: 20, yMm: 30, wMm: 90, hMm: 6 };
    expect(dragBox(box, 20, -10, 2, A4)).toMatchObject({ xMm: 30, yMm: 25 });
    expect(dragBox(box, -999, -999, 2, A4)).toMatchObject({ xMm: 0, yMm: 0 });
    expect(dragBox(box, 9999, 9999, 2, A4)).toMatchObject({ xMm: 120, yMm: 291 });
    expect(dragBox(box, 1, 1, 3, A4)).toMatchObject({ xMm: 20.3, yMm: 30.3 });
  });

  it("resizes within the limits and the page; a ratio keeps the shape", () => {
    const box = { xMm: 150, yMm: 30, wMm: 40, hMm: 10 };
    const free = { minW: 5, maxW: 210, minH: 3, maxH: 100 };
    expect(resizeBox(box, 20, 10, 2, A4, free)).toMatchObject({ wMm: 50, hMm: 15 });
    expect(resizeBox(box, 999, 999, 2, A4, free)).toMatchObject({ wMm: 60, hMm: 100 });
    expect(resizeBox(box, -999, -999, 2, A4, free)).toMatchObject({ wMm: 5, hMm: 3 });
    const square = { minW: 15, maxW: 40, minH: 15, maxH: 40, ratio: 1 };
    expect(resizeBox({ ...box, wMm: 22, hMm: 22 }, 100, 0, 2, A4, square)).toMatchObject({
      wMm: 40,
      hMm: 40,
    });
  });

  it("lists what sits on a page and reads and writes each box back into the placement", () => {
    expect(itemsOnPage(placement, 1).map((i) => i.key)).toEqual([
      { kind: "number", index: 0 },
      { kind: "qr" },
      { kind: "secretary" },
    ]);
    expect(itemsOnPage(placement, 2).map((i) => i.key)).toEqual([{ kind: "number", index: 1 }]);
    expect(boxOf(placement, { kind: "qr" })).toEqual({ xMm: 170, yMm: 250, wMm: 22, hMm: 22 });
    expect(boxOf(placement, { kind: "secretary" })).toEqual({
      xMm: 130,
      yMm: 230,
      wMm: 40,
      hMm: 16,
    });
    expect(boxOf(placement, { kind: "coordinator" })).toBeNull();

    const moved = withBox(
      placement,
      { kind: "number", index: 1 },
      {
        xMm: 5,
        yMm: 6,
        wMm: 70,
        hMm: 8,
      },
    );
    expect(moved.numbers[1]).toEqual({ page: 2, xMm: 5, yMm: 6, wMm: 70, hMm: 8 });
    expect(moved.numbers[0]).toBe(placement.numbers[0]);
    expect(withBox(placement, { kind: "qr" }, { xMm: 1, yMm: 2, wMm: 30, hMm: 30 }).qr).toEqual({
      page: 1,
      xMm: 1,
      yMm: 2,
      sizeMm: 30,
    });
    expect(
      withBox(placement, { kind: "secretary" }, { xMm: 1, yMm: 2, wMm: 55, hMm: 22 }).secretary,
    ).toEqual({ page: 1, xMm: 1, yMm: 2, wMm: 55, withStamp: false });
    expect(withBox(placement, { kind: "coordinator" }, { xMm: 1, yMm: 2, wMm: 5, hMm: 5 })).toBe(
      placement,
    );
  });

  it("shows only the first pages of a long document", () => {
    expect(PAGE_LIMIT).toBe(30);
  });
});
