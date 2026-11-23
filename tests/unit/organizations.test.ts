import { describe, expect, it } from "vitest";
import {
  activeSeats,
  APPOINTMENT_SEATS,
  CORE_UNIT_TYPES,
  seatLabel,
  seatsFor,
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

describe("seats (step 10.2, DEC-20)", () => {
  it("has five seats; a core unit keeps exactly one (the unit is the seat)", () => {
    expect(APPOINTMENT_SEATS).toEqual(["head", "deputy_head", "secretary", "treasurer", "member"]);
    expect(seatsFor({ type: "bendahara" })).toEqual(["head"]);
    expect(seatsFor({ type: "bidang" })).toEqual(APPOINTMENT_SEATS);
  });

  it("seatLabel never repeats the unit type", () => {
    expect(seatLabel("head", { name: "Desain", type: "bidang" })).toBe("Kepala Bidang Desain");
    expect(seatLabel("head", { name: "Bidang Desain", type: "bidang" })).toBe(
      "Kepala Bidang Desain",
    );
    expect(seatLabel("deputy_head", { name: "Media", type: "direktorat" })).toBe(
      "Wakil Kepala Direktorat Media",
    );
    expect(seatLabel("treasurer", { name: "Biro Umum", type: "biro" })).toBe("Bendahara Biro Umum");
    expect(seatLabel("head", { name: "Bendahara Eksekutif", type: "bendahara" })).toBe(
      "Bendahara Eksekutif",
    );
  });

  it("a unit's role map beats the default, per seat", () => {
    const unit = {
      id: "sek",
      type: "biro" as const,
      roleMap: {
        member: { roleId: "secretariat", scope: "global" as const },
        head: { roleId: "bureau-head", scope: "unit" as const },
      },
    };
    const map = SUGGESTED_APPOINTMENT_ROLES;
    expect(derivedAssignments("member", unit, map)).toEqual([
      { roleId: "officer", scope: { type: "global" } },
      { roleId: "secretariat", scope: { type: "global" } },
    ]);
    expect(derivedAssignments("head", unit, map)).toEqual([
      { roleId: "officer", scope: { type: "global" } },
      { roleId: "bureau-head", scope: { type: "orgUnit", orgUnitId: "sek" } },
    ]);
    expect(derivedAssignments("secretary", unit, map)).toEqual([
      { roleId: "officer", scope: { type: "global" } },
      { roleId: "directorate_secretary", scope: { type: "orgUnit", orgUnitId: "sek" } },
    ]);
  });

  it("activeSeats ignores ended, other-period and unit-less seats", () => {
    const units = new Map([["media", { path: ["dirs"], type: "direktorat" as const }]]);
    const seat = (over: Record<string, unknown>) => ({
      orgUnitId: "media",
      seat: "head" as const,
      status: "active" as const,
      periodId: "p1",
      ...over,
    });
    expect(
      activeSeats(
        [
          seat({}),
          seat({ status: "ended" }),
          seat({ periodId: "p0" }),
          seat({ orgUnitId: "gone" }),
          { status: "active", periodId: "p1" } as never,
        ],
        units,
        "p1",
      ),
    ).toEqual([
      { orgUnitId: "media", orgUnitPath: ["dirs", "media"], unitType: "direktorat", seat: "head" },
    ]);
    expect(activeSeats([seat({})], units, undefined)).toEqual([]);
  });
});
