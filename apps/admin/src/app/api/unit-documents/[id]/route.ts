import { getPrincipal } from "@/server/context";
import { unitDocumentActions } from "@/server/wiring";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return unitDocumentActions().open(id, await getPrincipal());
}
