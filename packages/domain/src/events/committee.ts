import { z } from "zod";
import { safeId, safeText } from "@website/security/validation";

/** The committee of one event (N1.5): divisions, and people with a seat in a division. */
export const COMMITTEE_SEATS = ["head", "deputy", "secretary", "treasurer", "member"] as const;
export type CommitteeSeat = (typeof COMMITTEE_SEATS)[number];

/** Committee rights end this many days after the event; `events.edit` holders are not locked. */
export const COMMITTEE_LOCK_DAYS = 14;

export interface Division {
  readonly id: string;
  readonly name: string;
  /** One level deep is enough ("Logistics" > "Catering"). */
  readonly parentId: string | null;
  /** People wanted; null = no target. */
  readonly quota: number | null;
  readonly description: string;
}

export interface CommitteeMember {
  /** An account, or null for a helper from outside who is only typed in. */
  readonly userId: string | null;
  /** The typed name of a helper without an account; empty when `userId` is set (the account's name is shown). */
  readonly name: string;
  readonly divisionId: string;
  readonly seat: CommitteeSeat;
}

/** A form that fills the committee (N1.6): a volunteer sign-up (guest form) or an application of accounts. */
export const APPLICATION_KINDS = ["volunteer", "committee"] as const;
export type ApplicationKind = (typeof APPLICATION_KINDS)[number];
export interface ApplicationForm {
  readonly formId: string;
  readonly kind: ApplicationKind;
}

export interface EventCommittee {
  readonly divisions: readonly Division[];
  readonly members: readonly CommitteeMember[];
  /** The forms whose answers are placed into the committee; absent = none. */
  readonly applicationForms?: readonly ApplicationForm[];
}

export const CommitteeInputSchema = z
  .object({
    divisions: z
      .array(
        z
          .object({
            id: safeId,
            name: safeText(80).pipe(z.string().min(2, "Name each division.")),
            parentId: safeId.nullable(),
            quota: z.number().int().min(1).max(500).nullable(),
            description: safeText(500, { multiline: true, allowEmpty: true }),
          })
          .strict(),
      )
      .max(30),
    members: z
      .array(
        z
          .object({
            userId: safeId.nullable(),
            name: safeText(120, { allowEmpty: true }),
            divisionId: safeId,
            seat: z.enum(COMMITTEE_SEATS),
          })
          .strict(),
      )
      .max(300),
    applicationForms: z
      .array(z.object({ formId: safeId, kind: z.enum(APPLICATION_KINDS) }).strict())
      .max(4)
      .default([]),
  })
  .strict()
  .superRefine((committee, ctx) => {
    const issue = (message: string, path: (string | number)[]) =>
      ctx.addIssue({ code: "custom", message, path });
    const ids = new Set(committee.divisions.map((d) => d.id));
    if (ids.size !== committee.divisions.length)
      issue("Each division needs its own id.", ["divisions"]);
    const byId = new Map(committee.divisions.map((d) => [d.id, d]));
    committee.divisions.forEach((d, i) => {
      if (d.parentId === null) return;
      const parent = byId.get(d.parentId);
      if (!parent || parent.parentId !== null || parent.id === d.id) {
        issue("A division sits under a top-level division of this committee.", ["divisions", i]);
      }
    });
    if (committee.divisions[0]?.parentId) {
      issue("The first division is the event board.", ["divisions", 0]);
    }
    if (
      new Set(committee.divisions.map((d) => `${d.parentId}:${d.name.toLowerCase()}`)).size !==
      committee.divisions.length
    ) {
      issue("Each division needs its own name.", ["divisions"]);
    }
    const seen = new Set<string>();
    if (
      new Set(committee.applicationForms.map((f) => f.formId)).size !==
      committee.applicationForms.length
    )
      issue("A form is linked once.", ["applicationForms"]);
    committee.members.forEach((m, i) => {
      if (!ids.has(m.divisionId)) issue("Choose a division of this committee.", ["members", i]);
      if (m.userId === null && m.name === "")
        issue("Pick an account or type a name.", ["members", i]);
      const person = m.userId !== null ? `u:${m.userId}` : `n:${m.name.toLowerCase()}`;
      if (seen.has(person)) issue("A person has one seat on a committee.", ["members", i]);
      seen.add(person);
    });
  });
export type CommitteeInput = z.infer<typeof CommitteeInputSchema>;

/** 14 days after the event ends (or starts, when it has no end) the committee rights end. */
export function committeeLocked(
  event: { startsAt: Date; endsAt: Date | null },
  now: Date,
): boolean {
  const end = (event.endsAt ?? event.startsAt).getTime();
  return now.getTime() > end + COMMITTEE_LOCK_DAYS * 86_400_000;
}

export type CommitteeRole = "board" | "member";

/**
 * What an account may do on THIS event from its seat: any seat of the first division (the event board) is
 * `board`, every other seat is `member`, nobody is `null`. Recomputed on every request; locked after 14 days.
 */
export function committeeRole(
  committee: Pick<EventCommittee, "divisions" | "members"> | null,
  userId: string,
  event: { startsAt: Date; endsAt: Date | null },
  now: Date,
): CommitteeRole | null {
  if (!committee || committeeLocked(event, now)) return null;
  const seat = committee.members.find((m) => m.userId === userId);
  if (!seat) return null;
  return committee.divisions[0]?.id === seat.divisionId ? "board" : "member";
}

/** "Logistics 2 of 5": the divisions that still miss people. */
export function committeeGaps(
  committee: Pick<EventCommittee, "divisions" | "members">,
): Array<{ id: string; name: string; filled: number; quota: number }> {
  return committee.divisions.flatMap((d) => {
    const filled = committee.members.filter((m) => m.divisionId === d.id).length;
    return d.quota !== null && filled < d.quota
      ? [{ id: d.id, name: d.name, filled, quota: d.quota }]
      : [];
  });
}

/** Three starting structures to copy into an event: a name, its parent's name and the people wanted. */
export const COMMITTEE_TEMPLATES: Readonly<
  Record<
    "small" | "seminar" | "festival",
    ReadonlyArray<{ name: string; parent: string | null; quota: number | null }>
  >
> = {
  small: [
    { name: "Event board (BPH)", parent: null, quota: 3 },
    { name: "Program", parent: null, quota: 3 },
    { name: "Logistics", parent: null, quota: 3 },
  ],
  seminar: [
    { name: "Event board (BPH)", parent: null, quota: 4 },
    { name: "Program", parent: null, quota: 4 },
    { name: "Publication and design", parent: null, quota: 3 },
    { name: "Sponsorship", parent: null, quota: 3 },
    { name: "Logistics", parent: null, quota: 4 },
    { name: "Catering", parent: "Logistics", quota: 2 },
  ],
  festival: [
    { name: "Event board (BPH)", parent: null, quota: 5 },
    { name: "Program", parent: null, quota: 6 },
    { name: "Publication and design", parent: null, quota: 4 },
    { name: "Sponsorship", parent: null, quota: 4 },
    { name: "Volunteers", parent: null, quota: 5 },
    { name: "Logistics", parent: null, quota: 6 },
    { name: "Catering", parent: "Logistics", quota: 3 },
    { name: "Venue", parent: "Logistics", quota: 3 },
  ],
};

/** How one applicant ended: placed in a division with a seat, or rejected (N1.6). */
export const PlacementSchema = z.discriminatedUnion("outcome", [
  z
    .object({ outcome: z.literal("placed"), divisionId: safeId, seat: z.enum(COMMITTEE_SEATS) })
    .strict(),
  z.object({ outcome: z.literal("rejected") }).strict(),
]);
export type Placement = z.infer<typeof PlacementSchema>;
