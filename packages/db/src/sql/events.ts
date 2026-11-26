import type { Database, Transaction } from "./store";
import type { AuditEvent, Snapshot } from "@website/audit";
import {
  assertAttendanceMode,
  canUndoCheckIn,
  checkInOutcome,
  type CheckInMethod,
  type CheckInOutcome,
  assertCategoryOpen,
  assertFeeReady,
  assertNotOwnPayment,
  canSendProof,
  feeAmount,
  findCategory,
  isLive,
  isRegistrationOpen,
  nextRegistrationStatus,
  registrationId,
  toPublicEvent,
  type EventEntity,
  type AttendanceMode,
  type EventFee,
  type EventImage,
  type PaymentState,
  type EventRegistrationSetup,
  type EventType,
  type PublicEvent,
  type RegistrationDetails,
  type RegistrationStatus,
  type ScheduleRow,
  type Speaker,
  type Sponsor,
} from "@website/domain/events";
import { cashEntryFromEventPayment, type CashEntry } from "@website/domain/finance";
import { RuleViolationError } from "@website/domain/shared";
import { safeId } from "@website/security/validation";
import { getDocumentsByIds } from "./batch";
import { createSqlAuditWriter } from "./audit";
import { cashEntrySnapshot, storedEntry } from "./finance";
import { createSluggedStore, toDate } from "./slugged";

export interface RegistrantRow {
  readonly userId: string;
  readonly status: RegistrationStatus;
  readonly attendanceMode: AttendanceMode | null;
  readonly registeredAt: Date;
  /** Paid events only (N1.3); `not_required` for a free one. */
  readonly payment: PaymentState;
  readonly feeCategory: string | null;
  readonly hasProof: boolean;
  readonly paymentNote: string | null;
  /** Marked present (N1.4): when, and how (self, scan or manual). */
  readonly checkedInAt: Date | null;
  readonly checkedInBy: string | null;
  readonly checkInMethod: CheckInMethod | null;
  /** Set once verified: the amount frozen at that moment. */
  readonly amountMinor: number | null;
}

/** A proof file kept with the registration: a private file, image or PDF. */
export interface PaymentProof {
  readonly path: string;
  readonly type: "pdf" | "jpeg" | "png" | "webp";
}

export type CheckInAudit = (before: Snapshot, after: Snapshot) => AuditEvent;

/** What a scan or a manual check-in found, for the card the door staff reads. */
export interface CheckInResult {
  readonly outcome: CheckInOutcome;
  readonly userId: string | null;
  readonly category: string | null;
  /** When the person was (or already had been) checked in. */
  readonly at: Date | null;
}

const checkInSnapshot = (doc: { get(field: string): unknown }): Snapshot => ({
  status: doc.get("status") as string,
  checkedInAt: toDate(doc.get("checkedInAt"))?.toISOString() ?? null,
  checkInMethod: (doc.get("checkInMethod") as string | undefined) ?? null,
});

export type PaymentAudit = (before: Snapshot, after: Snapshot) => AuditEvent;
export type PaymentCashAudit = (after: Snapshot, entry: CashEntry) => AuditEvent;

export type EventFields = Omit<EventEntity, "id" | "version" | "createdAt" | "updatedAt">;

function toFee(value: unknown): EventFee | null {
  const fee = value as (Omit<EventFee, "earlyUntil"> & { earlyUntil: unknown }) | null | undefined;
  return fee ? { ...fee, earlyUntil: toDate(fee.earlyUntil) } : null;
}

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
    fee: toFee(data["fee"]),
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
    fee: e.fee
      ? {
          ...e.fee,
          categories: e.fee.categories.map((c) => ({ ...c })),
          earlyUntil: iso(e.fee.earlyUntil),
          payImage: e.fee.payImage ? { ...e.fee.payImage } : null,
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

    /** An event for the ticket page of someone registered for it: its fee (null = free) and what the ticket prints (N1.4). */
    async findTicketEvent(
      slug: string,
      now = new Date(),
    ): Promise<{ event: PublicEvent; fee: EventFee | null; showOnTicket: string } | null> {
      const event = await store.findBySlug(slug);
      return event && isLive(event, now)
        ? {
            event: toPublicEvent(event),
            fee: event.fee?.paid ? event.fee : null,
            showOnTicket: event.registration?.showOnTicket ?? "",
          }
        : null;
    },

    /** A paid event with its payment instructions: shown to the people registered for it only (N1.3). */
    async findPaymentGuide(
      slug: string,
      now = new Date(),
    ): Promise<{ event: PublicEvent; fee: EventFee } | null> {
      const event = await store.findBySlug(slug);
      return event && isLive(event, now) && event.fee?.paid
        ? { event: toPublicEvent(event), fee: event.fee }
        : null;
    },
  };
}

export type SqlEventReader = ReturnType<typeof createSqlEventReader>;

const paymentSnapshot = (doc: { get(field: string): unknown }): Snapshot => ({
  status: doc.get("status") as string,
  payment: (doc.get("payment") as string | undefined) ?? null,
  paymentNote: (doc.get("paymentNote") as string | undefined) ?? null,
  amountMinor: (doc.get("amountMinor") as number | undefined) ?? null,
  feeCategory: (doc.get("feeCategory") as string | undefined) ?? null,
});

const paymentFields = (doc: { get(field: string): unknown }) => ({
  payment: (doc.get("payment") as PaymentState | undefined) ?? "not_required",
  feeCategory: (doc.get("feeCategory") as string | undefined) ?? null,
  hasProof: Boolean(doc.get("proof")),
  paymentNote: (doc.get("paymentNote") as string | undefined) ?? null,
  amountMinor: (doc.get("amountMinor") as number | undefined) ?? null,
  checkedInAt: toDate(doc.get("checkedInAt")),
  checkedInBy: (doc.get("checkedInBy") as string | undefined) ?? null,
  checkInMethod: (doc.get("checkInMethod") as CheckInMethod | undefined) ?? null,
});

export function createSqlRegistrationStore(db: Database) {
  const registrationsRef = db.collection("eventRegistrations");
  const cash = db.collection("cashEntries");
  const audit = createSqlAuditWriter(db);
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
      const fee = event.fee?.paid ? event.fee : null;
      if (fee && !event.registration) {
        throw new RuleViolationError("This paid event registers on its form page.");
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
      const held = (counter.get("categories") as Record<string, number> | undefined) ?? {};
      const category = fee ? (assertFeeReady(fee), findCategory(fee, details!.feeCategory)) : null;
      if (!fee && details?.feeCategory) {
        throw new RuleViolationError("This event has no ticket categories.");
      }
      if (category) assertCategoryOpen(category, held[category.id] ?? 0);
      const seat = nextRegistrationStatus(event, confirmed);
      // A paid event holds the seat as `pending` until the payment is verified (DEC-26).
      const status = category && seat === "confirmed" ? "pending" : seat;
      tx.set(ref, {
        eventId,
        userId,
        status,
        createdAt: now,
        updatedAt: now,
        ...(details ?? {}),
        ...(category ? { payment: status === "pending" ? "unpaid" : "not_required" } : {}),
      });
      const seated = seat === "confirmed";
      tx.set(counterRef, {
        confirmed: seated ? confirmed + 1 : confirmed,
        waitlisted: seated ? waitlisted : waitlisted + 1,
        categories:
          category && seated ? { ...held, [category.id]: (held[category.id] ?? 0) + 1 } : held,
      });
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
          ...paymentFields(doc),
        }))
        .sort((a, b) => a.registeredAt.getTime() - b.registeredAt.getTime());
    },

    /** The person's own registration, for the ticket page (null = not registered). */
    async ownRegistration(eventId: string, userId: string) {
      const snap = await registrationsRef.doc(safeId.parse(registrationId(eventId, userId))).get();
      if (!snap.exists) return null;
      return {
        status: snap.get("status") as RegistrationStatus,
        registeredAt: toDate(snap.get("createdAt")) as Date,
        ...paymentFields(snap),
      };
    },

    /** The proof is kept with the registration; a re-send replaces it (the old path is returned to delete). */
    submitProof(
      eventId: string,
      userId: string,
      proof: PaymentProof,
      now: Date,
    ): Promise<{ replaced: string | null }> {
      return db.runTransaction(async (tx) => {
        const ref = registrationsRef.doc(safeId.parse(registrationId(eventId, userId)));
        const snap = await tx.get(ref);
        const state = snap.get("payment") as PaymentState | undefined;
        if (!snap.exists || snap.get("status") !== "pending" || !state || !canSendProof(state)) {
          throw new RuleViolationError("There is no payment waiting for a proof.");
        }
        const before = snap.get("proof") as { path: string } | undefined;
        tx.update(ref, {
          proof: { ...proof, uploadedAt: now },
          payment: "submitted",
          paymentNote: null,
          updatedAt: now,
        });
        return { replaced: before?.path ?? null };
      });
    },

    /** The private file of a registration's proof, for the checker. */
    async proofOf(id: string): Promise<PaymentProof | null> {
      const snap = await registrationsRef.doc(safeId.parse(id)).get();
      return (snap.get("proof") as PaymentProof | undefined) ?? null;
    },

    /** Proofs waiting for a check (the dashboard queue). */
    async listSubmitted(): Promise<Array<{ id: string; eventId: string; at: Date }>> {
      const snapshot = await registrationsRef.where("payment", "==", "submitted").get();
      return snapshot.docs.map((doc) => ({
        id: doc.id,
        eventId: doc.get("eventId") as string,
        at: toDate(doc.get("updatedAt")) as Date,
      }));
    },

    /**
     * Verify: the registration becomes confirmed with the amount frozen, and the cash book gets ONE income
     * line (its id is the registration id), in the same transaction. A second verify writes nothing (DEC-26).
     */
    verifyPayment(
      id: string,
      verifiedBy: string,
      now: Date,
      auditFor: PaymentAudit,
      cashAuditFor: PaymentCashAudit,
    ): Promise<{ changed: boolean; eventId: string; userId: string }> {
      return db.runTransaction(async (tx) => {
        const ref = registrationsRef.doc(safeId.parse(id));
        const snap = await tx.get(ref);
        if (!snap.exists) throw new RuleViolationError("This registration does not exist.");
        const eventId = snap.get("eventId") as string;
        const userId = snap.get("userId") as string;
        if (snap.get("payment") === "verified") return { changed: false, eventId, userId };
        if (snap.get("payment") !== "submitted") {
          throw new RuleViolationError("There is no proof to check yet.");
        }
        assertNotOwnPayment(verifiedBy, userId);
        const eventSnap = await tx.get(db.collection("events").doc(safeId.parse(eventId)));
        const event = eventSnap.exists ? toEvent(eventSnap.id, eventSnap.data()!) : null;
        if (!event?.fee?.paid) throw new RuleViolationError("This event is not a paid event.");
        const active = await tx.get(db.collection("settings").doc("activePeriod"));
        const periodId = active.get("periodId") as string | undefined;
        if (!periodId) throw new RuleViolationError("Activate a board period first.");
        if ((await tx.get(cash.doc(ref.id))).exists) {
          throw new RuleViolationError("This payment is already in the cash book.");
        }
        const log = await audit.begin(tx);
        const category = findCategory(event.fee, snap.get("feeCategory") as string);
        const amountMinor = feeAmount(
          event.fee,
          category.id,
          toDate(snap.get("createdAt")) as Date,
        );
        const before = paymentSnapshot(snap);
        const next = {
          status: "confirmed",
          payment: "verified",
          amountMinor,
          currency: event.fee.currency,
          reviewedBy: verifiedBy,
          reviewedAt: now,
          updatedAt: now,
        };
        tx.update(ref, next);
        log.append(
          auditFor(before, {
            ...before,
            status: "confirmed",
            payment: "verified",
            amountMinor,
            reviewedBy: verifiedBy,
            reviewedAt: now.toISOString(),
          }),
        );
        const entry = cashEntryFromEventPayment({
          registrationId: ref.id,
          periodId,
          title: `${event.title}: ${category.label}`,
          amountMinor,
          currency: event.fee.currency,
          at: now,
          verifiedBy,
        });
        tx.create(cash.doc(entry.id), storedEntry(entry));
        log.append(cashAuditFor(cashEntrySnapshot(entry), entry));
        return { changed: true, eventId, userId };
      });
    },

    /** Reject with a note; the person may send another proof. */
    rejectPayment(
      id: string,
      reviewedBy: string,
      note: string,
      now: Date,
      auditFor: PaymentAudit,
    ): Promise<{ eventId: string; userId: string }> {
      return db.runTransaction(async (tx) => {
        const ref = registrationsRef.doc(safeId.parse(id));
        const snap = await tx.get(ref);
        if (!snap.exists || snap.get("payment") !== "submitted") {
          throw new RuleViolationError("There is no proof to check.");
        }
        const userId = snap.get("userId") as string;
        assertNotOwnPayment(reviewedBy, userId);
        const log = await audit.begin(tx);
        const before = paymentSnapshot(snap);
        tx.update(ref, {
          payment: "rejected",
          paymentNote: note,
          reviewedBy,
          reviewedAt: now,
          updatedAt: now,
        });
        log.append(auditFor(before, { ...before, payment: "rejected", paymentNote: note }));
        return { eventId: snap.get("eventId") as string, userId };
      });
    },

    /**
     * The ticket page stores the HASH of the member's ticket token (the token itself is never stored).
     * Only a confirmed registration has a ticket; the call is idempotent.
     */
    async setTicketHash(eventId: string, userId: string, hash: string): Promise<void> {
      await db.runTransaction(async (tx) => {
        const ref = registrationsRef.doc(safeId.parse(registrationId(eventId, userId)));
        const snap = await tx.get(ref);
        if (!snap.exists || snap.get("status") !== "confirmed") return;
        if (snap.get("ticketHash") !== hash) tx.update(ref, { ticketHash: hash });
      });
    },

    /** The registration that owns a ticket hash (null: no such ticket). */
    async findByTicketHash(
      hash: string,
    ): Promise<{ id: string; eventId: string; userId: string } | null> {
      const snapshot = await registrationsRef.where("ticketHash", "==", hash).limit(1).get();
      const doc = snapshot.docs[0];
      return doc
        ? { id: doc.id, eventId: doc.get("eventId") as string, userId: doc.get("userId") as string }
        : null;
    },

    /**
     * Marks a registration present. Only a confirmed (and, when paid, verified) registration of THIS event
     * can enter; everything else answers with its reason and writes nothing.
     */
    checkIn(
      id: string,
      eventId: string,
      by: string,
      method: CheckInMethod,
      now: Date,
      auditFor: CheckInAudit,
      /** Practice: the card is shown but nothing is stored. */
      practice = false,
    ): Promise<CheckInResult> {
      return db.runTransaction(async (tx) => {
        const ref = registrationsRef.doc(safeId.parse(id));
        const snap = await tx.get(ref);
        if (!snap.exists || snap.get("eventId") !== eventId) {
          return { outcome: "unknown", userId: null, category: null, at: null };
        }
        const fields = paymentFields(snap);
        const outcome = checkInOutcome({
          status: snap.get("status") as RegistrationStatus,
          payment: fields.payment,
          checkedInAt: fields.checkedInAt,
        });
        const result = {
          outcome,
          userId: snap.get("userId") as string,
          category: fields.feeCategory,
          at: outcome === "checked_in" ? now : fields.checkedInAt,
        };
        if (outcome !== "checked_in" || practice) return result;
        const log = await audit.begin(tx);
        const before = checkInSnapshot(snap);
        tx.update(ref, {
          checkedIn: true,
          checkedInAt: now,
          checkedInBy: by,
          checkInMethod: method,
          updatedAt: now,
        });
        log.append(
          auditFor(before, { ...before, checkedInAt: now.toISOString(), checkInMethod: method }),
        );
        return result;
      });
    },

    /** Undo: the person who checked in for 10 minutes, a holder of `registrants.edit` at any time. */
    undoCheckIn(
      id: string,
      eventId: string,
      actor: { userId: string; canEditRegistrants: boolean },
      now: Date,
      auditFor: CheckInAudit,
    ): Promise<{ userId: string }> {
      return db.runTransaction(async (tx) => {
        const ref = registrationsRef.doc(safeId.parse(id));
        const snap = await tx.get(ref);
        const at = snap.exists ? toDate(snap.get("checkedInAt")) : null;
        if (!snap.exists || snap.get("eventId") !== eventId || !at) {
          throw new RuleViolationError("This person is not checked in.");
        }
        const by = (snap.get("checkedInBy") as string | undefined) ?? null;
        if (!canUndoCheckIn({ by, at }, actor, now)) {
          throw new RuleViolationError(
            "Only the person who checked this one in can undo it, within 10 minutes.",
          );
        }
        const log = await audit.begin(tx);
        const before = checkInSnapshot(snap);
        tx.update(ref, {
          checkedIn: false,
          checkedInAt: null,
          checkedInBy: null,
          checkInMethod: null,
          updatedAt: now,
        });
        log.append(auditFor(before, { ...before, checkedInAt: null, checkInMethod: null }));
        return { userId: snap.get("userId") as string };
      });
    },

    /** People present per event, for the sponsorship reach when the organisers entered no final number. */
    async checkedInCounts(): Promise<Map<string, number>> {
      const snapshot = await registrationsRef.where("checkedIn", "==", true).get();
      const counts = new Map<string, number>();
      for (const doc of snapshot.docs) {
        const eventId = doc.get("eventId") as string;
        counts.set(eventId, (counts.get(eventId) ?? 0) + 1);
      }
      return counts;
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
