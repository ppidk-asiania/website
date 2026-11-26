import { describe, expect, it } from "vitest";
import { unitDocumentExtension, unitDocumentRights } from "@website/domain/organizations";

const bytes = (...b: number[]) => new Uint8Array([...b, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
const PDF = bytes(0x25, 0x50, 0x44, 0x46, 0x2d);
const ZIP = bytes(0x50, 0x4b, 0x03, 0x04);
const PNG = bytes(0x89, 0x50, 0x4e, 0x47);

describe("unitDocumentExtension", () => {
  it("accepts an allowed extension only when the bytes are that kind", () => {
    expect(unitDocumentExtension("Plan.PDF", PDF)).toBe("pdf");
    expect(unitDocumentExtension("budget.xlsx", ZIP)).toBe("xlsx");
    expect(unitDocumentExtension("logo.png", PNG)).toBe("png");
    expect(unitDocumentExtension("plan.pdf", ZIP)).toBeNull();
    expect(unitDocumentExtension("run.exe", PDF)).toBeNull();
    expect(unitDocumentExtension("noextension", PDF)).toBeNull();
  });
});

describe("unitDocumentRights", () => {
  const viewer = { activePeriodId: "p1", seatUnitIds: ["unit-1"], editor: false };
  const doc = (periodId: string, orgUnitId: string | null) => ({ periodId, orgUnitId });

  it("a seat holder writes in their own unit and only reads the others", () => {
    expect(unitDocumentRights(viewer, doc("p1", "unit-1"))).toEqual({ read: true, write: true });
    expect(unitDocumentRights(viewer, doc("p1", "unit-2"))).toEqual({ read: true, write: false });
    expect(unitDocumentRights(viewer, doc("p1", null))).toEqual({ read: true, write: false });
  });

  it("another period is closed to everyone but the editor", () => {
    expect(unitDocumentRights(viewer, doc("p0", "unit-1"))).toEqual({ read: false, write: false });
    expect(unitDocumentRights({ ...viewer, editor: true }, doc("p0", "unit-1"))).toEqual({
      read: true,
      write: true,
    });
  });

  it("someone with no seat reads nothing; with no active period nothing is open", () => {
    expect(unitDocumentRights({ ...viewer, seatUnitIds: [] }, doc("p1", "unit-1"))).toEqual({
      read: false,
      write: false,
    });
    expect(unitDocumentRights({ ...viewer, activePeriodId: null }, doc("p1", "unit-1")).read).toBe(
      false,
    );
  });
});
