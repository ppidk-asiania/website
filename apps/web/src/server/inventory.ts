import "server-only";
import { cacheLife, cacheTag } from "next/cache";
import { lazyEnv } from "@website/config/env";
import { createSqlInventoryReader } from "@website/db/sql";
import type { PublicItem } from "@website/domain/inventory";
import { webDb } from "./db";

const reader = lazyEnv(() => createSqlInventoryReader(webDb()));

/** Listed items with "N available"; cached for a minute or two (stock moves slowly). */
export async function catalogue(): Promise<PublicItem[]> {
  "use cache";
  cacheTag("inventory");
  cacheLife("minutes");
  return reader().catalogue();
}
