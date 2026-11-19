import "server-only";
import { z } from "zod";
import type { InterviewBooking, SqlApplicationStore, SqlInterviewStore } from "@website/db/sql";
import { messageTo, type Contact, type Messenger } from "@website/domain/messaging";
import {
  applicantInScope,
  AttendanceSchema,
  hasInterviewScope,
  passedReview,
  SlotChangeSchema,
  SlotPlanSchema,
  slotNoticeChanged,
  type Application,
  type InterviewScope,
  type InterviewSlot,
} from "@website/domain/recruitment";
import { RuleViolationError } from "@website/domain/shared";
import { can, type Principal } from "@website/permissions";
import { safeId } from "@website/security/validation";
import { createGuardedAction, type AuditBuilder } from "./guarded-action";

const both = (id: string, en: string) => `${id}\n\n${en}`;
const escapeHtml = (text: string) => text.replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`);
const when = (at: Date, timeZone: string) =>
  new Intl.DateTimeFormat("en-GB", {
    timeZone,
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
    timeZoneName: "short",
  }).format(at);
const where = (slot: Pick<InterviewSlot, "mode" | "location" | "note">) =>
  [
    slot.location && `${slot.mode === "online" ? "Link" : "Alamat / Address"}: ${slot.location}`,
    slot.note && `Catatan / Note: ${slot.note}`,
  ]
    .filter((line): line is string => !!line)
    .join("\n");

interface NoticeDeps {
  readonly contacts: (uids: readonly string[]) => Promise<Map<string, Contact>>;
  readonly send: Messenger["send"];
  readonly webUrl: string;
  readonly adminUrl: string;
}

/** Messages of step 11.5, one per person in their own zone; inactive accounts are skipped. */
function messages(deps: NoticeDeps) {
  return async (
    uids: readonly string[],
    fallbackZone: string,
    subject: string,
    key: (uid: string) => string,
    text: (uid: string, zone: string) => string,
  ): Promise<number> => {
    if (uids.length === 0) return 0;
    const contacts = await deps.contacts(uids);
    let sent = 0;
    for (const uid of uids) {
      const contact = contacts.get(uid) ?? null;
      if (contact?.active === false) continue;
      const body = text(uid, contact?.timeZone ?? fallbackZone);
      const status = await deps.send(
        messageTo(contact, {
          subject,
          text: body,
          html: `<p>${escapeHtml(body).replace(/\n/g, "<br>")}</p>`,
        }),
        key(uid),
      );
      if (status !== "duplicate") sent += 1;
    }
    return sent;
  };
}

export function createInterviewNotices(deps: NoticeDeps) {
  const tell = messages(deps);
  const applicantPage = (a: Pick<Application, "recruitmentId">) =>
    `${deps.webUrl}/recruitment/${a.recruitmentId}`;

  return {
    /** Time, mode, link, address or note changed: the booked applicants, and the interviewer when someone else did it. */
    async slotChanged(input: {
      before: InterviewSlot;
      after: InterviewSlot;
      applications: readonly Application[];
      changedBy: string;
    }): Promise<void> {
      const { before, after } = input;
      if (!slotNoticeChanged(before, after)) return;
      const body = (zone: string) => `${when(after.startsAt, zone)}\n${where(after)}`.trim();
      for (const a of input.applications) {
        await tell(
          [a.userId],
          after.timeZone,
          "Wawancara berubah / Interview changed",
          () => `interview:${a.id}:changed:${after.version}`,
          (_uid, zone) =>
            `${both(
              "Jadwal atau keterangan wawancaramu berubah.",
              "The time or details of your interview changed.",
            )}\n\n${body(zone)}\n\n${applicantPage(a)}`,
        );
      }
      if (after.interviewerUid && after.interviewerUid !== input.changedBy) {
        await tell(
          [after.interviewerUid],
          after.timeZone,
          "Waktu wawancara diubah / Interview time changed",
          () => `interview:${after.id}:changed:${after.version}`,
          (_uid, zone) =>
            `${both(
              "Waktu wawancaramu diubah oleh orang lain.",
              "One of your interview times was changed by someone else.",
            )}\n\n${body(zone)}\n\n${deps.adminUrl}/interviews`,
        );
      }
    },

    /** The interviewer cancelled a time: its applicants are asked to pick again. */
    async slotCancelled(slot: InterviewSlot, applications: readonly Application[]): Promise<void> {
      for (const a of applications) {
        await tell(
          [a.userId],
          slot.timeZone,
          "Wawancara dibatalkan / Interview cancelled",
          () => `interview:${a.id}:cancelled:${slot.id}`,
          (_uid, zone) =>
            `${both(
              "Jadwal wawancaramu dibatalkan. Pilih jadwal lain di halaman lamaran.",
              "Your interview time was cancelled. Pick another time on the application page.",
            )}\n\n${when(slot.startsAt, zone)}\n\n${applicantPage(a)}`,
        );
      }
    },
  };
}

export type InterviewNotices = ReturnType<typeof createInterviewNotices>;

const REMINDER_MINUTES = 30;

/** Part of the cron job `meeting-reminders`: 30 minutes before, to the applicant and the interviewer. */
export function createInterviewReminders(
  deps: NoticeDeps & {
    readonly bookings: (from: Date, to: Date) => Promise<InterviewBooking[]>;
    readonly now: () => Date;
  },
) {
  const tell = messages(deps);
  return async (): Promise<{ interviewMessages: number }> => {
    const now = deps.now();
    const due = await deps.bookings(now, new Date(now.getTime() + REMINDER_MINUTES * 60_000));
    let interviewMessages = 0;
    for (const { application, slot } of due) {
      const startsAt = slot.startsAt.getTime();
      const uids = [application.userId, slot.interviewerUid].filter(
        (uid): uid is string => uid !== null,
      );
      interviewMessages += await tell(
        uids,
        slot.timeZone,
        "Wawancara segera dimulai / Interview starts soon",
        (uid) => `interview:${application.id}:start:${uid}:${startsAt}`,
        (uid, zone) =>
          `${both(
            "Wawancara dimulai sebentar lagi.",
            "The interview starts soon.",
          )}\n\n${when(slot.startsAt, zone)}\n${where(slot)}\n\n${
            uid === application.userId
              ? `${deps.webUrl}/recruitment/${application.recruitmentId}`
              : `${deps.adminUrl}/interviews`
          }`.trim(),
      );
    }
    return { interviewMessages };
  };
}

export interface InterviewDeps {
  readonly interviews: Pick<
    SqlInterviewStore,
    "createPlan" | "remove" | "get" | "update" | "cancel"
  >;
  readonly applications: Pick<SqlApplicationStore, "markAttendance">;
  readonly scope: (uid: string) => Promise<InterviewScope>;
  readonly notices: Pick<InterviewNotices, "slotChanged" | "slotCancelled">;
  readonly now: () => Date;
}

const slotSnapshot = (s: InterviewSlot) => ({
  startsAt: s.startsAt.toISOString(),
  durationMinutes: s.durationMinutes,
  capacity: s.capacity,
  mode: s.mode,
  location: s.location,
  note: s.note,
  bookingCutoffHours: s.bookingCutoffHours,
});

export function createInterviewActions(deps: InterviewDeps) {
  // A board seat is a second way in, not a permission; every handler still checks the record.
  const orIf = async (principal: Principal) =>
    hasInterviewScope(await deps.scope(principal.userId));
  const interviewer = { permission: "recruitment.interview", inSomeScope: true, orIf } as const;

  const planAudit =
    (
      audit: AuditBuilder,
      recruitmentId: string,
      date: string,
      plan: z.output<typeof SlotPlanSchema>,
    ) =>
    (slots: readonly InterviewSlot[], title: string) =>
      audit({
        module: "recruitment",
        action: "CREATE",
        resourceType: "interviewSlot",
        resourceId: recruitmentId,
        title: `${title}: ${slots.length} interview times on ${date}`,
        before: null,
        after: {
          date,
          timeZone: plan.timeZone,
          slots: slots.map((s) => s.startsAt.toISOString()),
          capacity: plan.capacity,
        },
        versionBefore: null,
        versionAfter: null,
        revertible: false,
      });

  const createPlan = createGuardedAction({
    permission: "recruitment.review",
    input: z.object({ recruitmentId: safeId, plan: SlotPlanSchema }).strict(),
    handler: async ({ recruitmentId, plan }, _principal, audit) => {
      const created = await deps.interviews.createPlan(
        recruitmentId,
        plan,
        planAudit(audit, recruitmentId, plan.date, plan),
        deps.now(),
      );
      return { created: created.length };
    },
  });

  /** "My interview times": the interviewer opens times for the unit of their seat. */
  const createMine = createGuardedAction({
    ...interviewer,
    input: z.object({ recruitmentId: safeId, orgUnitId: safeId, plan: SlotPlanSchema }).strict(),
    handler: async ({ recruitmentId, orgUnitId, plan }, principal, audit) => {
      const scope = await deps.scope(principal.userId);
      if (!scope.all && !scope.slotUnitIds.has(orgUnitId)) {
        throw new RuleViolationError("You can only open interview times for your own unit.");
      }
      const created = await deps.interviews.createPlan(
        recruitmentId,
        plan,
        planAudit(audit, recruitmentId, plan.date, plan),
        deps.now(),
        { interviewerUid: principal.userId, orgUnitId },
      );
      return { created: created.length };
    },
  });

  const removeSlot = createGuardedAction({
    permission: "recruitment.review",
    input: z.object({ id: safeId }).strict(),
    handler: async ({ id }, _principal, audit) => {
      await deps.interviews.remove(
        id,
        (slot) =>
          audit({
            module: "recruitment",
            action: "DELETE",
            resourceType: "interviewSlot",
            resourceId: slot.id,
            title: `Interview time ${slot.startsAt.toISOString()}`,
            before: { startsAt: slot.startsAt.toISOString(), capacity: slot.capacity },
            after: null,
            versionBefore: null,
            versionAfter: null,
            revertible: false,
          }),
        deps.now(),
      );
      return { id };
    },
  });

  // Only the interviewer who opened a time (or the committee) changes or cancels it.
  const ownSlot = async (id: string, principal: Principal): Promise<InterviewSlot> => {
    const slot = await deps.interviews.get(id);
    if (!slot || slot.deletedAt)
      throw new RuleViolationError("This interview time does not exist.");
    if (slot.interviewerUid !== principal.userId && !can(principal, "recruitment.review")) {
      throw new RuleViolationError("Only the interviewer of this time can do this.");
    }
    return slot;
  };

  const updateSlot = createGuardedAction({
    ...interviewer,
    input: SlotChangeSchema,
    handler: async ({ id, ...change }, principal, audit) => {
      await ownSlot(id, principal);
      const result = await deps.interviews.update(id, change, (before, after) =>
        audit({
          module: "recruitment",
          action: "UPDATE",
          resourceType: "interviewSlot",
          resourceId: id,
          title: `Interview time ${before.startsAt.toISOString()}`,
          before: slotSnapshot(before),
          after: slotSnapshot(after),
          versionBefore: before.version,
          versionAfter: after.version,
          revertible: false,
        }),
      );
      if (result.changed) {
        await deps.notices.slotChanged({ ...result, changedBy: principal.userId });
      }
      return { id, changed: result.changed };
    },
  });

  const cancelSlot = createGuardedAction({
    ...interviewer,
    input: z.object({ id: safeId }).strict(),
    handler: async ({ id }, principal, audit) => {
      await ownSlot(id, principal);
      const { slot, applications } = await deps.interviews.cancel(
        id,
        (cancelled, bookings) =>
          audit({
            module: "recruitment",
            action: "DELETE",
            resourceType: "interviewSlot",
            resourceId: cancelled.id,
            title: `Interview time ${cancelled.startsAt.toISOString()} (${bookings} bookings cancelled)`,
            before: slotSnapshot(cancelled),
            after: null,
            versionBefore: cancelled.version,
            versionAfter: null,
            revertible: false,
          }),
        deps.now(),
      );
      await deps.notices.slotCancelled(slot, applications);
      return { id, cancelled: applications.length };
    },
  });

  /** Attended or absent, with a note: the committee, or the interviewer of that very time. */
  const markAttendance = createGuardedAction({
    permission: "recruitment.review",
    orIf,
    inSomeScope: true,
    input: AttendanceSchema,
    handler: async ({ id, choiceId, attendance, note, version }, principal, audit) => {
      await deps.applications.markAttendance(
        id,
        choiceId,
        { attendance, note, version },
        { uid: principal.userId, review: can(principal, "recruitment.review") },
        (before, after, current, next, title) =>
          audit({
            module: "recruitment",
            action: "UPDATE",
            resourceType: "application",
            resourceId: next.id,
            title: `${title}: interview ${attendance}`,
            before,
            after,
            versionBefore: current.version,
            versionAfter: next.version,
            revertible: false,
          }),
        deps.now(),
      );
      return { id };
    },
  });

  return { createPlan, createMine, removeSlot, updateSlot, cancelSlot, markAttendance };
}

export interface InterviewReadDeps {
  readonly applications: Pick<SqlApplicationStore, "listForRecruitment" | "get">;
  readonly interviews: Pick<SqlInterviewStore, "listForRecruitment">;
  readonly scope: (uid: string) => Promise<InterviewScope>;
}

/** What an interviewer may open: applicants in scope who passed the document check. */
export function createInterviewReads(deps: InterviewReadDeps) {
  const inScope = async (uid: string, recruitmentId: string, applications: Application[]) => {
    const scope = await deps.scope(uid);
    if (!hasInterviewScope(scope)) return [];
    const slots = new Map(
      (await deps.interviews.listForRecruitment(recruitmentId)).map((s) => [s.id, s]),
    );
    return applications.filter(
      (a) => passedReview(a.status) && applicantInScope(scope, uid, a, slots),
    );
  };

  return {
    async applicants(uid: string, recruitmentId: string): Promise<Application[]> {
      return inScope(uid, recruitmentId, await deps.applications.listForRecruitment(recruitmentId));
    },

    async application(uid: string, id: string): Promise<Application | null> {
      const found = await deps.applications.get(id);
      return found ? ((await inScope(uid, found.recruitmentId, [found]))[0] ?? null) : null;
    },
  };
}
