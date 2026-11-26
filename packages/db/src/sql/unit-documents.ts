import type { Database } from "./store";
import type { Snapshot } from "@website/audit";
import type { UnitDocument, UnitDocumentFile } from "@website/domain/organizations";
import { safeId } from "@website/security/validation";
import { createSluggedStore, toDate } from "./slugged";

export type UnitDocumentFields = Omit<UnitDocument, "id" | "version" | "createdAt" | "updatedAt">;

function toUnitDocument(id: string, data: Record<string, unknown>): UnitDocument {
  return {
    id,
    periodId: data["periodId"] as string,
    orgUnitId: data["orgUnitId"] as string | null,
    folder: data["folder"] as string,
    title: data["title"] as string,
    file: data["file"] as UnitDocumentFile,
    uploadedBy: data["uploadedBy"] as string,
    version: data["version"] as number,
    createdAt: toDate(data["createdAt"]) as Date,
    updatedAt: toDate(data["updatedAt"]) as Date,
    deletedAt: toDate(data["deletedAt"]),
  };
}

export function unitDocumentSnapshot(d: UnitDocumentFields): Snapshot {
  return {
    periodId: d.periodId,
    orgUnitId: d.orgUnitId,
    folder: d.folder,
    title: d.title,
    file: { ...d.file },
    uploadedBy: d.uploadedBy,
  };
}

export function createSqlUnitDocumentStore(db: Database) {
  const docsRef = db.collection("unitDocuments");
  const store = createSluggedStore<UnitDocument>(db, {
    collection: "unitDocuments",
    slug: null,
    fromDoc: toUnitDocument,
    snapshot: unitDocumentSnapshot,
    // `trashed` lets the purge find deleted rows without comparing a null date.
    fixed: (d) => ({ trashed: d.deletedAt !== null }),
  });
  const live = (docs: { docs: Array<{ id: string; data(): unknown }> }) =>
    docs.docs.map((doc) => store.read(doc.id, doc.data())).filter((d) => d.deletedAt === null);

  return {
    get: store.get,
    write: store.write,

    async listForPeriod(periodId: string, limit = 1000): Promise<UnitDocument[]> {
      const found = await store.docs
        .where("periodId", "==", safeId.parse(periodId))
        .where("trashed", "==", false)
        .orderBy("updatedAt", "desc")
        .limit(limit)
        .get();
      return live(found);
    },

    /** Bytes in use by one unit (or the period-level folder), for the per-unit cap. */
    async bytesOf(periodId: string, orgUnitId: string | null): Promise<number> {
      const found = await store.docs
        .where("periodId", "==", safeId.parse(periodId))
        .where("orgUnitId", "==", orgUnitId)
        .where("trashed", "==", false)
        .get();
      return live(found).reduce((sum, d) => sum + d.file.size, 0);
    },

    async listTrashed(limit = 500): Promise<UnitDocument[]> {
      const found = await store.docs.where("trashed", "==", true).limit(limit).get();
      return found.docs.map((doc) => store.read(doc.id, doc.data()));
    },

    async purge(id: string): Promise<void> {
      await db.runTransaction((tx) => {
        tx.delete(docsRef.doc(safeId.parse(id)));
        return Promise.resolve();
      });
    },
  };
}
export type SqlUnitDocumentStore = ReturnType<typeof createSqlUnitDocumentStore>;
