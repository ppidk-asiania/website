import { randomUUID } from "node:crypto";
import type { AuditEvent, Snapshot } from "@website/audit";
import type { FeaturedImage } from "@website/domain/content";
import {
  actionForCondition,
  isListed,
  stockAfterTotalChange,
  toPublicItem,
  type InventoryItem,
  type InventoryItemInput,
  type InventoryLogEntry,
  type ItemCondition,
  type ItemOwner,
  type LogAction,
  type PublicItem,
} from "@website/domain/inventory";
import { ConcurrencyConflictError, RuleViolationError } from "@website/domain/shared";
import { safeId } from "@website/security/validation";
import { createSqlAuditWriter } from "./audit";
import type { Database, Transaction } from "./store";
import { toDate } from "./slugged";

type Doc = { get(field: string): unknown };

export function toItem(id: string, doc: Doc): InventoryItem {
  return {
    id,
    owner: doc.get("owner") as ItemOwner,
    name: doc.get("name") as string,
    category: (doc.get("category") as string | undefined) ?? "",
    description: (doc.get("description") as string | undefined) ?? "",
    image: (doc.get("image") as FeaturedImage | null | undefined) ?? null,
    total: doc.get("total") as number,
    available: doc.get("available") as number,
    condition: doc.get("condition") as ItemCondition,
    location: (doc.get("location") as string | undefined) ?? "",
    custodianUserId: (doc.get("custodianUserId") as string | null | undefined) ?? null,
    custodianName: (doc.get("custodianName") as string | null | undefined) ?? null,
    published: doc.get("published") as boolean,
    lentBy: (doc.get("lentBy") as InventoryItem["lentBy"] | undefined) ?? null,
    version: doc.get("version") as number,
    createdAt: toDate(doc.get("createdAt")) as Date,
    updatedAt: toDate(doc.get("updatedAt")) as Date,
    deletedAt: toDate(doc.get("deletedAt")),
  };
}

export const itemSnapshot = (i: InventoryItem): Snapshot => ({
  owner: { ...i.owner } as Snapshot[string],
  name: i.name,
  category: i.category,
  total: i.total,
  available: i.available,
  condition: i.condition,
  location: i.location,
  published: i.published,
});

export type ItemAudit = (
  before: Snapshot | null,
  after: Snapshot | null,
  item: InventoryItem,
) => AuditEvent;

const itemFields = (i: InventoryItem) => ({
  owner: i.owner,
  name: i.name,
  category: i.category,
  description: i.description,
  image: i.image,
  total: i.total,
  available: i.available,
  condition: i.condition,
  location: i.location,
  custodianUserId: i.custodianUserId,
  custodianName: i.custodianName,
  published: i.published,
  lentBy: i.lentBy,
  version: i.version,
  createdAt: i.createdAt,
  updatedAt: i.updatedAt,
  deletedAt: i.deletedAt,
});

/** One log row, written in the same transaction as the change it describes. */
export function writeLog(
  db: Database,
  tx: Transaction,
  row: {
    itemId: string;
    action: LogAction;
    change: number;
    note: string | null;
    by: string | null;
    at: Date;
  },
): void {
  tx.create(db.collection("inventoryLog").doc(randomUUID()), row);
}

const MAX_LIST = 1000;

/** Admin side: items with their owner, stock changes (each with its log row) and the log. */
export function createSqlInventoryStore(db: Database) {
  const items = db.collection("inventoryItems");
  const audit = createSqlAuditWriter(db);

  const lock = async (tx: Transaction, id: string, expected: number | null) => {
    const ref = items.doc(safeId.parse(id));
    const snap = await tx.get(ref);
    if (!snap.exists) throw new RuleViolationError("This item does not exist.");
    const current = toItem(ref.id, snap);
    if (current.deletedAt) throw new RuleViolationError("This item is deleted.");
    if (expected !== null && current.version !== expected) {
      throw new ConcurrencyConflictError("inventoryItems version changed");
    }
    return { ref, current };
  };

  return {
    async list(limit = MAX_LIST): Promise<InventoryItem[]> {
      const snapshot = await items.limit(limit).get();
      return snapshot.docs
        .map((doc) => toItem(doc.id, doc))
        .filter((i) => i.deletedAt === null)
        .sort((a, b) => a.name.localeCompare(b.name));
    },

    async get(id: string): Promise<InventoryItem | null> {
      if (!safeId.safeParse(id).success) return null;
      const snap = await items.doc(id).get();
      return snap.exists ? toItem(id, snap) : null;
    },

    /** A new item: stock starts full, and the log says "added". */
    create(
      input: InventoryItemInput & { owner: ItemOwner; total: number },
      by: string,
      now: Date,
      auditFor: ItemAudit,
    ): Promise<InventoryItem> {
      const ref = items.doc(randomUUID());
      return db.runTransaction(async (tx) => {
        const next: InventoryItem = {
          ...input,
          id: ref.id,
          available: input.total,
          lentBy: null,
          version: 1,
          createdAt: now,
          updatedAt: now,
          deletedAt: null,
        };
        const log = await audit.begin(tx);
        tx.set(ref, itemFields(next));
        writeLog(db, tx, {
          itemId: ref.id,
          action: "added",
          change: input.total,
          note: null,
          by,
          at: now,
        });
        log.append(auditFor(null, itemSnapshot(next), next));
        return next;
      });
    },

    /** Details and condition; the owner and the stock stay (the stock has its own change). */
    update(
      id: string,
      version: number,
      input: InventoryItemInput,
      by: string,
      now: Date,
      auditFor: ItemAudit,
    ): Promise<InventoryItem> {
      return db.runTransaction(async (tx) => {
        const { ref, current } = await lock(tx, id, version);
        const next: InventoryItem = {
          ...current,
          ...input,
          version: current.version + 1,
          updatedAt: now,
        };
        const log = await audit.begin(tx);
        tx.set(ref, itemFields(next));
        if (current.condition !== next.condition) {
          writeLog(db, tx, {
            itemId: ref.id,
            action: actionForCondition(current.condition, next.condition),
            change: 0,
            note: `${current.condition} → ${next.condition}`,
            by,
            at: now,
          });
        }
        log.append(auditFor(itemSnapshot(current), itemSnapshot(next), next));
        return next;
      });
    },

    /** A new total; what is out on loan stays out. */
    setTotal(
      id: string,
      version: number,
      newTotal: number,
      note: string | null,
      by: string,
      now: Date,
      auditFor: ItemAudit,
    ): Promise<InventoryItem> {
      return db.runTransaction(async (tx) => {
        const { ref, current } = await lock(tx, id, version);
        const stock = stockAfterTotalChange(current, newTotal);
        const next: InventoryItem = {
          ...current,
          ...stock,
          version: current.version + 1,
          updatedAt: now,
        };
        const log = await audit.begin(tx);
        tx.set(ref, itemFields(next));
        writeLog(db, tx, {
          itemId: ref.id,
          action: "adjusted",
          change: stock.available - current.available,
          note,
          by,
          at: now,
        });
        log.append(auditFor(itemSnapshot(current), itemSnapshot(next), next));
        return next;
      });
    },

    /** Soft delete; only when nothing is out on loan (a retired item keeps its history instead). */
    remove(id: string, version: number, now: Date, auditFor: ItemAudit): Promise<InventoryItem> {
      return db.runTransaction(async (tx) => {
        const { ref, current } = await lock(tx, id, version);
        if (current.available !== current.total) {
          throw new RuleViolationError("Some of this item is out on loan. Take it back first.");
        }
        const next: InventoryItem = {
          ...current,
          deletedAt: now,
          version: current.version + 1,
          updatedAt: now,
        };
        const log = await audit.begin(tx);
        tx.set(ref, itemFields(next));
        log.append(auditFor(itemSnapshot(current), null, next));
        return next;
      });
    },

    /** The newest log rows, of one item or of all. */
    async log(itemId: string | null, limit = 200): Promise<InventoryLogEntry[]> {
      const base = db.collection("inventoryLog");
      const snapshot = await (itemId ? base.where("itemId", "==", itemId) : base)
        .limit(MAX_LIST)
        .get();
      return snapshot.docs
        .map((doc): InventoryLogEntry => ({
          id: doc.id,
          itemId: doc.get("itemId") as string,
          action: doc.get("action") as LogAction,
          change: doc.get("change") as number,
          note: (doc.get("note") as string | null | undefined) ?? null,
          by: (doc.get("by") as string | null | undefined) ?? null,
          at: toDate(doc.get("at")) as Date,
        }))
        .sort((a, b) => b.at.getTime() - a.at.getTime())
        .slice(0, limit);
    },
  };
}
export type SqlInventoryStore = ReturnType<typeof createSqlInventoryStore>;

/** Web side: the listed items with "N available". */
export function createSqlInventoryReader(db: Database) {
  const items = db.collection("inventoryItems");
  return {
    async catalogue(limit = MAX_LIST): Promise<PublicItem[]> {
      const snapshot = await items.where("published", "==", true).limit(limit).get();
      return snapshot.docs
        .map((doc) => toItem(doc.id, doc))
        .filter(isListed)
        .sort((a, b) => a.name.localeCompare(b.name))
        .map(toPublicItem);
    },
    async item(id: string): Promise<PublicItem | null> {
      if (!safeId.safeParse(id).success) return null;
      const snap = await items.doc(id).get();
      if (!snap.exists) return null;
      const found = toItem(id, snap);
      return isListed(found) ? toPublicItem(found) : null;
    },
  };
}
export type SqlInventoryReader = ReturnType<typeof createSqlInventoryReader>;
