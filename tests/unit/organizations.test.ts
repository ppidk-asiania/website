import { describe, expect, it } from "vitest";
import {
  CORE_UNIT_TYPES,
  deskTitle,
  derivedAssignments,
  ORG_UNIT_TYPES,
  OrgUnitInputSchema,
  PeriodFormSchema,
  SUGGESTED_APPOINTMENT_ROLES,
  type PeriodDesks,
} from "@website/domain/organizations";

const desks = (coordinator = "", signer = ""): { desks: PeriodDesks } => ({
  desks: {
    coordinator: { title: coordinator, orgUnitId: null },
    signer: { title: signer, orgUnitId: null },
  },
});

describe("core unit types follow the new statutes", () => {
  it("has the six new ids and none of the old four (removed, not swapped)", () => {
    expect(CORE_UNIT_TYPES).toEqual([
      "sekretaris_jenderal",
      "wakil_sekretaris_jenderal",
      "sekretaris_eksekutif",
      "wakil_sekretaris_eksekutif",
      "bendahara",
      "wakil_bendahara",
    ]);
    for (const old of ["koordinator", "wakil_koordinator", "sekjen", "wasekjen"]) {
      expect(ORG_UNIT_TYPES).not.toContain(old);
    }
  });

  it("an old id is refused when a unit is saved", () => {
    const unit = {
      periodId: "p1",
      parentId: null,
      name: "Sekretariat",
      code: "SEK",
      description: "",
      sort: 0,
      active: true,
    };
    expect(OrgUnitInputSchema.safeParse({ ...unit, type: "sekjen" }).success).toBe(false);
    expect(OrgUnitInputSchema.safeParse({ ...unit, type: "sekretaris_eksekutif" }).success).toBe(
      true,
    );
  });

  it("the head of a core unit gets the core role, whatever the unit is called", () => {
    const map = SUGGESTED_APPOINTMENT_ROLES;
    for (const type of CORE_UNIT_TYPES) {
      expect(derivedAssignments("head", { id: "u", type }, map)).toEqual([
        { roleId: "officer", scope: { type: "global" } },
        { roleId: map.core[type], scope: { type: "global" } },
      ]);
    }
  });
});

describe("deskTitle", () => {
  it("falls back to the default unit type's title when the period has none", () => {
    expect(deskTitle(null, "coordinator")).toBe("Sekretaris Jenderal");
    expect(deskTitle(null, "signer")).toBe("Sekretaris Eksekutif");
    expect(deskTitle(desks("", "   "), "signer")).toBe("Sekretaris Eksekutif");
  });

  it("uses the period's own title when it is set", () => {
    const period = desks("Ketua Umum", "Sekretaris Umum");
    expect(deskTitle(period, "coordinator")).toBe("Ketua Umum");
    expect(deskTitle(period, "signer")).toBe("Sekretaris Umum");
  });
});

describe("period form: core label and desk titles", () => {
  const base = { name: "2026-2027", cabinet: "Kolaborasi" };

  it("defaults the core label and leaves the titles empty", () => {
    expect(PeriodFormSchema.parse(base)).toMatchObject({
      coreLabel: "Bapelha Inti",
      coordinatorTitle: "",
      signerTitle: "",
    });
  });

  it("takes the label and titles from the form, trimmed", () => {
    expect(
      PeriodFormSchema.parse({
        ...base,
        coreLabel: " Pengurus Harian ",
        coordinatorTitle: " Ketua Umum ",
        signerTitle: "Sekretaris Umum",
      }),
    ).toMatchObject({
      coreLabel: "Pengurus Harian",
      coordinatorTitle: "Ketua Umum",
      signerTitle: "Sekretaris Umum",
    });
  });
});
