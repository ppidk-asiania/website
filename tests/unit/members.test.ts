import { describe, expect, it } from "vitest";
import {
  ageOn,
  memberProfileInputSchema,
  profileAuditSnapshots,
  RESTRICTED_PROFILE_FIELDS,
  toBasicView,
  type MemberProfile,
} from "@website/domain/members";
import { nextRegistrationStatus, registrationId } from "@website/domain/events";

const now = new Date("2026-10-07T00:00:00Z");
const schema = memberProfileInputSchema(now);

const valid = {
  fullName: "Siti Rahma",
  gender: "female",
  dateOfBirth: "2001-05-20",
  ppiCountry: "jp",
  university: "Kyoto University",
  educationLevel: "master",
  majors: ["Civil Engineering"],
  yearOfEntry: 2025,
  estimatedGraduationYear: 2027,
  addressAbroad: {
    line1: "1-2-3 Sakyo-ku",
    city: "Kyoto",
    postalCode: "606-8501",
    countryCode: "JP",
  },
  addressIndonesia: {
    line1: "Jl. Merdeka No. 10",
    city: "Bandung",
    province: "Jawa Barat",
    postalCode: "40111",
  },
  whatsappNumber: "+62 812-3456-7890",
  emergencyContact: { phone: "+6281111111111", name: "Ibu", relationship: "Mother" },
  timezone: "Asia/Tokyo",
  consent: { privacyPolicyVersion: "2026-10", accepted: true },
};

describe("member profile", () => {
  it("accepts a complete profile and normalizes phone and country", () => {
    const parsed = schema.parse(valid);
    expect(parsed.whatsappNumber).toBe("+6281234567890");
    expect(parsed.ppiCountry).toBe("JP");
  });

  it("rejects missing consent, unknown fields, bad phones, bad timezones and impossible years", () => {
    expect(
      schema.safeParse({ ...valid, consent: { privacyPolicyVersion: "2026-10", accepted: false } })
        .success,
    ).toBe(false);
    expect(schema.safeParse({ ...valid, role: "superadmin" }).success).toBe(false);
    expect(schema.safeParse({ ...valid, whatsappNumber: "08123456789" }).success).toBe(false);
    expect(schema.safeParse({ ...valid, timezone: "Mars/Olympus" }).success).toBe(false);
    expect(schema.safeParse({ ...valid, estimatedGraduationYear: 2024 }).success).toBe(false);
    expect(schema.safeParse({ ...valid, dateOfBirth: "2015-01-01" }).success).toBe(false);
  });

  it("computes age correctly around birthdays", () => {
    expect(ageOn("2001-10-07", now)).toBe(25);
    expect(ageOn("2001-10-08", now)).toBe(24);
  });

  it("basic view drops every restricted field", () => {
    const profile = {
      ...schema.parse(valid),
      userId: "u1",
      email: "siti@example.com",
    } as unknown as MemberProfile;
    const view = toBasicView(profile) as Record<string, unknown>;
    for (const field of RESTRICTED_PROFILE_FIELDS) expect(view).not.toHaveProperty(field);
    expect(view["fullName"]).toBe("Siti Rahma");
  });

  it("audit snapshots never contain restricted values", () => {
    const before = schema.parse(valid);
    const after = { ...before, whatsappNumber: "+6289999999999", university: "Osaka University" };
    const snap = profileAuditSnapshots(before, after);
    const text = JSON.stringify(snap);
    expect(text).not.toContain("+628");
    expect(text).not.toContain("2001-05-20");
    expect(snap.after?.["university"]).toBe("Osaka University");
    expect(snap.after?.["whatsappNumber"]).toBe("[changed]");
    expect(snap.after?.["dateOfBirth"]).toBe("[unchanged]");
    expect(snap.revertible).toBe(false);
    expect(profileAuditSnapshots(before, { ...before, university: "X" }).revertible).toBe(true);
  });
});

describe("event registrations", () => {
  it("one registration per user per event, capacity → waitlist", () => {
    expect(registrationId("e1", "u1")).toBe("e1_u1");
    expect(nextRegistrationStatus({ capacity: 2 }, 1)).toBe("confirmed");
    expect(nextRegistrationStatus({ capacity: 2 }, 2)).toBe("waitlisted");
    expect(nextRegistrationStatus({ capacity: null }, 999)).toBe("confirmed");
  });
});

describe("member profile sanitization", () => {
  it("rejects HTML/script in free-text fields and strips control characters", () => {
    expect(schema.safeParse({ ...valid, fullName: "<img src=x onerror=alert(1)>" }).success).toBe(
      false,
    );
    expect(schema.safeParse({ ...valid, university: "Kyoto <b>University</b>" }).success).toBe(
      false,
    );
    expect(schema.parse({ ...valid, fullName: "Siti\u0000 Rahma‮" }).fullName).toBe("Siti Rahma");
  });
});
