import "server-only";
import { z } from "zod";
import type { LoanAudit, SqlInventoryStore, SqlLoanStore } from "@website/db/sql";
import { RETURN_CONDITIONS, scopeOfItem, type Loan } from "@website/domain/inventory";
import { RuleViolationError } from "@website/domain/shared";
import { can, type Principal, type ResourceContext } from "@website/permissions";
import { jsonError } from "@website/security";
import { safeId, safeText } from "@website/security/validation";
import { createGuardedAction, type AuditBuilder } from "./guarded-action";

export type LoanNoticeStep = "approved" | "rejected" | "handed_over" | "returned";

export interface LoanDeps {
  readonly loans: Pick<SqlLoanStore, "get" | "decide" | "handOver" | "takeBack">;
  readonly inventory: Pick<SqlInventoryStore, "get">;
  /** A private file link, short-lived (the statement of an outsider). */
  readonly storage: { signedReadUrl(path: string): Promise<string> };
  readonly notify: {
    loanStep(
      loan: Loan,
      itemName: string,
      step: LoanNoticeStep,
      note: string | null,
    ): Promise<void>;
  };
  readonly now: () => Date;
}

const noStore = { "Cache-Control": "private, no-store" };
const Ref = z.object({ id: safeId }).strict();
const Reject = Ref.extend({
  note: safeText(300, { multiline: true }).pipe(
    z.string().min(3, "Write a short reason (at least 3 characters)."),
  ),
}).strict();
const TakeBack = Ref.extend({
  condition: z.enum(RETURN_CONDITIONS),
  note: safeText(300, { multiline: true, allowEmpty: true }),
}).strict();

const loanAudit =
  (audit: AuditBuilder, title: string): LoanAudit =>
  (before, after, loan) =>
    audit({
      module: "inventory",
      action: "UPDATE",
      resourceType: "itemLoan",
      resourceId: loan.id,
      title,
      before,
      after,
      versionBefore: null,
      versionAfter: null,
      revertible: false,
    });

export function createLoanActions(deps: LoanDeps) {
  /** The owner of the item decides (the usual scopes); a missing request reads as "forbidden". */
  const scopeOfLoan = async ({ id }: { id: string }): Promise<ResourceContext> => {
    const loan = await deps.loans.get(id);
    const item = loan && (await deps.inventory.get(loan.itemId));
    if (!item) throw new RuleViolationError("This request does not exist.");
    return scopeOfItem(item.owner);
  };
  const nameOf = async (id: string) => {
    const loan = await deps.loans.get(id);
    return (loan && (await deps.inventory.get(loan.itemId))?.name) || "";
  };

  const approve = createGuardedAction({
    permission: "inventory.approve",
    input: Ref,
    resource: scopeOfLoan,
    handler: async ({ id }, principal, audit) => {
      const name = await nameOf(id);
      const loan = await deps.loans.decide(
        id,
        "approve",
        principal.userId,
        null,
        deps.now(),
        loanAudit(audit, `Loan approved: ${name}`),
      );
      await deps.notify.loanStep(loan, name, "approved", null);
      return { id };
    },
  });

  const reject = createGuardedAction({
    permission: "inventory.approve",
    input: Reject,
    resource: scopeOfLoan,
    handler: async ({ id, note }, principal, audit) => {
      const name = await nameOf(id);
      const loan = await deps.loans.decide(
        id,
        "reject",
        principal.userId,
        note,
        deps.now(),
        loanAudit(audit, `Loan rejected: ${name}`),
      );
      await deps.notify.loanStep(loan, name, "rejected", note);
      return { id };
    },
  });

  const handOver = createGuardedAction({
    permission: "inventory.approve",
    input: Ref,
    resource: scopeOfLoan,
    handler: async ({ id }, principal, audit) => {
      const name = await nameOf(id);
      const loan = await deps.loans.handOver(
        id,
        principal.userId,
        deps.now(),
        loanAudit(audit, `Handed over: ${name}`),
      );
      await deps.notify.loanStep(loan, name, "handed_over", null);
      return { id };
    },
  });

  const takeBack = createGuardedAction({
    permission: "inventory.approve",
    input: TakeBack,
    resource: scopeOfLoan,
    handler: async ({ id, condition, note }, principal, audit) => {
      const name = await nameOf(id);
      const loan = await deps.loans.takeBack(
        id,
        principal.userId,
        condition,
        note || null,
        deps.now(),
        loanAudit(audit, `Returned: ${name}`),
      );
      await deps.notify.loanStep(loan, name, "returned", note || null);
      return { id };
    },
  });

  /** The approver opens an outsider's signed statement: a short-lived link to the private file. */
  const openStatement = async (id: string, principal: Principal | null): Promise<Response> => {
    if (principal === null || !principal.active) return jsonError("unauthenticated");
    const loan = safeId.safeParse(id).success ? await deps.loans.get(id) : null;
    const item = loan && (await deps.inventory.get(loan.itemId));
    if (!loan || !item || loan.borrower.kind !== "outsider") {
      return Response.json({ error: "not_found" }, { status: 404, headers: noStore });
    }
    if (!can(principal, "inventory.approve", scopeOfItem(item.owner)))
      return jsonError("forbidden");
    return new Response(null, {
      status: 302,
      headers: {
        Location: await deps.storage.signedReadUrl(loan.borrower.statementPath),
        ...noStore,
      },
    });
  };

  return { approve, reject, handOver, takeBack, openStatement };
}
