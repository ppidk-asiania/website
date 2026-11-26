import "server-only";
import { z } from "zod";
import type { SqlEventStore } from "@website/db/sql";
import {
  EventAfterSchema,
  EventInputSchema,
  approvalToPublish,
  approveEvent,
  askForApproval,
  assertPublishAt,
  cancelEvent,
  isPast,
  randomEventSlug,
  rejectEvent,
  type EventEntity,
} from "@website/domain/events";
import { RuleViolationError } from "@website/domain/shared";
import { can } from "@website/permissions";
import { safeId, safeText } from "@website/security/validation";
import { createGuardedAction, type AuditBuilder } from "./guarded-action";

/** Who is told about a step of the life cycle; failures are logged by the implementation, never thrown. */
export interface EventNotifier {
  approvalAsked(event: EventEntity): Promise<void>;
  approvalDecided(event: EventEntity, approved: boolean, askedBy: string | null): Promise<void>;
  cancelled(event: EventEntity): Promise<void>;
}

export interface EventDeps {
  readonly events: Pick<SqlEventStore, "write">;
  readonly notify: EventNotifier;
  /** Frees the equipment the event had reserved (N7.3). */
  readonly releaseReservations: (eventId: string, now: Date) => Promise<unknown>;
  readonly now: () => Date;
  readonly uuid: () => string;
}

const publishAt = z.coerce.date().nullable().optional();
const SaveInput = EventInputSchema.and(
  z
    .object({
      id: safeId.optional(),
      version: z.number().int().min(1).nullable(),
      publish: z.boolean(),
      publishAt,
    })
    .strict(),
);
const RefInput = z.object({ id: safeId, version: z.number().int().min(1) }).strict();
const reason = safeText(500, { multiline: true }).pipe(
  z.string().min(3, "Write a short reason (at least 3 characters)."),
);

type Action = "CREATE" | "UPDATE" | "PUBLISH" | "UNPUBLISH" | "DELETE";

export const eventAudit =
  (audit: AuditBuilder, action: Action, revertible = true) =>
  (
    before: Parameters<AuditBuilder>[0]["before"],
    after: Parameters<AuditBuilder>[0]["after"],
    current: EventEntity | null,
    next: EventEntity,
  ) =>
    audit({
      module: "events",
      action,
      resourceType: "event",
      resourceId: next.id,
      title: next.title,
      before,
      after,
      versionBefore: current?.version ?? null,
      versionAfter: next.version,
      revertible,
    });

/** The life-cycle fields a form save leaves as they are. */
const kept = (current: EventEntity | null) => ({
  approvalRequestedAt: current?.approvalRequestedAt ?? null,
  approvalRequestedBy: current?.approvalRequestedBy ?? null,
  approvedAt: current?.approvedAt ?? null,
  approvedBy: current?.approvedBy ?? null,
  rejectionNote: current?.rejectionNote ?? null,
  cancelledAt: current?.cancelledAt ?? null,
  cancelReason: current?.cancelReason ?? null,
  finalAttendance: current?.finalAttendance ?? null,
  attendanceNote: current?.attendanceNote ?? null,
  recapUrl: current?.recapUrl ?? null,
  registration: current?.registration ?? null,
  fee: current?.fee ?? null,
});

export function createEventActions(deps: EventDeps) {
  const save = createGuardedAction({
    permission: "events.edit",
    input: SaveInput,
    handler: async (input, principal, audit) => {
      const now = deps.now();
      let action: Action = "CREATE";
      let revertible = true;
      const saved = await deps.events.write(
        input.id ?? null,
        input.version,
        (current) => {
          const slug = input.slug || current?.slug || randomEventSlug(deps.uuid());
          if (current) {
            action = input.publish && !current.published ? "PUBLISH" : "UPDATE";
            revertible = current.slug === slug;
          }
          const at = input.publish
            ? input.publishAt === undefined
              ? (current?.publishAt ?? null)
              : input.publishAt
            : null;
          assertPublishAt(at, input.startsAt);
          // An event that is already public stays public: the approval is for the idea (DEC-25).
          const approval =
            input.publish && !current?.published
              ? approvalToPublish(current, can(principal, "events.publish"), principal.userId, now)
              : null;
          return {
            ...kept(current),
            ...approval,
            slug,
            title: input.title,
            summary: current?.summary ?? null,
            startsAt: input.startsAt,
            endsAt: current?.endsAt ?? null,
            timezone: input.timezone,
            location: input.location,
            chapterId: current?.chapterId ?? null,
            published: input.publish,
            publishAt: at,
            capacity: current?.capacity ?? null,
            registrationClosesAt: input.registrationClosesAt,
            type: input.type,
            description: input.description,
            bannerImage: input.bannerImage,
            registrationUrl: input.registrationUrl,
            schedule: input.schedule,
            speakers: input.speakers,
            sponsors: input.sponsors.map((s, i) => ({ ...s, order: i + 1 })),
            deletedAt: null,
          };
        },
        (before, after, current, next) =>
          eventAudit(audit, action, revertible)(before, after, current, next),
        now,
      );
      return { id: saved.id, slug: saved.slug, version: saved.version };
    },
  });

  const setPublished = createGuardedAction({
    permission: "events.edit",
    input: RefInput.extend({ published: z.boolean(), publishAt }).strict(),
    handler: async ({ id, version, published, publishAt: requested }, principal, audit) => {
      const now = deps.now();
      const saved = await deps.events.write(
        id,
        version,
        (current) => {
          const event = current as EventEntity;
          const at = published ? (requested ?? null) : null;
          assertPublishAt(at, event.startsAt);
          const approval = published
            ? approvalToPublish(event, can(principal, "events.publish"), principal.userId, now)
            : null;
          return { ...event, ...approval, published, publishAt: at };
        },
        eventAudit(audit, published ? "PUBLISH" : "UNPUBLISH"),
        now,
      );
      return { version: saved.version };
    },
  });

  const requestApproval = createGuardedAction({
    permission: "events.edit",
    input: RefInput,
    handler: async ({ id, version }, principal, audit) => {
      const now = deps.now();
      const saved = await deps.events.write(
        id,
        version,
        (current) => {
          const event = current as EventEntity;
          return { ...event, ...askForApproval(event, principal.userId, now) };
        },
        eventAudit(audit, "UPDATE"),
        now,
      );
      await deps.notify.approvalAsked(saved);
      return { version: saved.version };
    },
  });

  const approve = createGuardedAction({
    permission: "events.publish",
    input: RefInput,
    handler: async ({ id, version }, principal, audit) => {
      const now = deps.now();
      let askedBy: string | null = null;
      const saved = await deps.events.write(
        id,
        version,
        (current) => {
          const event = current as EventEntity;
          askedBy = event.approvalRequestedBy;
          return { ...event, ...approveEvent(event, principal.userId, now) };
        },
        eventAudit(audit, "UPDATE"),
        now,
      );
      await deps.notify.approvalDecided(saved, true, askedBy);
      return { version: saved.version };
    },
  });

  const reject = createGuardedAction({
    permission: "events.publish",
    input: RefInput.extend({ note: reason }).strict(),
    handler: async ({ id, version, note }, _principal, audit) => {
      const now = deps.now();
      let askedBy: string | null = null;
      const saved = await deps.events.write(
        id,
        version,
        (current) => {
          const event = current as EventEntity;
          askedBy = event.approvalRequestedBy;
          return { ...event, ...rejectEvent(event, note) };
        },
        eventAudit(audit, "UPDATE"),
        now,
      );
      await deps.notify.approvalDecided(saved, false, askedBy);
      return { version: saved.version };
    },
  });

  const cancel = createGuardedAction({
    permission: "events.edit",
    input: RefInput.extend({ reason }).strict(),
    handler: async ({ id, version, reason: why }, _principal, audit) => {
      const now = deps.now();
      const saved = await deps.events.write(
        id,
        version,
        (current) => {
          const event = current as EventEntity;
          return { ...event, ...cancelEvent(event, why, now) };
        },
        eventAudit(audit, "UPDATE"),
        now,
      );
      await deps.notify.cancelled(saved);
      return { version: saved.version };
    },
  });

  const saveAfter = createGuardedAction({
    permission: "events.edit",
    input: RefInput.extend(EventAfterSchema.shape).strict(),
    handler: async ({ id, version, ...after }, _principal, audit) => {
      const now = deps.now();
      const saved = await deps.events.write(
        id,
        version,
        (current) => {
          const event = current as EventEntity;
          if (!isPast(event, now)) throw new RuleViolationError("Fill this in after the event.");
          return { ...event, ...after };
        },
        eventAudit(audit, "UPDATE"),
        now,
      );
      return { version: saved.version };
    },
  });

  const remove = createGuardedAction({
    permission: "events.edit",
    input: RefInput,
    handler: async ({ id, version }, _principal, audit) => {
      const now = deps.now();
      await deps.events.write(
        id,
        version,
        (current) => ({ ...(current as EventEntity), deletedAt: now }),
        eventAudit(audit, "DELETE"),
        now,
      );
      await deps.releaseReservations(id, now);
      return { id };
    },
  });

  return {
    save,
    setPublished,
    requestApproval,
    approve,
    reject,
    cancel,
    saveAfter,
    remove,
  };
}
