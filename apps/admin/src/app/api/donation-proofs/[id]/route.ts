import { getPrincipal } from "@/server/context";
import { donationActions } from "@/server/wiring";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return donationActions().openProof(id, await getPrincipal());
}
