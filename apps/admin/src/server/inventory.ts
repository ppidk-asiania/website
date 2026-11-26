import "server-only";
import { z } from "zod";
import type { ItemAudit, SqlInventoryStore } from "@website/db/sql";
import {
  InventoryItemInputSchema,
  MAX_STOCK,
  NewItemInputSchema,
  scopeOfItem,
  type ItemOwner,
  type ItemOwnerInput,
} from "@website/domain/inventory";
import { RuleViolationError } from "@website/domain/shared";
import type { ResourceContext } from "@website/permissions";
import { safeId, safeText } from "@website/security/validation";
import { createGuardedAction, type AuditBuilder } from "./guarded-action";

export interface InventoryDeps {
  readonly inventory: Pick<SqlInventoryStore, "get" | "create" | "update" | "setTotal" | "remove">;
  readonly unitPath: (orgUnitId: string) => Promise<readonly string[] | null>;
  readonly chapterExists: (chapterId: string) => Promise<boolean>;
  readonly now: () => Date;
}

const Ref = z.object({ id: safeId, version: z.number().int().min(1) }).strict();
const Update = InventoryItemInputSchema.extend({
  id: safeId,
  version: z.number().int().min(1),
}).strict();
const SetTotal = Ref.extend({
  total: z.number().int().min(0).max(MAX_STOCK),
  note: safeText(200, { allowEmpty: true }),
}).strict();

const itemAudit =
  (audit: AuditBuilder, action: "CREATE" | "UPDATE" | "DELETE"): ItemAudit =>
  (before, after, item) =>
    audit({
      module: "inventory",
      action,
      resourceType: "inventoryItem",
      resourceId: item.id,
      title: item.name,
      before,
      after,
      versionBefore: action === "CREATE" ? null : item.version - 1,
      versionAfter: item.version,
      revertible: false,
    });

export function createInventoryActions(deps: InventoryDeps) {
  /** The scope of a stored item; a missing one reads as "forbidden" (no existence oracle). */
  const scopeOfId = async ({ id }: { id: string }): Promise<ResourceContext> => {
    const item = await deps.inventory.get(id);
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

  const create = createGuardedAction({
    permission: "inventory.edit",
    input: NewItemInputSchema,
    resource: async ({ owner }): Promise<ResourceContext> => scopeOfItem(await ownerOf(owner)),
    handler: async ({ owner, ...fields }, principal, audit) => {
      const saved = await deps.inventory.create(
        { ...fields, owner: await ownerOf(owner) },
        principal.userId,
        deps.now(),
        itemAudit(audit, "CREATE"),
      );
      return { id: saved.id, version: saved.version };
    },
  });

  const update = createGuardedAction({
    permission: "inventory.edit",
    input: Update,
    resource: scopeOfId,
    handler: async ({ id, version, ...fields }, principal, audit) => {
      const saved = await deps.inventory.update(
        id,
        version,
        fields,
        principal.userId,
        deps.now(),
        itemAudit(audit, "UPDATE"),
      );
      return { id: saved.id, version: saved.version };
    },
  });

  const setTotal = createGuardedAction({
    permission: "inventory.edit",
    input: SetTotal,
    resource: scopeOfId,
    handler: async ({ id, version, total, note }, principal, audit) => {
      const saved = await deps.inventory.setTotal(
        id,
        version,
        total,
        note || null,
        principal.userId,
        deps.now(),
        itemAudit(audit, "UPDATE"),
      );
      return { id: saved.id, version: saved.version };
    },
  });

  const remove = createGuardedAction({
    permission: "inventory.edit",
    input: Ref,
    resource: scopeOfId,
    handler: async ({ id, version }, _principal, audit) => {
      await deps.inventory.remove(id, version, deps.now(), itemAudit(audit, "DELETE"));
      return { id };
    },
  });

  return { create, update, setTotal, remove };
}
