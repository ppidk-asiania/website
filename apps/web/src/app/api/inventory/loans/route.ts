import { loanRequests } from "@/server/inventory";
import { getSignedInUser } from "@/server/session";

export async function POST(request: Request) {
  const user = await getSignedInUser();
  return loanRequests().member(user, request);
}
