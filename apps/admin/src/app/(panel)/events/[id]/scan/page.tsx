import { AccessMessage } from "@/components/access-message";
import { EventScanPage } from "@/components/event-scan-page";
import { getAuditContext, getPrincipal, requireAdminViewer } from "@/server/context";
import { checkInActions } from "@/server/wiring";

export const instant = false;

/** The door scanner of one event (N1.4): camera or name search; the camera is allowed on this route only. */
export default async function AdminEventScanPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const viewer = await requireAdminViewer(`/events/${id}/scan`, "events.read");
  if (typeof viewer === "string") return <AccessMessage reason={viewer} />;
  const attendance = await checkInActions().attendance(
    getPrincipal,
    getAuditContext,
  )({ eventId: id });
  if (!attendance.ok) return <AccessMessage reason="no-access" />;
  return <EventScanPage eventId={id} initial={attendance.data} />;
}
