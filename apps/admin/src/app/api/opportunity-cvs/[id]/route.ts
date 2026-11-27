import { getPrincipal } from "@/server/context";
import { opportunityApplicationActions } from "@/server/wiring";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return opportunityApplicationActions().openCv(id, await getPrincipal());
}
