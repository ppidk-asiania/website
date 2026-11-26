import { can } from "@website/permissions";
import { AccessMessage } from "@/components/access-message";
import { DonationsPage } from "@/components/donations-page";
import { requireAdminViewer } from "@/server/context";
import { adminReads } from "@/server/wiring";

export const instant = false;

export default async function AdminDonationsPage() {
  const viewer = await requireAdminViewer("/finance/donations", "finance.read");
  if (typeof viewer === "string") return <AccessMessage reason={viewer} />;
  const { principal } = viewer;
  if (!can(principal, "finance.donations")) return <AccessMessage reason="no-access" />;
  const [channels, donations] = await Promise.all([
    adminReads.listDonationChannels(),
    adminReads.listDonations(),
  ]);
  const names = await adminReads.getUsers([...new Set(donations.map((d) => d.userId))]);
  const label = new Map(channels.map((c) => [c.id, c.label]));
  return (
    <DonationsPage
      channels={channels.map((c) => ({
        id: c.id,
        version: c.version,
        label: c.label,
        details: c.details,
        image: c.image,
        currency: c.currency,
        published: c.published,
      }))}
      donations={donations.map((d) => ({
        id: d.id,
        channel: label.get(d.channelId) ?? "Removed channel",
        donor: names.get(d.userId)?.name || names.get(d.userId)?.email || "Unknown",
        amountMinor: d.amountMinor,
        currency: d.currency,
        message: d.message,
        shownAs: d.supporterName,
        status: d.status,
        note: d.note,
        date: d.createdAt.toISOString().slice(0, 10),
        own: d.userId === principal.userId,
      }))}
      canExport={can(principal, "finance.export")}
    />
  );
}
