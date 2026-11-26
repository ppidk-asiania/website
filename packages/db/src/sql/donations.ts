import type { Database } from "./store";
import type { Snapshot } from "@website/audit";
import type { FeaturedImage } from "@website/domain/content";
import {
  assertNotOwnDonation,
  cashEntryFromDonation,
  type DonationChannel,
  type DonationInput,
  type DonationState,
  type PublicDonationChannel,
  type Supporter,
} from "@website/domain/organizations";
import { RuleViolationError } from "@website/domain/shared";
import { safeId } from "@website/security/validation";
import { createSqlAuditWriter } from "./audit";
import type { PaymentAudit, PaymentCashAudit, PaymentProof } from "./events";
import { cashEntrySnapshot, storedEntry } from "./finance";
import { createSluggedStore, toDate } from "./slugged";

export type DonationChannelFields = Omit<
  DonationChannel,
  "id" | "version" | "createdAt" | "updatedAt"
>;

function toChannel(id: string, data: Record<string, unknown>): DonationChannel {
  return {
    id,
    label: data["label"] as string,
    details: data["details"] as string,
    image: (data["image"] as FeaturedImage | null | undefined) ?? null,
    currency: data["currency"] as DonationChannel["currency"],
    published: data["published"] as boolean,
    version: data["version"] as number,
    createdAt: toDate(data["createdAt"]) as Date,
    updatedAt: toDate(data["updatedAt"]) as Date,
    deletedAt: toDate(data["deletedAt"]),
  };
}

export const channelSnapshot = (c: DonationChannelFields): Snapshot => ({
  label: c.label,
  details: c.details,
  image: c.image ? { ...c.image } : null,
  currency: c.currency,
  published: c.published,
});

const channels = (db: Database) =>
  createSluggedStore<DonationChannel>(db, {
    collection: "donationChannels",
    slug: null,
    fromDoc: toChannel,
    snapshot: channelSnapshot,
    fixed: () => ({}),
  });

/** A donation as the checker sees it; the proof file itself stays private. */
export interface DonationRow {
  readonly id: string;
  readonly channelId: string;
  readonly userId: string;
  readonly amountMinor: number;
  readonly currency: DonationChannel["currency"];
  readonly message: string | null;
  readonly supporterName: string | null;
  readonly status: DonationState;
  readonly note: string | null;
  readonly createdAt: Date;
}

const toRow = (id: string, doc: { get(field: string): unknown }): DonationRow => ({
  id,
  channelId: doc.get("channelId") as string,
  userId: doc.get("userId") as string,
  amountMinor: doc.get("amountMinor") as number,
  currency: doc.get("currency") as DonationChannel["currency"],
  message: (doc.get("message") as string | null | undefined) ?? null,
  supporterName: (doc.get("supporterName") as string | null | undefined) ?? null,
  status: doc.get("status") as DonationState,
  note: (doc.get("note") as string | null | undefined) ?? null,
  createdAt: toDate(doc.get("createdAt")) as Date,
});

const donationSnapshot = (doc: { get(field: string): unknown }): Snapshot => ({
  channelId: doc.get("channelId") as string,
  amountMinor: doc.get("amountMinor") as number,
  currency: doc.get("currency") as string,
  status: doc.get("status") as string,
  note: (doc.get("note") as string | null | undefined) ?? null,
});

const MAX_LIST = 2000;

/** Admin side: channels, the donations to check, verify and reject. */
export function createSqlDonationStore(db: Database) {
  const store = channels(db);
  const donations = db.collection("donations");
  const cash = db.collection("cashEntries");
  const audit = createSqlAuditWriter(db);
  return {
    async listChannels(limit = 200): Promise<DonationChannel[]> {
      const snapshot = await store.docs.limit(limit).get();
      return snapshot.docs
        .map((doc) => store.read(doc.id, doc.data()))
        .filter((c) => c.deletedAt === null)
        .sort((a, b) => a.label.localeCompare(b.label));
    },
    getChannel: store.get,
    writeChannel: store.write,

    /** Waiting donations first, then the newest. */
    async list(limit = MAX_LIST): Promise<DonationRow[]> {
      const snapshot = await donations.limit(limit).get();
      const rank = (r: DonationRow) => (r.status === "pending" ? 0 : 1);
      return snapshot.docs
        .map((doc) => toRow(doc.id, doc))
        .sort((a, b) => rank(a) - rank(b) || b.createdAt.getTime() - a.createdAt.getTime());
    },

    async proofOf(id: string): Promise<PaymentProof | null> {
      const snap = await donations.doc(safeId.parse(id)).get();
      return (snap.get("proof") as PaymentProof | undefined) ?? null;
    },

    /** Donations waiting for a check (the dashboard queue). */
    async countPending(): Promise<number> {
      return (await donations.where("status", "==", "pending").get()).docs.length;
    },

    /**
     * Verify: ONE cash book income line (its id is the donation id) in the same transaction;
     * a second verify writes nothing. The verifier is never the donor.
     */
    verify(
      id: string,
      verifiedBy: string,
      now: Date,
      auditFor: PaymentAudit,
      cashAuditFor: PaymentCashAudit,
    ): Promise<{ changed: boolean; userId: string }> {
      return db.runTransaction(async (tx) => {
        const ref = donations.doc(safeId.parse(id));
        const snap = await tx.get(ref);
        if (!snap.exists) throw new RuleViolationError("This donation does not exist.");
        const userId = snap.get("userId") as string;
        if (snap.get("status") === "verified") return { changed: false, userId };
        if (snap.get("status") !== "pending") {
          throw new RuleViolationError("This donation was already decided.");
        }
        assertNotOwnDonation(verifiedBy, userId);
        const channel = await tx.get(
          db.collection("donationChannels").doc(safeId.parse(snap.get("channelId"))),
        );
        const active = await tx.get(db.collection("settings").doc("activePeriod"));
        const periodId = active.get("periodId") as string | undefined;
        if (!periodId) throw new RuleViolationError("Activate a board period first.");
        if ((await tx.get(cash.doc(ref.id))).exists) {
          throw new RuleViolationError("This donation is already in the cash book.");
        }
        const log = await audit.begin(tx);
        const before = donationSnapshot(snap);
        tx.update(ref, {
          status: "verified",
          reviewedBy: verifiedBy,
          reviewedAt: now,
          updatedAt: now,
        });
        log.append(auditFor(before, { ...before, status: "verified" }));
        const entry = cashEntryFromDonation({
          donationId: ref.id,
          periodId,
          channel: (channel.get("label") as string | undefined) ?? "channel",
          amountMinor: snap.get("amountMinor") as number,
          currency: snap.get("currency") as DonationChannel["currency"],
          at: now,
          verifiedBy,
        });
        tx.create(cash.doc(entry.id), storedEntry(entry));
        log.append(cashAuditFor(cashEntrySnapshot(entry), entry));
        return { changed: true, userId };
      });
    },

    reject(
      id: string,
      reviewedBy: string,
      note: string,
      now: Date,
      auditFor: PaymentAudit,
    ): Promise<{ userId: string }> {
      return db.runTransaction(async (tx) => {
        const ref = donations.doc(safeId.parse(id));
        const snap = await tx.get(ref);
        if (!snap.exists || snap.get("status") !== "pending") {
          throw new RuleViolationError("There is no donation to check.");
        }
        const userId = snap.get("userId") as string;
        assertNotOwnDonation(reviewedBy, userId);
        const log = await audit.begin(tx);
        const before = donationSnapshot(snap);
        tx.update(ref, { status: "rejected", note, reviewedBy, reviewedAt: now, updatedAt: now });
        log.append(auditFor(before, { ...before, status: "rejected", note }));
        return { userId };
      });
    },
  };
}
export type SqlDonationStore = ReturnType<typeof createSqlDonationStore>;

/** Web side: the published channels, a donation sent with its proof, and the wall of supporters. */
export function createSqlDonationWebStore(db: Database) {
  const store = channels(db);
  const donations = db.collection("donations");
  return {
    async channels(limit = 200): Promise<PublicDonationChannel[]> {
      const snapshot = await store.docs.where("published", "==", true).limit(limit).get();
      return snapshot.docs
        .map((doc) => store.read(doc.id, doc.data()))
        .filter((c) => c.deletedAt === null)
        .sort((a, b) => a.label.localeCompare(b.label))
        .map(({ id, label, details, image, currency }) => ({
          id,
          label,
          details,
          image,
          currency,
        }));
    },

    /** The channel a donation would go to (null when it is hidden or gone). */
    async channel(id: string): Promise<PublicDonationChannel | null> {
      const found = await store.get(safeId.parse(id));
      return found && found.published && found.deletedAt === null
        ? {
            id: found.id,
            label: found.label,
            details: found.details,
            image: found.image,
            currency: found.currency,
          }
        : null;
    },

    /** Writes the donation as pending. The name is kept only when the donor chose to show it. */
    submit(
      id: string,
      userId: string,
      input: DonationInput,
      supporterName: string | null,
      proof: PaymentProof,
      now: Date,
    ): Promise<void> {
      return db.runTransaction(async (tx) => {
        const channel = await tx.get(
          db.collection("donationChannels").doc(safeId.parse(input.channelId)),
        );
        if (!channel.exists || channel.get("published") !== true || channel.get("deletedAt")) {
          throw new RuleViolationError("This channel is not available.");
        }
        tx.create(donations.doc(safeId.parse(id)), {
          channelId: input.channelId,
          userId,
          amountMinor: input.amountMinor,
          currency: channel.get("currency"),
          message: input.message || null,
          supporterName: input.showName ? supporterName : null,
          proof: { ...proof, uploadedAt: now },
          status: "pending",
          note: null,
          createdAt: now,
          updatedAt: now,
        });
      });
    },

    /** Verified donations, newest first: a name or null (shown as "Anonymous"), never an amount. */
    async supporters(limit = 500): Promise<Supporter[]> {
      const snapshot = await donations.where("status", "==", "verified").limit(limit).get();
      return snapshot.docs
        .map((doc) => ({
          id: doc.id,
          name: (doc.get("supporterName") as string | null | undefined) ?? null,
          at: (toDate(doc.get("reviewedAt")) ?? toDate(doc.get("createdAt"))) as Date,
        }))
        .sort((a, b) => b.at.getTime() - a.at.getTime());
    },
  };
}
export type SqlDonationWebStore = ReturnType<typeof createSqlDonationWebStore>;
