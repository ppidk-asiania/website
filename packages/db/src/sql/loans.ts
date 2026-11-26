import type { AuditEvent, Snapshot } from "@website/audit";
import {
  assertNotInPast,
  assertNotReserved,
  reservedDuring,
  assertNotOwnLoan,
  assertStep,
  isListed,
  isLoanOverdue,
  putOnShelf,
  takeFromShelf,
  type Borrower,
  type Loan,
  type LoanState,
  type LoanStep,
  type MemberLoanInput,
  type OutsiderLoanInput,
  type Reservation,
} from "@website/domain/inventory";
import { RuleViolationError } from "@website/domain/shared";
import { safeId } from "@website/security/validation";
import { createSqlAuditWriter } from "./audit";
import { toItem, writeLog } from "./inventory";
import { toDate } from "./slugged";
import type { Database, Transaction } from "./store";

type Doc = { get(field: string): unknown };

export function toLoan(id: string, doc: Doc): Loan {
  const kind = doc.get("borrowerKind") as "member" | "outsider";
  const borrower: Borrower =
    kind === "member"
      ? { kind, userId: doc.get("userId") as string }
      : {
          kind,
          name: doc.get("name") as string,
          email: doc.get("email") as string,
          phone: doc.get("phone") as string,
          statementPath: doc.get("statementPath") as string,
        };
  return {
    id,
    itemId: doc.get("itemId") as string,
    quantity: doc.get("quantity") as number,
    purpose: doc.get("purpose") as string,
    place: doc.get("place") as string,
    from: doc.get("from") as string,
    to: doc.get("to") as string,
    borrower,
    status: doc.get("status") as LoanState,
    note: (doc.get("note") as string | null | undefined) ?? null,
    decidedBy: (doc.get("decidedBy") as string | null | undefined) ?? null,
    handedOverAt: toDate(doc.get("handedOverAt")),
    returnedAt: toDate(doc.get("returnedAt")),
    returnCondition: (doc.get("returnCondition") as Loan["returnCondition"] | undefined) ?? null,
    createdAt: toDate(doc.get("createdAt")) as Date,
  };
}

const loanSnapshot = (l: Loan): Snapshot => ({
  itemId: l.itemId,
  quantity: l.quantity,
  from: l.from,
  to: l.to,
  status: l.status,
  note: l.note,
  returnCondition: l.returnCondition,
});

export type LoanAudit = (before: Snapshot, after: Snapshot, loan: Loan) => AuditEvent;

const MAX_LIST = 2000;

/** The reservations of an item, read inside the transaction (N7.3). */
export async function reservationsOf(db: Database, tx: Transaction, itemId: string) {
  const snapshot = await tx.get(db.collection("itemReservations").where("itemId", "==", itemId));
  return snapshot.docs.map(
    (d): Pick<Reservation, "itemId" | "quantity" | "from" | "to" | "status"> => ({
      itemId,
      quantity: d.get("quantity") as number,
      from: d.get("from") as string,
      to: d.get("to") as string,
      status: d.get("status") as Reservation["status"],
    }),
  );
}

/** What a loan row stores beyond the fields every step keeps. */
const storedLoan = (l: Loan) => ({
  itemId: l.itemId,
  quantity: l.quantity,
  purpose: l.purpose,
  place: l.place,
  from: l.from,
  to: l.to,
  borrowerKind: l.borrower.kind,
  ...(l.borrower.kind === "member"
    ? { userId: l.borrower.userId }
    : {
        name: l.borrower.name,
        email: l.borrower.email,
        phone: l.borrower.phone,
        statementPath: l.borrower.statementPath,
      }),
  status: l.status,
  note: l.note,
  decidedBy: l.decidedBy,
  handedOverAt: l.handedOverAt,
  returnedAt: l.returnedAt,
  returnCondition: l.returnCondition,
  createdAt: l.createdAt,
});

/** Admin side: the requests, and the steps that move an item (hand over, take back) with its stock and log. */
export function createSqlLoanStore(db: Database) {
  const loans = db.collection("itemLoans");
  const items = db.collection("inventoryItems");
  const audit = createSqlAuditWriter(db);

  const lock = async (tx: Transaction, id: string, step: LoanStep) => {
    const ref = loans.doc(safeId.parse(id));
    const snap = await tx.get(ref);
    if (!snap.exists) throw new RuleViolationError("This request does not exist.");
    const loan = toLoan(ref.id, snap);
    assertStep(loan, step);
    return { ref, loan };
  };

  return {
    /** Waiting requests first, then those out, then the rest; newest first inside each. */
    async list(limit = MAX_LIST): Promise<Loan[]> {
      const rank = (l: Loan) => (l.status === "pending" ? 0 : l.status === "return_asked" ? 1 : 2);
      const snapshot = await loans.limit(limit).get();
      return snapshot.docs
        .map((doc) => toLoan(doc.id, doc))
        .sort((a, b) => rank(a) - rank(b) || b.createdAt.getTime() - a.createdAt.getTime());
    },

    async get(id: string): Promise<Loan | null> {
      if (!safeId.safeParse(id).success) return null;
      const snap = await loans.doc(id).get();
      return snap.exists ? toLoan(id, snap) : null;
    },

    /** Loans out past their return day (a read-time rule): the daily reminder job and the dashboard. */
    async overdue(today: string): Promise<Loan[]> {
      const snapshot = await loans.where("status", "in", ["handed_over", "return_asked"]).get();
      return snapshot.docs.map((d) => toLoan(d.id, d)).filter((l) => isLoanOverdue(l, today));
    },

    async countPending(): Promise<number> {
      return (await loans.where("status", "==", "pending").get()).docs.length;
    },

    /** Approve or reject a waiting request. The approver is never the borrower. */
    decide(
      id: string,
      kind: "approve" | "reject",
      by: string,
      note: string | null,
      now: Date,
      auditFor: LoanAudit,
    ): Promise<Loan> {
      return db.runTransaction(async (tx) => {
        const { ref, loan } = await lock(tx, id, kind);
        assertNotOwnLoan(by, loan.borrower);
        const next: Loan = {
          ...loan,
          status: kind === "approve" ? "approved" : "rejected",
          note,
          decidedBy: by,
        };
        const log = await audit.begin(tx);
        tx.update(ref, { status: next.status, note, decidedBy: by, updatedAt: now });
        log.append(auditFor(loanSnapshot(loan), loanSnapshot(next), next));
        return next;
      });
    },

    /** The item goes out: its stock is read and reduced in the same transaction, so the last unit goes once. */
    handOver(id: string, by: string, now: Date, auditFor: LoanAudit): Promise<Loan> {
      return db.runTransaction(async (tx) => {
        const { ref, loan } = await lock(tx, id, "handOver");
        const itemRef = items.doc(safeId.parse(loan.itemId));
        const itemSnap = await tx.get(itemRef);
        if (!itemSnap.exists) throw new RuleViolationError("This item does not exist.");
        const item = toItem(itemRef.id, itemSnap);
        if (item.deletedAt || item.condition === "retired") {
          throw new RuleViolationError("This item is no longer lent out.");
        }
        // Units an event has blocked on the loan's days are not for lending (N7.3).
        const reserved = reservedDuring(await reservationsOf(db, tx, item.id), item.id, loan);
        assertNotReserved(item.available, reserved, loan.quantity);
        const available = takeFromShelf(item, loan.quantity);
        const next: Loan = { ...loan, status: "handed_over", handedOverAt: now };
        const log = await audit.begin(tx);
        tx.update(itemRef, { available, version: item.version + 1, updatedAt: now });
        tx.update(ref, { status: "handed_over", handedOverAt: now, updatedAt: now });
        writeLog(db, tx, {
          itemId: item.id,
          action: "handed_over",
          change: -loan.quantity,
          note: loan.borrower.kind === "member" ? "member" : loan.borrower.name,
          by,
          at: now,
        });
        log.append(auditFor(loanSnapshot(loan), loanSnapshot(next), next));
        return next;
      });
    },

    /** Back on the shelf; a damaged return also marks the item damaged. */
    takeBack(
      id: string,
      by: string,
      condition: "good" | "damaged",
      note: string | null,
      now: Date,
      auditFor: LoanAudit,
    ): Promise<Loan> {
      return db.runTransaction(async (tx) => {
        const { ref, loan } = await lock(tx, id, "takeBack");
        const itemRef = items.doc(safeId.parse(loan.itemId));
        const itemSnap = await tx.get(itemRef);
        if (!itemSnap.exists) throw new RuleViolationError("This item does not exist.");
        const item = toItem(itemRef.id, itemSnap);
        const damaged = condition === "damaged" && item.condition === "good";
        const next: Loan = {
          ...loan,
          status: "returned",
          returnedAt: now,
          returnCondition: condition,
          note: note ?? loan.note,
        };
        const log = await audit.begin(tx);
        tx.update(itemRef, {
          available: putOnShelf(item, loan.quantity),
          ...(damaged ? { condition: "damaged" } : {}),
          version: item.version + 1,
          updatedAt: now,
        });
        tx.update(ref, {
          status: "returned",
          returnedAt: now,
          returnCondition: condition,
          note: next.note,
          updatedAt: now,
        });
        writeLog(db, tx, {
          itemId: item.id,
          action: "returned",
          change: loan.quantity,
          note,
          by,
          at: now,
        });
        if (damaged) {
          writeLog(db, tx, {
            itemId: item.id,
            action: "damaged",
            change: 0,
            note: "damaged on return",
            by,
            at: now,
          });
        }
        log.append(auditFor(loanSnapshot(loan), loanSnapshot(next), next));
        return next;
      });
    },
  };
}
export type SqlLoanStore = ReturnType<typeof createSqlLoanStore>;

/** Web side: a request from a member or an outsider, and the member's own steps (ask to return, cancel). */
export function createSqlLoanWebStore(db: Database) {
  const loans = db.collection("itemLoans");
  const items = db.collection("inventoryItems");

  const submit = (
    id: string,
    input: MemberLoanInput,
    borrower: Borrower,
    now: Date,
    today: string,
  ) =>
    db.runTransaction(async (tx) => {
      assertNotInPast(input.from, today);
      const itemSnap = await tx.get(items.doc(safeId.parse(input.itemId)));
      const item = itemSnap.exists ? toItem(itemSnap.id, itemSnap) : null;
      if (!item || !isListed(item)) throw new RuleViolationError("This item is not available.");
      if (input.quantity > item.total) {
        throw new RuleViolationError(`There are only ${item.total} of this item.`);
      }
      // A request that overlaps an event's reservation of the item is refused with the reason (N7.3).
      assertNotReserved(
        item.total,
        reservedDuring(await reservationsOf(db, tx, item.id), item.id, input),
        input.quantity,
      );
      const loan: Loan = {
        id,
        itemId: input.itemId,
        quantity: input.quantity,
        purpose: input.purpose,
        place: input.place,
        from: input.from,
        to: input.to,
        borrower,
        status: "pending",
        note: null,
        decidedBy: null,
        handedOverAt: null,
        returnedAt: null,
        returnCondition: null,
        createdAt: now,
      };
      tx.create(loans.doc(safeId.parse(id)), { ...storedLoan(loan), updatedAt: now });
    });

  const ownStep = (id: string, uid: string, step: "askReturn" | "cancel", now: Date) =>
    db.runTransaction(async (tx) => {
      const ref = loans.doc(safeId.parse(id));
      const snap = await tx.get(ref);
      const loan = snap.exists ? toLoan(ref.id, snap) : null;
      // Someone else's request reads as missing: no existence oracle.
      if (!loan || loan.borrower.kind !== "member" || loan.borrower.userId !== uid) {
        throw new RuleViolationError("This request does not exist.");
      }
      assertStep(loan, step);
      tx.update(ref, {
        status: step === "askReturn" ? "return_asked" : "cancelled",
        updatedAt: now,
      });
      return loan;
    });

  return {
    requestAsMember: (id: string, uid: string, input: MemberLoanInput, now: Date, today: string) =>
      submit(id, input, { kind: "member", userId: uid }, now, today),
    requestAsOutsider: (
      id: string,
      input: OutsiderLoanInput,
      statementPath: string,
      now: Date,
      today: string,
    ) =>
      submit(
        id,
        input,
        {
          kind: "outsider",
          name: input.name,
          email: input.email,
          phone: input.phone,
          statementPath,
        },
        now,
        today,
      ),
    askReturn: (id: string, uid: string, now: Date) => ownStep(id, uid, "askReturn", now),
    cancel: (id: string, uid: string, now: Date) => ownStep(id, uid, "cancel", now),

    /** The member's own requests, newest first, with the item name. */
    async mine(uid: string, limit = 100) {
      const snapshot = await loans.where("userId", "==", uid).limit(limit).get();
      const rows = snapshot.docs
        .map((d) => toLoan(d.id, d))
        .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
      const names = new Map<string, string>();
      for (const itemId of new Set(rows.map((r) => r.itemId))) {
        const snap = await items.doc(itemId).get();
        names.set(itemId, snap.exists ? (snap.get("name") as string) : "");
      }
      return rows.map((l) => ({ ...l, itemName: names.get(l.itemId) ?? "" }));
    },
  };
}
export type SqlLoanWebStore = ReturnType<typeof createSqlLoanWebStore>;
