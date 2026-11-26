import { can } from "@website/permissions";
import { AccessMessage } from "@/components/access-message";
import { SponsorsPage } from "@/components/sponsors-page";
import { requireAdminViewer } from "@/server/context";
import { adminReads } from "@/server/wiring";

export const instant = false;

export default async function AdminSponsorsPage() {
  const viewer = await requireAdminViewer("/sponsors", "sponsors.read");
  if (typeof viewer === "string") return <AccessMessage reason={viewer} />;
  const sponsors = await adminReads.listSponsors();
  return (
    <SponsorsPage
      rows={sponsors.map((s) => ({
        id: s.id,
        version: s.version,
        name: s.name,
        tier: s.tier,
        logo: s.logo,
        link: s.link ?? "",
        order: s.order,
        published: s.published,
      }))}
      canEdit={can(viewer.principal, "sponsors.edit")}
    />
  );
}
