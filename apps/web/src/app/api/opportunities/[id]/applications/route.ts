import { applying } from "@/server/opportunities";
import { getSignedInUser } from "@/server/session";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const [user, { id }] = await Promise.all([getSignedInUser(), context.params]);
  return applying().apply(user, id, request);
}
