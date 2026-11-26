import { randomUUID } from "node:crypto";
import type { AuditEvent, Snapshot } from "@website/audit";
import {
  assertNotReserved,
  assertProcurementStep,
  putOnShelf,
  reservedDuring,
  takeFromShelf,
  type Contribution,
  type ContributionInput,
  type ContributionState,
  type InventoryItem,
  type ItemOwner,
  type OutsideLoan,
  type OutsideLoanInput,
  type ProcurementInput,
  type ProcurementState,
  type ProcurementStep,
  type Reservation,
  type ReservationInput,
} from "@website/domain/inventory";
import { RuleViolationError } from "@website/domain/shared";
import { safeId } from "@website/security/validation";
import { createSqlAuditWriter } from "./audit";
import { itemSnapshot, toItem, writeLog } from "./inventory";
import { reservationsOf } from "./loans";
import { toDate } from "./slugged";
import type { Database, Transaction } from "./store";

type Doc = { get(field: string): unknown };

/** One audit entry for a row of these flows: what it was, what it is, and a title. */
export type FlowAudit = (
  before: Snapshot | null,
  after: Snapshot | null,
  title: string,
) => AuditEvent;

const toReservation = (id: string, d: Doc): Reservation => ({
  id,
  itemId: d.get("itemId") as string,
  eventId: d.get("eventId") as string,
  quantity: d.get("quantity") as number,
  from: d.get("from") as string,
  to: d.get("to") as string,
  status: d.get("status") as Reservation["status"],
  by: d.get("by") as string,
  createdAt: toDate(d.get("createdAt")) as Date,
});

const toContribution = (id: string, d: Doc): Contribution => ({
  id,
  userId: d.get("userId") as string,
  contributorName: d.get("contributorName") as string,
  name: d.get("name") as string,
  description: (d.get("description") as string | undefined) ?? "",
  quantity: d.get("quantity") as number,
  mode: d.get("mode") as Contribution["mode"],
  returnOn: (d.get("returnOn") as string | null | undefined) ?? null,
  status: d.get("status") as ContributionState,
  itemId: (d.get("itemId") as string | null | undefined) ?? null,
  note: (d.get("note") as string | null | undefined) ?? null,
  createdAt: toDate(d.get("createdAt")) as Date,
});

export interface Procurement {
  readonly id: string;
  readonly owner: ItemOwner;
  readonly name: string;
  readonly category: string;
  readonly why: string;
  readonly estimatedMinor: number;
  readonly currency: string;
  readonly urgency: string;
  readonly status: ProcurementState;
  readonly note: string | null;
  readonly requestedBy: string;
  readonly createdAt: Date;
}

const toProcurement = (id: string, d: Doc): Procurement => ({
  id,
  owner: d.get("owner") as ItemOwner,
  name: d.get("name") as string,
  category: (d.get("category") as string | undefined) ?? "",
  why: d.get("why") as string,
  estimatedMinor: d.get("estimatedMinor") as number,
  currency: d.get("currency") as string,
  urgency: d.get("urgency") as string,
  status: d.get("status") as ProcurementState,
  note: (d.get("note") as string | null | undefined) ?? null,
  requestedBy: d.get("requestedBy") as string,
  createdAt: toDate(d.get("createdAt")) as Date,
});

const toOutside = (id: string, d: Doc): OutsideLoan => ({
  id,
  itemId: d.get("itemId") as string,
  borrower: d.get("borrower") as string,
  contact: d.get("contact") as string,
  purpose: d.get("purpose") as string,
  quantity: d.get("quantity") as number,
  conditionOut: (d.get("conditionOut") as string | undefined) ?? "",
  conditionIn: (d.get("conditionIn") as string | null | undefined) ?? null,
  lentOn: d.get("lentOn") as string,
  expectedBack: d.get("expectedBack") as string,
  returnedOn: (d.get("returnedOn") as string | null | undefined) ?? null,
  status: d.get("status") as OutsideLoan["status"],
});

const MAX_LIST = 1000;
const newestFirst = <T extends { createdAt: Date }>(rows: T[]) =>
  rows.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());

/** Admin side of N7.3: event reservations, contributions, procurement requests and loans to outside bodies. */
export function createSqlFlowStore(db: Database) {
  const audit = createSqlAuditWriter(db);
  const reservations = db.collection("itemReservations");
  const contributions = db.collection("itemContributions");
  const procurements = db.collection("procurementRequests");
  const outside = db.collection("outsideLoans");
  const items = db.collection("inventoryItems");

  const liveItem = async (tx: Transaction, id: string) => {
    const ref = items.doc(safeId.parse(id));
    const snap = await tx.get(ref);
    const item = snap.exists ? toItem(ref.id, snap) : null;
    if (!item || item.deletedAt) throw new RuleViolationError("This item does not exist.");
    if (item.condition === "retired") throw new RuleViolationError("This item is retired.");
    return { ref, item };
  };

  return {
    /* reservations */
    async listReservations(limit = MAX_LIST): Promise<Reservation[]> {
      const snapshot = await reservations.limit(limit).get();
      return newestFirst(snapshot.docs.map((d) => toReservation(d.id, d)));
    },
    async getReservation(id: string): Promise<Reservation | null> {
      if (!safeId.safeParse(id).success) return null;
      const snap = await reservations.doc(id).get();
      return snap.exists ? toReservation(id, snap) : null;
    },

    /** Blocks units of an item for an event's days; other events' blocks on those days are respected. */
    reserve(
      input: ReservationInput,
      by: string,
      now: Date,
      auditFor: FlowAudit,
    ): Promise<Reservation> {
      return db.runTransaction(async (tx) => {
        const { item } = await liveItem(tx, input.itemId);
        const event = await tx.get(db.collection("events").doc(safeId.parse(input.eventId)));
        if (!event.exists || event.get("deletedAt")) {
          throw new RuleViolationError("This event does not exist.");
        }
        assertNotReserved(
          item.total,
          reservedDuring(await reservationsOf(db, tx, item.id), item.id, input),
          input.quantity,
        );
        const next: Reservation = {
          ...input,
          id: randomUUID(),
          status: "active",
          by,
          createdAt: now,
        };
        const log = await audit.begin(tx);
        tx.create(reservations.doc(next.id), {
          itemId: next.itemId,
          eventId: next.eventId,
          quantity: next.quantity,
          from: next.from,
          to: next.to,
          status: "active",
          by,
          createdAt: now,
        });
        log.append(
          auditFor(
            null,
            { item: item.name, quantity: next.quantity, from: next.from, to: next.to },
            `Reserved: ${item.name}`,
          ),
        );
        return next;
      });
    },

    release(id: string, now: Date, auditFor: FlowAudit): Promise<Reservation> {
      return db.runTransaction(async (tx) => {
        const ref = reservations.doc(safeId.parse(id));
        const snap = await tx.get(ref);
        if (!snap.exists || snap.get("status") !== "active") {
          throw new RuleViolationError("There is no active reservation.");
        }
        const current = toReservation(ref.id, snap);
        const log = await audit.begin(tx);
        tx.update(ref, { status: "released", releasedAt: now });
        log.append(
          auditFor(
            { status: "active", quantity: current.quantity },
            { status: "released", quantity: current.quantity },
            "Reservation released",
          ),
        );
        return { ...current, status: "released" };
      });
    },

    /** An event that is deleted frees everything it blocked. */
    async releaseForEvent(eventId: string, now: Date): Promise<number> {
      const snapshot = await reservations
        .where("eventId", "==", eventId)
        .where("status", "==", "active")
        .get();
      for (const doc of snapshot.docs)
        await doc.ref.update({ status: "released", releasedAt: now });
      return snapshot.docs.length;
    },

    /* contributions */
    async listContributions(limit = MAX_LIST): Promise<Contribution[]> {
      const snapshot = await contributions.limit(limit).get();
      return newestFirst(snapshot.docs.map((d) => toContribution(d.id, d)));
    },
    async getContribution(id: string): Promise<Contribution | null> {
      if (!safeId.safeParse(id).success) return null;
      const snap = await contributions.doc(id).get();
      return snap.exists ? toContribution(id, snap) : null;
    },

    /** Approving copies the offer into the catalogue as ONE new item (a lent one keeps whose it is). */
    approveContribution(
      id: string,
      owner: ItemOwner,
      by: string,
      now: Date,
      auditFor: FlowAudit,
    ): Promise<{ contribution: Contribution; itemId: string }> {
      return db.runTransaction(async (tx) => {
        const ref = contributions.doc(safeId.parse(id));
        const snap = await tx.get(ref);
        if (!snap.exists || snap.get("status") !== "pending") {
          throw new RuleViolationError("There is no offer to decide.");
        }
        const offer = toContribution(ref.id, snap);
        if (offer.userId === by)
          throw new RuleViolationError("Someone else must decide on your own offer.");
        const item: InventoryItem = {
          id: randomUUID(),
          owner,
          name: offer.name,
          category: "",
          description: offer.description,
          image: null,
          total: offer.quantity,
          available: offer.quantity,
          condition: "good",
          location: "",
          custodianUserId: null,
          custodianName: null,
          published: false,
          lentBy:
            offer.mode === "lend"
              ? { name: offer.contributorName, returnOn: offer.returnOn }
              : null,
          version: 1,
          createdAt: now,
          updatedAt: now,
          deletedAt: null,
        };
        const log = await audit.begin(tx);
        tx.create(items.doc(item.id), {
          owner: item.owner,
          name: item.name,
          category: item.category,
          description: item.description,
          image: null,
          total: item.total,
          available: item.available,
          condition: item.condition,
          location: "",
          custodianUserId: null,
          custodianName: null,
          published: false,
          lentBy: item.lentBy,
          version: 1,
          createdAt: now,
          updatedAt: now,
          deletedAt: null,
        });
        tx.update(ref, { status: "approved", itemId: item.id, decidedBy: by, decidedAt: now });
        writeLog(db, tx, {
          itemId: item.id,
          action: "added",
          change: item.total,
          note: `${offer.mode === "lend" ? "lent" : "given"} by ${offer.contributorName}`,
          by,
          at: now,
        });
        log.append(
          auditFor(
            { status: "pending" },
            { status: "approved", item: itemSnapshot(item) as Snapshot[string] },
            `Offer approved: ${offer.name}`,
          ),
        );
        return { contribution: { ...offer, status: "approved", itemId: item.id }, itemId: item.id };
      });
    },

    rejectContribution(id: string, by: string, note: string, now: Date, auditFor: FlowAudit) {
      return db.runTransaction(async (tx) => {
        const ref = contributions.doc(safeId.parse(id));
        const snap = await tx.get(ref);
        if (!snap.exists || snap.get("status") !== "pending") {
          throw new RuleViolationError("There is no offer to decide.");
        }
        const offer = toContribution(ref.id, snap);
        if (offer.userId === by)
          throw new RuleViolationError("Someone else must decide on your own offer.");
        const log = await audit.begin(tx);
        tx.update(ref, { status: "rejected", note, decidedBy: by, decidedAt: now });
        log.append(
          auditFor(
            { status: "pending" },
            { status: "rejected", note },
            `Offer rejected: ${offer.name}`,
          ),
        );
        return { ...offer, status: "rejected" as const, note };
      });
    },

    /* procurement */
    async listProcurement(limit = MAX_LIST): Promise<Procurement[]> {
      const snapshot = await procurements.limit(limit).get();
      return newestFirst(snapshot.docs.map((d) => toProcurement(d.id, d)));
    },
    async getProcurement(id: string): Promise<Procurement | null> {
      if (!safeId.safeParse(id).success) return null;
      const snap = await procurements.doc(id).get();
      return snap.exists ? toProcurement(id, snap) : null;
    },
    requestProcurement(
      input: Omit<ProcurementInput, "owner"> & { owner: ItemOwner },
      by: string,
      now: Date,
      auditFor: FlowAudit,
    ): Promise<string> {
      return db.runTransaction(async (tx) => {
        const id = randomUUID();
        const log = await audit.begin(tx);
        tx.create(procurements.doc(id), {
          ...input,
          status: "pending",
          note: null,
          requestedBy: by,
          createdAt: now,
        });
        log.append(
          auditFor(
            null,
            { name: input.name, status: "pending", estimatedMinor: input.estimatedMinor },
            `Procurement asked: ${input.name}`,
          ),
        );
        return id;
      });
    },
    /** Approve, reject (with a reason) or record as fulfilled. The approver is never the requester. */
    decideProcurement(
      id: string,
      step: ProcurementStep,
      by: string,
      note: string | null,
      now: Date,
      auditFor: FlowAudit,
    ): Promise<Procurement> {
      return db.runTransaction(async (tx) => {
        const ref = procurements.doc(safeId.parse(id));
        const snap = await tx.get(ref);
        if (!snap.exists) throw new RuleViolationError("This request does not exist.");
        const current = toProcurement(ref.id, snap);
        assertProcurementStep(current.status, step);
        if (step !== "fulfil" && current.requestedBy === by) {
          throw new RuleViolationError("Someone else must decide on your own request.");
        }
        const status: ProcurementState =
          step === "approve" ? "approved" : step === "reject" ? "rejected" : "fulfilled";
        const log = await audit.begin(tx);
        tx.update(ref, { status, note: note ?? current.note, decidedBy: by, decidedAt: now });
        log.append(
          auditFor(
            { status: current.status },
            { status, note },
            `Procurement ${status}: ${current.name}`,
          ),
        );
        return { ...current, status, note: note ?? current.note };
      });
    },

    /* loans to outside bodies */
    async listOutside(limit = MAX_LIST): Promise<OutsideLoan[]> {
      const snapshot = await outside.limit(limit).get();
      return snapshot.docs
        .map((d) => toOutside(d.id, d))
        .sort((a, b) =>
          a.status === b.status ? b.lentOn.localeCompare(a.lentOn) : a.status === "out" ? -1 : 1,
        );
    },
    async getOutside(id: string): Promise<OutsideLoan | null> {
      if (!safeId.safeParse(id).success) return null;
      const snap = await outside.doc(id).get();
      return snap.exists ? toOutside(id, snap) : null;
    },

    /** The asset leaves: stock is read and reduced in the same transaction, event blocks are respected. */
    lendOut(
      input: OutsideLoanInput,
      by: string,
      today: string,
      now: Date,
      auditFor: FlowAudit,
    ): Promise<OutsideLoan> {
      return db.runTransaction(async (tx) => {
        if (input.expectedBack < today)
          throw new RuleViolationError("The return date cannot be in the past.");
        const { ref, item } = await liveItem(tx, input.itemId);
        const period = { from: today, to: input.expectedBack };
        assertNotReserved(
          item.available,
          reservedDuring(await reservationsOf(db, tx, item.id), item.id, period),
          input.quantity,
        );
        const available = takeFromShelf(item, input.quantity);
        const loan: OutsideLoan = {
          ...input,
          id: randomUUID(),
          conditionIn: null,
          lentOn: today,
          returnedOn: null,
          status: "out",
        };
        const log = await audit.begin(tx);
        tx.update(ref, { available, version: item.version + 1, updatedAt: now });
        tx.create(outside.doc(loan.id), {
          itemId: loan.itemId,
          borrower: loan.borrower,
          contact: loan.contact,
          purpose: loan.purpose,
          quantity: loan.quantity,
          conditionOut: loan.conditionOut,
          conditionIn: null,
          lentOn: loan.lentOn,
          expectedBack: loan.expectedBack,
          returnedOn: null,
          status: "out",
        });
        writeLog(db, tx, {
          itemId: item.id,
          action: "handed_over",
          change: -loan.quantity,
          note: `outside: ${loan.borrower}`,
          by,
          at: now,
        });
        log.append(
          auditFor(
            null,
            { item: item.name, borrower: loan.borrower, quantity: loan.quantity, status: "out" },
            `Lent out: ${item.name}`,
          ),
        );
        return loan;
      });
    },

    takeBackOutside(
      id: string,
      conditionIn: string,
      by: string,
      today: string,
      now: Date,
      auditFor: FlowAudit,
    ): Promise<OutsideLoan> {
      return db.runTransaction(async (tx) => {
        const ref = outside.doc(safeId.parse(id));
        const snap = await tx.get(ref);
        if (!snap.exists || snap.get("status") !== "out") {
          throw new RuleViolationError("This loan is not out.");
        }
        const loan = toOutside(ref.id, snap);
        const itemRef = items.doc(safeId.parse(loan.itemId));
        const itemSnap = await tx.get(itemRef);
        if (!itemSnap.exists) throw new RuleViolationError("This item does not exist.");
        const item = toItem(itemRef.id, itemSnap);
        const log = await audit.begin(tx);
        tx.update(itemRef, {
          available: putOnShelf(item, loan.quantity),
          version: item.version + 1,
          updatedAt: now,
        });
        tx.update(ref, { status: "returned", returnedOn: today, conditionIn });
        writeLog(db, tx, {
          itemId: item.id,
          action: "returned",
          change: loan.quantity,
          note: `outside: ${loan.borrower}`,
          by,
          at: now,
        });
        log.append(
          auditFor(
            { status: "out" },
            { status: "returned", conditionIn },
            `Returned from outside: ${item.name}`,
          ),
        );
        return { ...loan, status: "returned", returnedOn: today, conditionIn };
      });
    },
  };
}
export type SqlFlowStore = ReturnType<typeof createSqlFlowStore>;

/** Web side: a member offers an item (to give, or to lend to the organisation). */
export function createSqlContributionWebStore(db: Database) {
  const contributions = db.collection("itemContributions");
  return {
    async offer(
      id: string,
      uid: string,
      contributorName: string,
      input: ContributionInput,
      today: string,
      now: Date,
    ): Promise<void> {
      if (input.returnOn !== null && input.returnOn < today) {
        throw new RuleViolationError("The return date cannot be in the past.");
      }
      await contributions.doc(safeId.parse(id)).create({
        userId: uid,
        contributorName,
        name: input.name,
        description: input.description,
        quantity: input.quantity,
        mode: input.mode,
        returnOn: input.returnOn,
        status: "pending",
        itemId: null,
        note: null,
        createdAt: now,
      });
    },
    async mine(uid: string, limit = 100): Promise<Contribution[]> {
      const snapshot = await contributions.where("userId", "==", uid).limit(limit).get();
      return newestFirst(snapshot.docs.map((d) => toContribution(d.id, d)));
    },
  };
}
export type SqlContributionWebStore = ReturnType<typeof createSqlContributionWebStore>;
