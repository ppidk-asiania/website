import "server-only";
import { cacheLife, cacheTag } from "next/cache";
import { lazyEnv } from "@website/config/env";
import { createSqlOrgDocumentReader } from "@website/db/sql";
import type { PublicOrgDocument } from "@website/domain/organizations";
import { webDb } from "./db";

const reader = lazyEnv(() => createSqlOrgDocumentReader(webDb()));

export async function publicOrgDocuments(): Promise<PublicOrgDocument[]> {
  "use cache";
  cacheTag("org-documents");
  cacheLife("minutes");
  return reader().listPublished();
}
