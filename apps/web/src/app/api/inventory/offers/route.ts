import { contributionOffers } from "@/server/inventory";
import { getSignedInUser } from "@/server/session";

export async function POST(request: Request) {
  const user = await getSignedInUser();
  return contributionOffers()(user, request);
}
