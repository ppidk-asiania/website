"use server";

import { getAuditContext, getPrincipal } from "@/server/context";
import { checkInActions } from "@/server/wiring";

export async function attendanceAction(input: unknown) {
  return checkInActions().attendance(getPrincipal, getAuditContext)(input);
}

export async function scanTicketAction(input: unknown) {
  return checkInActions().scan(getPrincipal, getAuditContext)(input);
}

export async function checkInAction(input: unknown) {
  return checkInActions().checkIn(getPrincipal, getAuditContext)(input);
}

export async function undoCheckInAction(input: unknown) {
  return checkInActions().undo(getPrincipal, getAuditContext)(input);
}
