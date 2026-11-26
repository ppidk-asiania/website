import type { Database } from "./store";
import type { Snapshot } from "@website/audit";
import {
  type OrgDocument,
  type OrgDocumentFile,
  type OrgDocumentType,
  type PublicOrgDocument,
} from "@website/domain/organizations";
import { createSluggedStore, toDate } from "./slugged";

export type OrgDocumentFields = Omit<OrgDocument, "id" | "version" | "createdAt" | "updatedAt">;

function toOrgDocument(id: string, data: Record<string, unknown>): OrgDocument {
  return {
    id,
    type: data["type"] as OrgDocumentType,
    title: data["title"] as string,
    versionLabel: data["versionLabel"] as string,
    date: data["date"] as string,
    file: data["file"] as OrgDocumentFile | null,
    link: data["link"] as string | null,
    published: data["published"] as boolean,
    version: data["version"] as number,
    createdAt: toDate(data["createdAt"]) as Date,
    updatedAt: toDate(data["updatedAt"]) as Date,
    deletedAt: toDate(data["deletedAt"]),
  };
}

export function orgDocumentSnapshot(d: OrgDocumentFields): Snapshot {
  return {
    type: d.type,
    title: d.title,
    versionLabel: d.versionLabel,
    date: d.date,
    file: d.file ? { ...d.file } : null,
    link: d.link,
    published: d.published,
  };
}

const orgDocuments = (db: Database) =>
  createSluggedStore<OrgDocument>(db, {
    collection: "orgDocuments",
    slug: null,
    fromDoc: toOrgDocument,
    snapshot: orgDocumentSnapshot,
    fixed: () => ({}),
  });

export function createSqlOrgDocumentStore(db: Database) {
  const store = orgDocuments(db);
  return {
    async listForAdmin(limit = 500): Promise<OrgDocument[]> {
      const snapshot = await store.docs.orderBy("date", "desc").limit(limit).get();
      return snapshot.docs
        .map((doc) => store.read(doc.id, doc.data()))
        .filter((d) => d.deletedAt === null);
    },
    get: store.get,
    write: store.write,
  };
}
export type SqlOrgDocumentStore = ReturnType<typeof createSqlOrgDocumentStore>;

export function createSqlOrgDocumentReader(db: Database) {
  const store = orgDocuments(db);
  return {
    async listPublished(limit = 500): Promise<PublicOrgDocument[]> {
      const snapshot = await store.docs
        .where("published", "==", true)
        .orderBy("date", "desc")
        .limit(limit)
        .get();
      return snapshot.docs
        .map((doc) => store.read(doc.id, doc.data()))
        .filter((d) => d.deletedAt === null)
        .map((d) => ({
          id: d.id,
          type: d.type,
          title: d.title,
          versionLabel: d.versionLabel,
          date: d.date,
          href: d.file ? `/files/${d.file.path}` : (d.link as string),
        }));
    },
  };
}
export type SqlOrgDocumentReader = ReturnType<typeof createSqlOrgDocumentReader>;
