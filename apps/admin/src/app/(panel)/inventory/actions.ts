"use server";

import { revalidatePath } from "next/cache";
import { getAuditContext, getPrincipal } from "@/server/context";
import { inventoryActions, inventoryFlowActions, loanActions } from "@/server/wiring";

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

const flows = () => inventoryFlowActions();
const flowDone = <T extends { ok: boolean }>(result: T): T => {
  if (result.ok) revalidatePath("/inventory");
  return result;
};

export async function reserveItemAction(input: unknown) {
  return flowDone(await flows().reserve(getPrincipal, getAuditContext)(input));
}

export async function releaseReservationAction(input: unknown) {
  return flowDone(await flows().release(getPrincipal, getAuditContext)(input));
}

export async function approveContributionAction(input: unknown) {
  return flowDone(await flows().approveContribution(getPrincipal, getAuditContext)(input));
}

export async function rejectContributionAction(input: unknown) {
  return flowDone(await flows().rejectContribution(getPrincipal, getAuditContext)(input));
}

export async function requestProcurementAction(input: unknown) {
  return flowDone(await flows().requestProcurement(getPrincipal, getAuditContext)(input));
}

export async function decideProcurementAction(input: unknown) {
  return flowDone(await flows().decideProcurement(getPrincipal, getAuditContext)(input));
}

export async function lendOutAction(input: unknown) {
  return flowDone(await flows().lendOut(getPrincipal, getAuditContext)(input));
}

export async function takeBackOutsideAction(input: unknown) {
  return flowDone(await flows().takeBackOutside(getPrincipal, getAuditContext)(input));
}
