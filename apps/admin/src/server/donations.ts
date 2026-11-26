import "server-only";
import { z } from "zod";
import type { PaymentCashAudit, SqlDonationStore } from "@website/db/sql";
import { DonationChannelInputSchema, type DonationChannel } from "@website/domain/organizations";
import { formatMoney, majorText } from "@website/domain/shared";
import { can, type Principal } from "@website/permissions";
import { jsonError } from "@website/security";
import { safeId, safeText } from "@website/security/validation";
import { createGuardedAction, type AuditBuilder } from "./guarded-action";

export interface DonationDeps {
  readonly donations: Pick<
    SqlDonationStore,
    "writeChannel" | "verify" | "reject" | "proofOf" | "list" | "listChannels"
  >;
  /** A private file link, short-lived (the proof of a donation). */
  readonly storage: { signedReadUrl(path: string): Promise<string> };
  readonly notify: {
    decided(uid: string, id: string, verified: boolean, note: string | null): Promise<void>;
  };
  readonly users: (
    uids: readonly string[],
  ) => Promise<ReadonlyMap<string, { name: string | null; email: string | null }>>;
  readonly logExport: (actorId: string, details: Record<string, unknown>) => void;
}

const noStore = { "Cache-Control": "private, no-store" };
const SaveChannel = DonationChannelInputSchema.and(
  z.object({ id: safeId.optional(), version: z.number().int().min(1).nullable() }).strict(),
);
const Decision = z.object({ id: safeId }).strict();

type Snap = Parameters<AuditBuilder>[0]["before"];

const donationAudit = (audit: AuditBuilder, id: string) => (before: Snap, after: Snap) =>
  audit({
    module: "finance",
    action: "UPDATE",
    resourceType: "donation",
    resourceId: id,
    title: "Donation check",
    before,
    after,
    versionBefore: null,
    versionAfter: null,
    revertible: false,
  });

const cashAudit =
  (audit: AuditBuilder): PaymentCashAudit =>
  (after, entry) =>
    audit({
      module: "finance",
      action: "CREATE",
      resourceType: "cashEntry",
      resourceId: entry.id,
      title: `${entry.description} (${formatMoney(entry)})`,
      before: null,
      after,
      versionBefore: null,
      versionAfter: 1,
      revertible: false,
    });

/** Quotes a CSV cell and defuses spreadsheet formulas (=, +, -, @), as the cash report does. */
const cell = (value: string) =>
  `"${(/^[=+\-@\t\r]/.test(value) ? `'${value}` : value).replace(/"/g, '""')}"`;

export function createDonationActions(deps: DonationDeps) {
  const saveChannel = createGuardedAction({
    permission: "finance.donations",
    input: SaveChannel,
    handler: async ({ id, version, ...input }, _principal, audit) => {
      const saved = await deps.donations.writeChannel(
        id ?? null,
        version,
        () => ({ ...input, deletedAt: null }),
        (before, after, current: DonationChannel | null, next) =>
          audit({
            module: "finance",
            action: current ? "UPDATE" : "CREATE",
            resourceType: "donationChannel",
            resourceId: next.id,
            title: next.label,
            before,
            after,
            versionBefore: current?.version ?? null,
            versionAfter: next.version,
            revertible: false,
          }),
        new Date(),
      );
      return { id: saved.id, version: saved.version };
    },
  });

  const verify = createGuardedAction({
    permission: "finance.donations",
    input: Decision,
    handler: async ({ id }, principal, audit) => {
      const done = await deps.donations.verify(
        id,
        principal.userId,
        new Date(),
        donationAudit(audit, id),
        cashAudit(audit),
      );
      if (done.changed) await deps.notify.decided(done.userId, id, true, null);
      return { changed: done.changed };
    },
  });

  const reject = createGuardedAction({
    permission: "finance.donations",
    input: Decision.extend({
      note: safeText(500, { multiline: true }).pipe(
        z.string().min(3, "Write a short reason (at least 3 characters)."),
      ),
    }).strict(),
    handler: async ({ id, note }, principal, audit) => {
      const done = await deps.donations.reject(
        id,
        principal.userId,
        note,
        new Date(),
        donationAudit(audit, id),
      );
      await deps.notify.decided(done.userId, id, false, note);
      return { changed: true };
    },
  });

  /** The checker opens the proof: a short-lived link to the private file. */
  const openProof = async (id: string, principal: Principal | null): Promise<Response> => {
    if (principal === null || !principal.active) return jsonError("unauthenticated");
    if (!can(principal, "finance.donations")) return jsonError("forbidden");
    const proof = safeId.safeParse(id).success ? await deps.donations.proofOf(id) : null;
    if (!proof) return Response.json({ error: "not_found" }, { status: 404, headers: noStore });
    return new Response(null, {
      status: 302,
      headers: { Location: await deps.storage.signedReadUrl(proof.path), ...noStore },
    });
  };

  /** All donations as CSV for the treasurer; the export is logged. */
  const exportCsv = async (principal: Principal | null): Promise<Response> => {
    if (principal === null || !principal.active) return jsonError("unauthenticated");
    if (!can(principal, "finance.export")) return jsonError("forbidden");
    const [rows, channels] = await Promise.all([
      deps.donations.list(),
      deps.donations.listChannels(),
    ]);
    const names = await deps.users([...new Set(rows.map((r) => r.userId))]);
    const label = new Map(channels.map((c) => [c.id, c.label]));
    const lines = ["date,channel,currency,amount,status,donor,email,shown_as"];
    for (const r of rows) {
      const donor = names.get(r.userId);
      lines.push(
        [
          r.createdAt.toISOString().slice(0, 10),
          cell(label.get(r.channelId) ?? ""),
          r.currency,
          majorText(r.amountMinor, r.currency),
          r.status,
          cell(donor?.name ?? ""),
          cell(donor?.email ?? ""),
          cell(r.supporterName ?? "Anonymous"),
        ].join(","),
      );
    }
    deps.logExport(principal.userId, { dataset: "donations", format: "csv", rows: rows.length });
    return new Response(lines.join("\n"), {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": 'attachment; filename="donations.csv"',
        "X-Content-Type-Options": "nosniff",
        ...noStore,
      },
    });
  };

  return { saveChannel, verify, reject, openProof, exportCsv };
}
