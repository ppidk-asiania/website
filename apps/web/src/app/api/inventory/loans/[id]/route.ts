import { safeId } from "@website/security/validation";
import { loanRequests } from "@/server/inventory";
import { getSignedInUser } from "@/server/session";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const what = new URL(request.url).searchParams.get("do");
  if (!safeId.safeParse(id).success || (what !== "return" && what !== "cancel")) {
    return Response.json({ ok: false, error: "invalid" }, { status: 400 });
  }
  return loanRequests().step(await getSignedInUser(), id, what);
}
