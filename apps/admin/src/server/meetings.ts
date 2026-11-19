import "server-only";
import { z } from "zod";
import type { AuditAction } from "@website/audit";
import type { MeetingAudit, MeetingFields, SqlMeetingStore } from "@website/db/sql";
import {
  assertParticipants,
  assertScheduled,
  attendanceCode,
  cancelMeeting,
  changeKey,
  CODE_LIFETIME_MS,
  dueReminder,
  markAttendance,
  MAX_PARTICIPANTS,
  MEETING_ROLES,
  MeetingInputSchema,
  meetingTimes,
  noticeKey,
  reminderKey,
  runsMeeting,
  setRoom,
  unmarkAttendance,
  type Meeting,
  type MeetingRoom,
} from "@website/domain/meetings";
import { messageTo, type Contact, type Messenger } from "@website/domain/messaging";
import { RuleViolationError } from "@website/domain/shared";
import { can, type Principal, type ResourceContext } from "@website/permissions";
import { safeId, safeText } from "@website/security/validation";
import { createGuardedAction, type AuditBuilder } from "./guarded-action";

export interface MeetingDeps {
  readonly meetings: Pick<SqlMeetingStore, "get" | "write" | "saveCode" | "dueForReminders">;
  readonly unitPath: (orgUnitId: string) => Promise<readonly string[] | null>;
  readonly unitName: (orgUnitId: string) => Promise<string | null>;
  readonly findUserId: (email: string) => Promise<string | null>;
  readonly contacts: (uids: readonly string[]) => Promise<Map<string, Contact>>;
  readonly send: Messenger["send"];
  readonly adminUrl: string;
  readonly webUrl: string;
  readonly randomBytes: (n: number) => Uint8Array;
  readonly zoomBooking: (id: string) => Promise<{
    status: string;
    meetingId: string | null;
    passcode?: string;
    joinUrl?: string | null;
    shortUrl?: string | null;
  } | null>;
  readonly now: () => Date;
  readonly uuid: () => string;
}

export function canRunMeeting(
  principal: Principal,
  meeting: Pick<Meeting, "participants" | "orgUnitPath">,
): boolean {
  return (
    principal.active &&
    (runsMeeting(meeting, principal.userId) ||
      can(principal, "meetings.edit", { orgUnitPath: meeting.orgUnitPath }))
  );
}

export const canSeeMeeting = (
  principal: Principal,
  meeting: Pick<Meeting, "participantIds" | "orgUnitPath">,
) =>
  meeting.participantIds.includes(principal.userId) ||
  can(principal, "meetings.read", { orgUnitPath: meeting.orgUnitPath });

const version = z.number().int().min(1);
const Ref = z.object({ id: safeId, version }).strict();
const SaveMeeting = MeetingInputSchema.extend({
  id: safeId.optional(),
  version: version.nullable(),
  notify: z.boolean().default(true),
  periodId: safeId,
  participants: z
    .array(
      z
        .object({
          email: z.email("Enter the participant's account e-mail.").max(254),
          role: z.enum(MEETING_ROLES),
        })
        .strict(),
    )
    .min(1, "Add at least the chair.")
    .max(MAX_PARTICIPANTS),
}).strict();
const SetRoom = Ref.extend({
  notify: z.boolean().default(true),
  room: z.discriminatedUnion("kind", [
    z.object({ kind: z.literal("link"), url: z.url("Enter the meeting link.").max(500) }).strict(),
    z.object({ kind: z.literal("none") }).strict(),
    z.object({ kind: z.literal("zoom"), zoomRequestId: safeId }).strict(),
  ]),
}).strict();
const Cancel = Ref.extend({
  reason: safeText(500).pipe(z.string().min(2, "Give a reason.")),
  notify: z.boolean().default(true),
});
const Mark = Ref.extend({ uid: safeId, present: z.boolean() }).strict();

const meetingAudit =
  (audit: AuditBuilder, action: AuditAction, revertible = true): MeetingAudit =>
  (before, after, current, next) =>
    audit({
      module: "meetings",
      action,
      resourceType: "meeting",
      resourceId: next.id,
      title: next.title,
      before,
      after,
      versionBefore: current?.version ?? null,
      versionAfter: next.version,
      revertible,
    });

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

interface Change {
  readonly label: string;
  readonly from: (zone: string) => string;
  readonly to: (zone: string) => string;
}
const instantChange = (label: string, from: Date, to: Date): Change[] =>
  from.getTime() === to.getTime()
    ? []
    : [{ label, from: (z) => when(from, z), to: (z) => when(to, z) }];
const textChange = (label: string, from: string | null, to: string | null): Change[] =>
  from === to ? [] : [{ label, from: () => from ?? "-", to: () => to ?? "-" }];

export function createMeetingActions(deps: MeetingDeps) {
  const unitScope = async (orgUnitId: string | null): Promise<ResourceContext> => {
    if (orgUnitId === null) return { orgUnitPath: [] };
    const path = await deps.unitPath(orgUnitId);
    if (!path) throw new RuleViolationError("Choose a unit of this board period.");
    return { orgUnitPath: path };
  };
  const load = async (id: string) => {
    const meeting = await deps.meetings.get(id);
    if (!meeting || meeting.deletedAt) throw new RuleViolationError("This meeting does not exist.");
    return meeting;
  };
  const resolve = async (
    people: ReadonlyArray<{ email: string; role: Meeting["participants"][number]["role"] }>,
  ) => {
    const participants: Array<Meeting["participants"][number]> = [];
    for (const p of people) {
      const uid = await deps.findUserId(p.email.toLowerCase());
      if (!uid) throw new RuleViolationError(`No account uses ${p.email}.`);
      participants.push({ uid, role: p.role });
    }
    assertParticipants(participants);
    return participants;
  };

  const roomDetails = async (room: MeetingRoom) => {
    const booking = room.zoomRequestId ? await deps.zoomBooking(room.zoomRequestId) : null;
    return {
      link: room.externalUrl ?? booking?.shortUrl ?? booking?.joinUrl ?? null,
      passcode: booking?.passcode ?? null,
    };
  };

  // One message per person, in their own zone; inactive accounts are skipped.
  async function tell(
    meeting: Meeting,
    uids: readonly string[],
    key: (uid: string) => string,
    compose: (uid: string, zone: string) => string,
  ): Promise<number> {
    if (uids.length === 0) return 0;
    const contacts = await deps.contacts(uids);
    let sent = 0;
    for (const uid of uids) {
      const contact = contacts.get(uid) ?? null;
      if (contact?.active === false) continue;
      const body = compose(uid, contact?.timeZone ?? meeting.timeZone);
      const status = await deps.send(
        messageTo(contact, {
          subject: `Rapat / Meeting: ${meeting.title}`,
          text: body,
          html: `<p>${escapeHtml(body).replace(/\n/g, "<br>")}</p>`,
        }),
        key(uid),
      );
      if (status !== "duplicate") sent += 1;
    }
    return sent;
  }

  const page = (meeting: Meeting) => `${deps.adminUrl}/meetings/${meeting.id}`;
  // Room and unit are looked up once; the returned function renders them for one reader's zone.
  const factsOf = async (meeting: Meeting) => {
    const room = await roomDetails(meeting.room);
    const unit = meeting.orgUnitId ? await deps.unitName(meeting.orgUnitId) : null;
    return (zone: string) =>
      [
        `Waktu / Time: ${when(meeting.startsAt, zone)} - ${when(meeting.endsAt, zone)}`,
        unit && `Unit: ${unit}`,
        room.link && `Link: ${room.link}`,
        room.passcode && `Passcode: ${room.passcode}`,
      ].filter((line): line is string => !!line);
  };

  const sendInvitations = async (meeting: Meeting, uids: readonly string[]) => {
    if (uids.length === 0) return;
    const facts = await factsOf(meeting);
    const agenda = meeting.agenda.slice(0, 5).map((a, i) => `${i + 1}. ${a.title}`);
    await tell(
      meeting,
      uids,
      (uid) => noticeKey(meeting, "invite", uid),
      (_uid, zone) =>
        [
          both(
            `Kamu diundang ke rapat "${meeting.title}".`,
            `You are invited to the meeting "${meeting.title}".`,
          ),
          ...facts(zone),
          ...(agenda.length ? ["Agenda:", ...agenda] : []),
          page(meeting),
        ].join("\n"),
    );
  };

  const sendChange = async (
    before: Meeting,
    after: Meeting,
    actor: string,
    changes: readonly Change[],
  ) => {
    if (changes.length === 0) return;
    // People added in the same save get the invitation only.
    const uids = after.participantIds.filter(
      (uid) => uid !== actor && before.participantIds.includes(uid),
    );
    await tell(
      after,
      uids,
      (uid) => changeKey(after, uid),
      (_uid, zone) =>
        [
          both(`Rapat "${after.title}" berubah.`, `The meeting "${after.title}" has changed.`),
          ...changes.map((c) => `${c.label}: ${c.from(zone)} → ${c.to(zone)}`),
          page(after),
        ].join("\n"),
    );
  };

  const run = (
    principal: Principal,
    id: string,
    version: number,
    step: (meeting: Meeting) => Meeting,
    audit: MeetingAudit,
  ) =>
    deps.meetings.write(
      id,
      version,
      (current) => {
        const meeting = current as Meeting;
        if (!canRunMeeting(principal, meeting)) {
          throw new RuleViolationError("Only the meeting's chair or secretary can do this.");
        }
        return step(meeting);
      },
      audit,
      deps.now(),
    );

  const save = createGuardedAction({
    permission: "meetings.edit",
    input: SaveMeeting,
    resource: async (input) =>
      input.id ? { orgUnitPath: (await load(input.id)).orgUnitPath } : unitScope(input.orgUnitId),
    handler: async (
      { id, version, notify, periodId, participants: people, ...input },
      principal,
      audit,
    ) => {
      const now = deps.now();
      let before = null as Meeting | null;
      const participants = await resolve(people);
      const times = meetingTimes(input);
      const unitPath = await unitScope(input.orgUnitId);
      if (!can(principal, "meetings.edit", unitPath)) {
        throw new RuleViolationError("You can only schedule meetings of your own unit.");
      }
      const saved = await deps.meetings.write(
        id ?? null,
        id ? version : null,
        (current): MeetingFields => {
          before = current;
          if (current) assertScheduled(current, now);
          else if (times.startsAt.getTime() < now.getTime()) {
            throw new RuleViolationError("The start time has passed.");
          }
          // Each stored item keeps its id at most once, so two items with the same title keep
          // two ids (and their notes) instead of collapsing into one.
          const unused = [...(current?.agenda ?? [])];
          const agenda = input.agenda.map((title, i) => {
            const kept = unused.findIndex((a) => a.title === title);
            const [match] = kept >= 0 ? unused.splice(kept, 1) : [];
            return { id: match?.id ?? `${i}-${deps.uuid()}`, title };
          });
          return {
            periodId: current?.periodId ?? periodId,
            title: input.title,
            description: input.description,
            orgUnitId: input.orgUnitId,
            orgUnitPath: unitPath.orgUnitPath as string[],
            startsAt: times.startsAt,
            endsAt: times.endsAt,
            timeZone: input.timeZone,
            agenda,
            participants,
            participantIds: participants.map((p) => p.uid),
            room: current?.room ?? { zoomRequestId: null, externalUrl: null },
            attendance: current?.attendance ?? {},
            cancelledAt: null,
            cancelReason: null,
            createdBy: current?.createdBy ?? principal.userId,
            minutes: current?.minutes ?? null,
            deletedAt: null,
          };
        },
        meetingAudit(audit, id ? "UPDATE" : "CREATE"),
        now,
      );
      // Invitations only for a meeting that has not started; the saver is never told.
      if (saved.startsAt.getTime() > now.getTime()) {
        await sendInvitations(
          saved,
          saved.participantIds.filter(
            (uid) => uid !== principal.userId && !before?.participantIds.includes(uid),
          ),
        );
      }
      if (before && notify) {
        await sendChange(before, saved, principal.userId, [
          ...instantChange("Mulai / Starts", before.startsAt, saved.startsAt),
          ...instantChange("Selesai / Ends", before.endsAt, saved.endsAt),
        ]);
      }
      return { id: saved.id, version: saved.version };
    },
  });

  const saveRoom = createGuardedAction({
    permission: "meetings.read",
    inSomeScope: true,
    input: SetRoom,
    handler: async ({ id, version, notify, room }, principal, audit) => {
      const now = deps.now();
      let before = null as Meeting | null;
      if (room.kind === "zoom") {
        const booking = await deps.zoomBooking(room.zoomRequestId);
        if (booking?.status !== "approved" || booking.meetingId !== id) {
          throw new RuleViolationError("Choose an approved Zoom booking made for this meeting.");
        }
      }
      const saved = await run(
        principal,
        id,
        version,
        (m) => {
          before = m;
          assertScheduled(m, now);
          return { ...m, room: setRoom(room) };
        },
        meetingAudit(audit, "UPDATE"),
      );
      if (before && notify) {
        const [old, current] = await Promise.all([
          roomDetails(before.room),
          roomDetails(saved.room),
        ]);
        await sendChange(before, saved, principal.userId, [
          ...textChange("Link", old.link, current.link),
          ...textChange("Passcode", old.passcode, current.passcode),
        ]);
      }
      return { version: saved.version };
    },
  });

  const cancel = createGuardedAction({
    permission: "meetings.read",
    inSomeScope: true,
    input: Cancel,
    handler: async ({ id, version, reason, notify }, principal, audit) => {
      const saved = await run(
        principal,
        id,
        version,
        (m) => cancelMeeting(m, reason, deps.now()),
        meetingAudit(audit, "UPDATE", false),
      );
      if (notify) {
        await tell(
          saved,
          saved.participantIds.filter((uid) => uid !== principal.userId),
          (uid) => noticeKey(saved, "cancel", uid),
          (_uid, zone) =>
            [
              both(
                `Rapat "${saved.title}" dibatalkan. Alasan: ${reason}`,
                `The meeting "${saved.title}" is cancelled. Reason: ${reason}`,
              ),
              `Waktu / Time: ${when(saved.startsAt, zone)}`,
              page(saved),
            ].join("\n"),
        );
      }
      return { version: saved.version };
    },
  });

  const mark = createGuardedAction({
    permission: "meetings.read",
    inSomeScope: true,
    input: Mark,
    handler: async ({ id, version, uid, present }, principal, audit) => {
      const now = deps.now();
      const saved = await run(
        principal,
        id,
        version,
        (m) => {
          if (now.getTime() < m.startsAt.getTime()) {
            throw new RuleViolationError("Attendance can be ticked once the meeting has started.");
          }
          return present ? markAttendance(m, uid, "manual", now) : unmarkAttendance(m, uid);
        },
        meetingAudit(audit, "UPDATE"),
      );
      return { version: saved.version };
    },
  });

  const openCode = createGuardedAction({
    permission: "meetings.read",
    inSomeScope: true,
    input: z.object({ id: safeId }).strict(),
    handler: async ({ id }, principal) => {
      const meeting = await load(id);
      if (!canRunMeeting(principal, meeting)) {
        throw new RuleViolationError("Only the meeting's chair or secretary can do this.");
      }
      if (meeting.cancelledAt) throw new RuleViolationError("This meeting is cancelled.");
      const code = attendanceCode(deps.randomBytes(8));
      const expiresAt = new Date(deps.now().getTime() + CODE_LIFETIME_MS);
      await deps.meetings.saveCode(code, meeting.id, expiresAt);
      return { code, expiresAt: expiresAt.toISOString(), url: `${deps.webUrl}/attend/${code}` };
    },
  });

  async function sendReminders(): Promise<{ meetings: number; messages: number }> {
    const now = deps.now();
    let messages = 0;
    const due = await deps.meetings.dueForReminders(now);
    for (const meeting of due) {
      const kind = dueReminder(meeting, now);
      if (!kind) continue;
      const facts = kind === "start" ? await factsOf(meeting) : null;
      messages += await tell(
        meeting,
        meeting.participantIds,
        (uid) => reminderKey(meeting, kind, uid),
        (uid, zone) =>
          kind === "start"
            ? [
                both(
                  `Rapat "${meeting.title}" segera dimulai. Isi presensi dengan kode di layar.`,
                  `The meeting "${meeting.title}" starts soon. Sign the attendance with the code on the screen.`,
                ),
                ...(facts?.(zone) ?? []),
                ...(runsMeeting(meeting, uid)
                  ? [
                      both(
                        "Buka presensi di halaman rapat.",
                        "Open the attendance on the meeting page.",
                      ),
                    ]
                  : []),
                page(meeting),
              ].join("\n")
            : `${both(
                `Rapat "${meeting.title}" sudah selesai. Pastikan presensi dan notulen lengkap.`,
                `The meeting "${meeting.title}" has ended. Make sure attendance and minutes are complete.`,
              )}\n\n${meeting.room.externalUrl ?? page(meeting)}`,
      );
    }
    return { meetings: due.length, messages };
  }

  return { save, saveRoom, cancel, mark, openCode, sendReminders };
}
