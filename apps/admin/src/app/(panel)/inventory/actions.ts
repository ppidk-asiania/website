"use server";

import { revalidatePath } from "next/cache";
import { getAuditContext, getPrincipal } from "@/server/context";
import { inventoryActions } from "@/server/wiring";

const done = <T extends { ok: boolean }>(result: T): T => {
  if (result.ok) {
    revalidatePath("/inventory");
  }
  return result;
};

export async function createItemAction(input: unknown) {
  return done(await inventoryActions().create(getPrincipal, getAuditContext)(input));
}

export async function updateItemAction(input: unknown) {
  return done(await inventoryActions().update(getPrincipal, getAuditContext)(input));
}

export async function setItemTotalAction(input: unknown) {
  return done(await inventoryActions().setTotal(getPrincipal, getAuditContext)(input));
}

export async function deleteItemAction(input: unknown) {
  return done(await inventoryActions().remove(getPrincipal, getAuditContext)(input));
}
