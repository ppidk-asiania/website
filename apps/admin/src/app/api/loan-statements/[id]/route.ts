import { getPrincipal } from "@/server/context";
import { loanActions } from "@/server/wiring";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return loanActions().openStatement(id, await getPrincipal());
}
