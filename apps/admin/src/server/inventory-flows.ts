import "server-only";
import { z } from "zod";
import type { CommitteeRole } from "@website/domain/events";
import type { FlowAudit, SqlFlowStore, SqlInventoryStore } from "@website/db/sql";
import {
  ItemOwnerInputSchema,
  OutsideLoanInputSchema,
  ProcurementInputSchema,
  ReservationInputSchema,
  scopeOfItem,
  type ItemOwner,
  type ItemOwnerInput,
} from "@website/domain/inventory";
import { RuleViolationError } from "@website/domain/shared";
import type { Principal, ResourceContext } from "@website/permissions";
import { safeId, safeText } from "@website/security/validation";
import { createGuardedAction, type AuditBuilder } from "./guarded-action";

export interface InventoryFlowDeps {
  readonly flows: Pick<
    SqlFlowStore,
    | "getReservation"
    | "reserve"
    | "release"
    | "getContribution"
    | "approveContribution"
    | "rejectContribution"
    | "getProcurement"
    | "requestProcurement"
    | "decideProcurement"
    | "getOutside"
    | "lendOut"
    | "takeBackOutside"
  >;
  readonly inventory: Pick<SqlInventoryStore, "get">;
  readonly unitPath: (orgUnitId: string) => Promise<readonly string[] | null>;
  readonly chapterExists: (chapterId: string) => Promise<boolean>;
  /** Whether the person sits on the event's committee, and as what (the board may reserve for its event). */
  readonly committeeRole: (userId: string, eventId: string) => Promise<CommitteeRole | null>;
  readonly now: () => Date;
}

const Ref = z.object({ id: safeId }).strict();
const Reason = safeText(300, { multiline: true }).pipe(
  z.string().min(3, "Write a short reason (at least 3 characters)."),
);
const Approve = z.object({ id: safeId, owner: ItemOwnerInputSchema }).strict();
const DecideProcurement = z
  .object({
    id: safeId,
    step: z.enum(["approve", "reject", "fulfil"]),
    note: safeText(300, { allowEmpty: true }),
  })
  .strict();
const TakeBackOutside = Ref.extend({ conditionIn: safeText(120, { allowEmpty: true }) }).strict();

const flowAudit =
  (audit: AuditBuilder, resourceType: string, resourceId: string): FlowAudit =>
  (before, after, title) =>
    audit({
      module: "inventory",
      action: before === null ? "CREATE" : "UPDATE",
      resourceType,
      resourceId,
      title,
      before,
      after,
      versionBefore: null,
      versionAfter: null,
      revertible: false,
    });

export function createInventoryFlowActions(deps: InventoryFlowDeps) {
  const today = () => deps.now().toISOString().slice(0, 10);

  const scopeOfItemId = async (itemId: string): Promise<ResourceContext> => {
    const item = await deps.inventory.get(itemId);
    if (!item) throw new RuleViolationError("This item does not exist.");
    return scopeOfItem(item.owner);
  };
  /** The owner as stored: a unit's path is read here, never taken from the browser. */
  const ownerOf = async (input: ItemOwnerInput): Promise<ItemOwner> => {
    if (input.kind === "unit") {
      const path = await deps.unitPath(input.orgUnitId);
      if (!path) throw new RuleViolationError("This unit does not exist.");
      return { kind: "unit", orgUnitId: input.orgUnitId, orgUnitPath: path };
    }
    if (input.kind === "chapter" && !(await deps.chapterExists(input.chapterId))) {
      throw new RuleViolationError("This chapter does not exist.");
    }
    return input;
  };

  /* reservations: the item's owner, or the board of the event the equipment is for */
  const board = async (principal: Principal, { eventId }: { eventId: string }) =>
    (await deps.committeeRole(principal.userId, eventId)) === "board";

  const reserve = createGuardedAction({
    permission: "inventory.edit",
    orIf: board,
    input: ReservationInputSchema,
    resource: ({ itemId }) => scopeOfItemId(itemId),
    handler: async (input, principal, audit) => {
      const saved = await deps.flows.reserve(
        input,
        principal.userId,
        deps.now(),
        flowAudit(audit, "itemReservation", input.eventId),
      );
      return { id: saved.id };
    },
  });

  const release = createGuardedAction({
    permission: "inventory.edit",
    orIf: async (principal, { id }) => {
      const found = await deps.flows.getReservation(id);
      return found ? board(principal, found) : false;
    },
    input: Ref,
    resource: async ({ id }) => {
      const found = await deps.flows.getReservation(id);
      if (!found) throw new RuleViolationError("This reservation does not exist.");
      return scopeOfItemId(found.itemId);
    },
    handler: async ({ id }, _principal, audit) => {
      await deps.flows.release(id, deps.now(), flowAudit(audit, "itemReservation", id));
      return { id };
    },
  });

  /* contributions: an approver in the chosen owner's scope turns an offer into an item */
  const approveContribution = createGuardedAction({
    permission: "inventory.approve",
    input: Approve,
    resource: async ({ owner }) => scopeOfItem(await ownerOf(owner)),
    handler: async ({ id, owner }, principal, audit) => {
      const done = await deps.flows.approveContribution(
        id,
        await ownerOf(owner),
        principal.userId,
        deps.now(),
        flowAudit(audit, "itemContribution", id),
      );
      return { id, itemId: done.itemId };
    },
  });

  const rejectContribution = createGuardedAction({
    permission: "inventory.approve",
    inSomeScope: true,
    input: Ref.extend({ note: Reason }).strict(),
    handler: async ({ id, note }, principal, audit) => {
      await deps.flows.rejectContribution(
        id,
        principal.userId,
        note,
        deps.now(),
        flowAudit(audit, "itemContribution", id),
      );
      return { id };
    },
  });

  /* procurement: the owner scope asks, an approver in that scope decides */
  const requestProcurement = createGuardedAction({
    permission: "inventory.edit",
    input: ProcurementInputSchema,
    resource: async ({ owner }) => scopeOfItem(await ownerOf(owner)),
    handler: async ({ owner, ...fields }, principal, audit) => {
      const resolved = await ownerOf(owner);
      const id = await deps.flows.requestProcurement(
        { ...fields, owner: resolved },
        principal.userId,
        deps.now(),
        flowAudit(audit, "procurementRequest", fields.name),
      );
      return { id };
    },
  });

  const decideProcurement = createGuardedAction({
    permission: "inventory.approve",
    input: DecideProcurement,
    resource: async ({ id }) => {
      const found = await deps.flows.getProcurement(id);
      if (!found) throw new RuleViolationError("This request does not exist.");
      return scopeOfItem(found.owner);
    },
    handler: async ({ id, step, note }, principal, audit) => {
      if (step === "reject" && note.length < 3) {
        throw new RuleViolationError("Write a short reason (at least 3 characters).");
      }
      await deps.flows.decideProcurement(
        id,
        step,
        principal.userId,
        note || null,
        deps.now(),
        flowAudit(audit, "procurementRequest", id),
      );
      return { id };
    },
  });

  /* loans to outside bodies */
  const lendOut = createGuardedAction({
    permission: "inventory.approve",
    input: OutsideLoanInputSchema,
    resource: ({ itemId }) => scopeOfItemId(itemId),
    handler: async (input, principal, audit) => {
      const loan = await deps.flows.lendOut(
        input,
        principal.userId,
        today(),
        deps.now(),
        flowAudit(audit, "outsideLoan", input.itemId),
      );
      return { id: loan.id };
    },
  });

  const takeBackOutside = createGuardedAction({
    permission: "inventory.approve",
    input: TakeBackOutside,
    resource: async ({ id }) => {
      const found = await deps.flows.getOutside(id);
      if (!found) throw new RuleViolationError("This loan does not exist.");
      return scopeOfItemId(found.itemId);
    },
    handler: async ({ id, conditionIn }, principal, audit) => {
      await deps.flows.takeBackOutside(
        id,
        conditionIn,
        principal.userId,
        today(),
        deps.now(),
        flowAudit(audit, "outsideLoan", id),
      );
      return { id };
    },
  });

  return {
    reserve,
    release,
    approveContribution,
    rejectContribution,
    requestProcurement,
    decideProcurement,
    lendOut,
    takeBackOutside,
  };
}
