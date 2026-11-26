import { getPrincipal } from "@/server/context";
import { eventRegistrationActions } from "@/server/wiring";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return eventRegistrationActions().openProof(id, await getPrincipal());
}
