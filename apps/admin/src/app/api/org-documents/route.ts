import { getAuditContext, getPrincipal } from "@/server/context";
import { orgDocumentActions } from "@/server/wiring";

export async function POST(request: Request) {
  return orgDocumentActions().uploadFile(getPrincipal, getAuditContext)(request);
}
