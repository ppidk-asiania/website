import { getAuditContext, getPrincipal } from "@/server/context";
import { unitDocumentActions } from "@/server/wiring";

export async function POST(request: Request) {
  return unitDocumentActions().uploadFile(getPrincipal, getAuditContext)(request);
}
