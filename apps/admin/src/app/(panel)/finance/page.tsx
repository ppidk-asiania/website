import { z } from "zod";
import { FINANCE_CURRENCIES } from "@website/domain/finance";
import { safeText } from "@website/security/validation";
import { deskTitle, orgUnitPath } from "@website/domain/organizations";
import { can, canInSomeScope, scopedOrgUnitIds } from "@website/permissions";
import { AccessMessage } from "@/components/access-message";
import { toFinanceItem } from "@/components/finance-model";
import { FinancePage } from "@/components/finance-page";
import { requireAdminViewer } from "@/server/context";
import { adminReads } from "@/server/wiring";

export const instant = false;

const LIMIT = 300;

const Prefill = z
  .object({
    title: safeText(200),
    description: safeText(1000, { multiline: true, allowEmpty: true }),
    amount: z.coerce.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
    currency: z.enum(FINANCE_CURRENCIES),
  })
  .strict();

export default async function AdminFinancePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const viewer = await requireAdminViewer("/finance", "finance.read");
  if (typeof viewer === "string") return <AccessMessage reason={viewer} />;
  const { principal } = viewer;
  const periods = await adminReads.listPeriods();
  const period = periods.find((p) => p.status === "active") ?? null;
  const [units, requests] = period
    ? await Promise.all([
        adminReads.listOrgUnits(period.id),
        adminReads.listFinance({
          periodId: period.id,
          orgUnitIds: scopedOrgUnitIds(principal, "finance.read"),
          limit: LIMIT,
        }),
      ])
    : [[], []];
  const people = await adminReads.getUsers([
    ...new Set(
      requests.flatMap((r) =>
        [r.createdBy, r.treasurer?.uid, r.coordinator?.uid, r.payment?.uid].filter(
          (u): u is string => !!u,
        ),
      ),
    ),
  ]);
  const names = new Map([...people].map(([uid, u]) => [uid, u.name ?? u.email ?? uid]));
  const unitName = new Map(units.map((u) => [u.id, u.name]));
  const asked = Prefill.safeParse(await searchParams);
  return (
    <FinancePage
      periodName={period?.name ?? null}
      coordinatorTitle={deskTitle(period, "coordinator")}
      initial={requests.map((r) =>
        toFinanceItem(r, names, unitName.get(r.orgUnitId) ?? "", principal.userId),
      )}
      prefill={
        asked.success
          ? {
              title: asked.data.title,
              description: asked.data.description,
              amountMinor: asked.data.amount,
              currency: asked.data.currency,
            }
          : undefined
      }
      units={units
        .filter((u) => u.active && can(principal, "finance.edit", { orgUnitPath: orgUnitPath(u) }))
        .map((u) => ({ id: u.id, name: u.name }))}
      desks={{
        edit: canInSomeScope(principal, "finance.edit"),
        review: canInSomeScope(principal, "finance.review"),
        authorize: canInSomeScope(principal, "finance.authorize"),
        pay: canInSomeScope(principal, "finance.pay"),
        cashbook: can(principal, "finance.cashbook") || can(principal, "finance.export"),
        donations: can(principal, "finance.donations"),
      }}
    />
  );
}
