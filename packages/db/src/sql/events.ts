import type { Database, Transaction } from "./store";
import type { Snapshot } from "@website/audit";
import {
  assertAttendanceMode,
  isLive,
  isRegistrationOpen,
  nextRegistrationStatus,
  registrationId,
  toPublicEvent,
  type EventEntity,
  type AttendanceMode,
  type EventImage,
  type EventRegistrationSetup,
  type EventType,
  type PublicEvent,
  type RegistrationDetails,
  type RegistrationStatus,
  type ScheduleRow,
  type Speaker,
  type Sponsor,
} from "@website/domain/events";
import { RuleViolationError } from "@website/domain/shared";
import { safeId } from "@website/security/validation";
import { getDocumentsByIds } from "./batch";
import { createSluggedStore, toDate } from "./slugged";

export interface RegistrantRow {
  readonly userId: string;
  readonly status: RegistrationStatus;
  readonly attendanceMode: AttendanceMode | null;
  readonly registeredAt: Date;
}

export type EventFields = Omit<EventEntity, "id" | "version" | "createdAt" | "updatedAt">;

function toEvent(id: string, data: Record<string, unknown>): EventEntity {
  return {
    id,
    slug: data["slug"] as string,
    title: data["title"] as string,
    summary: data["summary"] as string | null,
    startsAt: toDate(data["startsAt"]) as Date,
    endsAt: toDate(data["endsAt"]),
    timezone: data["timezone"] as string,
    location: data["location"] as string | null,
    chapterId: data["chapterId"] as string | null,
    published: data["published"] as boolean,
    capacity: data["capacity"] as number | null,
    registrationClosesAt: toDate(data["registrationClosesAt"]),
    type: data["type"] as EventType,
    description: data["description"] as string,
    bannerImage: data["bannerImage"] as EventImage | null,
    registrationUrl: data["registrationUrl"] as string | null,
    schedule: data["schedule"] as ScheduleRow[],
    speakers: data["speakers"] as Speaker[],
    sponsors: data["sponsors"] as Sponsor[],
    publishAt: toDate(data["publishAt"]),
    approvalRequestedAt: toDate(data["approvalRequestedAt"]),
    approvalRequestedBy: (data["approvalRequestedBy"] as string | undefined) ?? null,
    approvedAt: toDate(data["approvedAt"]),
    approvedBy: (data["approvedBy"] as string | undefined) ?? null,
    rejectionNote: (data["rejectionNote"] as string | undefined) ?? null,
    cancelledAt: toDate(data["cancelledAt"]),
    cancelReason: (data["cancelReason"] as string | undefined) ?? null,
    finalAttendance: (data["finalAttendance"] as number | undefined) ?? null,
    attendanceNote: (data["attendanceNote"] as string | undefined) ?? null,
    recapUrl: (data["recapUrl"] as string | undefined) ?? null,
    registration: (data["registration"] as EventRegistrationSetup | null | undefined) ?? null,
    version: data["version"] as number,
    createdAt: toDate(data["createdAt"]) as Date,
    updatedAt: toDate(data["updatedAt"]) as Date,
    deletedAt: toDate(data["deletedAt"]),
  };
}

const iso = (date: Date | null) => (date ? date.toISOString() : null);

export function eventSnapshot(e: EventFields): Snapshot {
  return {
    slug: e.slug,
    title: e.title,
    summary: e.summary,
    startsAt: iso(e.startsAt),
    endsAt: iso(e.endsAt),
    timezone: e.timezone,
    location: e.location,
    published: e.published,
    capacity: e.capacity,
    registrationClosesAt: iso(e.registrationClosesAt),
    type: e.type,
    description: e.description,
    bannerImage: e.bannerImage ? { ...e.bannerImage } : null,
    registrationUrl: e.registrationUrl,
    schedule: e.schedule.map((row) => ({ ...row })),
    speakers: e.speakers.map((s) => ({ ...s, photo: s.photo ? { ...s.photo } : null })),
    sponsors: e.sponsors.map((s) => ({ ...s, logo: s.logo ? { ...s.logo } : null })),
    publishAt: iso(e.publishAt),
    approvalRequestedAt: iso(e.approvalRequestedAt),
    approvalRequestedBy: e.approvalRequestedBy,
    approvedAt: iso(e.approvedAt),
    approvedBy: e.approvedBy,
    rejectionNote: e.rejectionNote,
    cancelledAt: iso(e.cancelledAt),
    cancelReason: e.cancelReason,
    finalAttendance: e.finalAttendance,
    attendanceNote: e.attendanceNote,
    recapUrl: e.recapUrl,
    registration: e.registration
      ? {
          formId: e.registration.formId,
          attendanceModes: [...e.registration.attendanceModes],
          showOnTicket: e.registration.showOnTicket,
          shortUrl: e.registration.shortUrl,
        }
      : null,
  };
}

export function createSqlEventStore(db: Database) {
  const store = createSluggedStore<EventEntity>(db, {
    collection: "events",
    slug: { collection: "eventSlugs", key: (e) => e.slug },
    fromDoc: toEvent,
    snapshot: eventSnapshot,
    fixed: (e) => ({ chapterId: e.chapterId }),
  });

  return {
    async listForAdmin(limit = 500): Promise<EventEntity[]> {
      const snapshot = await store.docs.orderBy("updatedAt", "desc").limit(limit).get();
      return snapshot.docs
        .map((doc) => store.read(doc.id, doc.data()))
        .filter((e) => e.deletedAt === null);
    },
    get: store.get,
    findBySlug: (slug: string) => store.findBySlugKey(slug),
    write: store.write,
  };
}

export type SqlEventStore = ReturnType<typeof createSqlEventStore>;

export function createSqlEventReader(db: Database) {
  const store = createSqlEventStore(db);
  return {
    async listPublished(limit = 300, now = new Date()): Promise<PublicEvent[]> {
      const snapshot = await db
        .collection("events")
        .where("published", "==", true)
        .orderBy("startsAt", "desc")
        .limit(limit)
        .get();
      return snapshot.docs
        .map((doc) => toEvent(doc.id, doc.data()))
        .filter((e) => isLive(e, now))
        .map(toPublicEvent);
    },

    async findPublishedBySlug(slug: string, now = new Date()): Promise<PublicEvent | null> {
      const event = await store.findBySlug(slug);
      return event && isLive(event, now) ? toPublicEvent(event) : null;
    },
  };
}

export type SqlEventReader = ReturnType<typeof createSqlEventReader>;

export function createSqlRegistrationStore(db: Database) {
  const registrationsRef = db.collection("eventRegistrations");
  const store = {
    /**
     * The registration itself, inside a transaction of the caller: the wizard writes the form response in
     * the same one (N1.2). An event that asks questions refuses a registration without them.
     */
    async registerIn(
      tx: Transaction,
      eventId: string,
      userId: string,
      now: Date,
      details: RegistrationDetails | null = null,
    ): Promise<{ status: RegistrationStatus; created: boolean }> {
      const eventSnap = await tx.get(db.collection("events").doc(safeId.parse(eventId)));
      const event = eventSnap.exists ? toEvent(eventSnap.id, eventSnap.data()!) : null;
      if (!event || !isRegistrationOpen(event, now)) {
        throw new RuleViolationError("Registration is closed.");
      }
      if (event.registration && details === null) {
        throw new RuleViolationError("This event asks questions: register on its form page.");
      }
      if (!event.registration && details !== null) {
        throw new RuleViolationError("This event has no registration form.");
      }
      if (event.registration) assertAttendanceMode(event.registration, details!.attendanceMode);
      const ref = registrationsRef.doc(safeId.parse(registrationId(eventId, userId)));
      const existing = await tx.get(ref);
      if (existing.exists) {
        return { status: existing.get("status") as RegistrationStatus, created: false };
      }
      const counterRef = db.collection("eventCounters").doc(eventId);
      const counter = await tx.get(counterRef);
      const confirmed = (counter.get("confirmed") as number | undefined) ?? 0;
      const waitlisted = (counter.get("waitlisted") as number | undefined) ?? 0;
      const status = nextRegistrationStatus(event, confirmed);
      tx.set(ref, {
        eventId,
        userId,
        status,
        createdAt: now,
        updatedAt: now,
        ...(details ?? {}),
      });
      tx.set(
        counterRef,
        status === "confirmed"
          ? { confirmed: confirmed + 1, waitlisted }
          : { confirmed, waitlisted: waitlisted + 1 },
      );
      return { status, created: true };
    },

    register(
      eventId: string,
      userId: string,
      now: Date,
    ): Promise<{ status: RegistrationStatus; created: boolean }> {
      return db.runTransaction((tx) => store.registerIn(tx, eventId, userId, now));
    },

    /** The questions an event asks, for the wizard (null = one-click registration). */
    async setupOf(eventId: string): Promise<EventRegistrationSetup | null> {
      if (!safeId.safeParse(eventId).success) return null;
      const snap = await db.collection("events").doc(eventId).get();
      return snap.exists ? toEvent(snap.id, snap.data()!).registration : null;
    },

    /** Everyone registered for an event, oldest first, for the admin registrants list. */
    async listForEvent(eventId: string): Promise<RegistrantRow[]> {
      const snapshot = await registrationsRef.where("eventId", "==", safeId.parse(eventId)).get();
      return snapshot.docs
        .map((doc) => ({
          userId: doc.get("userId") as string,
          status: doc.get("status") as RegistrationStatus,
          attendanceMode: (doc.get("attendanceMode") as AttendanceMode | undefined) ?? null,
          registeredAt: toDate(doc.get("createdAt")) as Date,
        }))
        .sort((a, b) => a.registeredAt.getTime() - b.registeredAt.getTime());
    },

    /** Who is told when an event is cancelled: everyone who still holds a place or a waitlist spot. */
    async activeUserIds(eventId: string): Promise<string[]> {
      const snapshot = await registrationsRef.where("eventId", "==", safeId.parse(eventId)).get();
      return snapshot.docs
        .filter((doc) => doc.get("status") !== "cancelled")
        .map((doc) => doc.get("userId") as string);
    },

    async listByUser(
      userId: string,
    ): Promise<Array<{ status: RegistrationStatus; event: PublicEvent }>> {
      const snapshot = await registrationsRef.where("userId", "==", userId).get();
      const rows = snapshot.docs.map((doc) => ({
        eventId: doc.get("eventId") as string,
        status: doc.get("status") as RegistrationStatus,
      }));
      const events = await getDocumentsByIds<Record<string, unknown>>(
        db,
        "events",
        rows.map((r) => r.eventId),
      );
      return rows
        .flatMap((r) => {
          const data = events.get(r.eventId);
          const event = data ? toEvent(r.eventId, data) : null;
          return event && event.deletedAt === null
            ? [{ status: r.status, event: toPublicEvent(event) }]
            : [];
        })
        .sort((a, b) => b.event.startsAt.getTime() - a.event.startsAt.getTime());
    },
  };
  return store;
}

export type SqlRegistrationStore = ReturnType<typeof createSqlRegistrationStore>;
