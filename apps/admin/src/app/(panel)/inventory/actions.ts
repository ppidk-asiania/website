"use server";

import { revalidatePath } from "next/cache";
import { getAuditContext, getPrincipal } from "@/server/context";
import { inventoryActions, loanActions } from "@/server/wiring";

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

const loanDone = <T extends { ok: boolean }>(result: T): T => {
  if (result.ok) revalidatePath("/inventory");
  return result;
};

export async function approveLoanAction(input: unknown) {
  return loanDone(await loanActions().approve(getPrincipal, getAuditContext)(input));
}

export async function rejectLoanAction(input: unknown) {
  return loanDone(await loanActions().reject(getPrincipal, getAuditContext)(input));
}

export async function handOverLoanAction(input: unknown) {
  return loanDone(await loanActions().handOver(getPrincipal, getAuditContext)(input));
}

export async function takeBackLoanAction(input: unknown) {
  return loanDone(await loanActions().takeBack(getPrincipal, getAuditContext)(input));
}
