import { uploadDonation } from "@/server/donations";
import { getSignedInUser } from "@/server/session";

export async function POST(request: Request) {
  const user = await getSignedInUser();
  return uploadDonation()(user, request);
}
