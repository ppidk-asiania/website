import { applyLink } from "@/server/opportunities";
import { getSignedInUser } from "@/server/session";

/** "Apply" on a posting with an external link: signed-in only; counts the click, then goes there. */
export async function GET(request: Request, { params }: RouteContext<"/opportunities/[id]/apply">) {
  const { id } = await params;
  const user = await getSignedInUser();
  if (!user) {
    const back = encodeURIComponent(`/opportunities/${id}/apply`);
    return Response.redirect(new URL(`/login?next=${back}`, request.url), 302);
  }
  const link = await applyLink(id);
  return Response.redirect(link ?? new URL("/opportunities", request.url), 302);
}
